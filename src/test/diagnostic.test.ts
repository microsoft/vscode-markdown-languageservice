/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as lsp from 'vscode-languageserver-types';
import { getLsConfiguration } from '../config';
import { DiagnosticComputer, DiagnosticLevel, DiagnosticOptions, DiagnosticsManager } from '../languageFeatures/diagnostics';
import { MdLinkProvider } from '../languageFeatures/documentLinks';
import { MdTableOfContentsProvider } from '../tableOfContents';
import { comparePosition } from '../types/position';
import { makeRange } from '../types/range';
import { noopToken } from '../util/cancellation';
import { DisposableStore } from '../util/dispose';
import { IWorkspace } from '../workspace';
import { createNewMarkdownEngine } from './engine';
import { InMemoryDocument } from './inMemoryDocument';
import { InMemoryWorkspace } from './inMemoryWorkspace';
import { nulLogger } from './nulLogging';
import { assertRangeEqual, defaultDiagnosticsOptions, joinLines, withStore, workspacePath, workspaceRoot } from './util';


async function getComputedDiagnostics(store: DisposableStore, doc: InMemoryDocument, workspace: IWorkspace, options: Partial<DiagnosticOptions> = {}): Promise<lsp.Diagnostic[]> {
	const engine = createNewMarkdownEngine();
	const config = getLsConfiguration({});
	const tocProvider = store.add(new MdTableOfContentsProvider(engine, workspace, nulLogger));
	const linkProvider = store.add(new MdLinkProvider(config, engine, workspace, tocProvider, nulLogger));
	const computer = new DiagnosticComputer(config, workspace, linkProvider, tocProvider, nulLogger);
	return (
		await computer.compute(doc, getDiagnosticsOptions(options), noopToken)
	).diagnostics;
}

function getDiagnosticsOptions(options: Partial<DiagnosticOptions>): DiagnosticOptions {
	return { ...defaultDiagnosticsOptions, ...options, };
}

function assertDiagnosticsEqual(actual: readonly lsp.Diagnostic[], expectedRanges: readonly lsp.Range[]) {
	assert.strictEqual(actual.length, expectedRanges.length, 'Diagnostic count equal');

	for (let i = 0; i < actual.length; ++i) {
		assertRangeEqual(actual[i].range, expectedRanges[i], `Range ${i} to be equal`);
	}
}

function orderDiagnosticsByRange(diagnostics: Iterable<lsp.Diagnostic>): readonly lsp.Diagnostic[] {
	return Array.from(diagnostics).sort((a, b) => comparePosition(a.range.start, b.range.start));
}


suite('Diagnostic Computer', () => {

	test('Should not return any diagnostics for empty document', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('doc.md'), joinLines(
			`text`,
		));
		const workspace = store.add(new InMemoryWorkspace([doc]));

		const diagnostics = await getComputedDiagnostics(store, doc, workspace);
		assert.deepStrictEqual(diagnostics, []);
	}));

	test('Should generate diagnostic for link to file that does not exist', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('doc.md'), joinLines(
			`[bad](/no/such/file.md)`,
			`[good](/doc.md)`,
			`[good-ref]: /doc.md`,
			`[bad-ref]: /no/such/file.md`,
		));
		const workspace = store.add(new InMemoryWorkspace([doc]));

		const diagnostics = await getComputedDiagnostics(store, doc, workspace, { validateUnusedLinkDefinitions: DiagnosticLevel.ignore });
		assertDiagnosticsEqual(diagnostics, [
			makeRange(0, 6, 0, 22),
			makeRange(3, 11, 3, 27),
		]);
	}));

	test('Should generate diagnostics for links to header that does not exist in current file', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('doc.md'), joinLines(
			`[good](#good-header)`,
			`# Good Header`,
			`[bad](#no-such-header)`,
			`[good](#good-header)`,
			`[good-ref]: #good-header`,
			`[bad-ref]: #no-such-header`,
		));
		const workspace = store.add(new InMemoryWorkspace([doc]));

		const diagnostics = await getComputedDiagnostics(store, doc, workspace, { validateUnusedLinkDefinitions: DiagnosticLevel.ignore });
		assertDiagnosticsEqual(diagnostics, [
			makeRange(2, 6, 2, 21),
			makeRange(5, 11, 5, 26),
		]);
	}));

	test('Should generate diagnostics for links to non-existent headers in other files', withStore(async (store) => {
		const doc1 = new InMemoryDocument(workspacePath('doc1.md'), joinLines(
			`# My header`,
			`[good](#my-header)`,
			`[good](/doc1.md#my-header)`,
			`[good](doc1.md#my-header)`,
			`[good](/doc2.md#other-header)`,
			`[bad](/doc2.md#no-such-other-header)`,
		));

		const doc2 = new InMemoryDocument(workspacePath('doc2.md'), joinLines(
			`# Other header`,
		));

		const diagnostics = await getComputedDiagnostics(store, doc1, new InMemoryWorkspace([doc1, doc2]));
		assertDiagnosticsEqual(diagnostics, [
			makeRange(5, 14, 5, 35),
		]);
	}));

	test('Should support links both with and without .md file extension', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('doc.md'), joinLines(
			`# My header`,
			`[good](#my-header)`,
			`[good](/doc.md#my-header)`,
			`[good](doc.md#my-header)`,
			`[good](/doc#my-header)`,
			`[good](doc#my-header)`,
		));
		const workspace = store.add(new InMemoryWorkspace([doc]));

		const diagnostics = await getComputedDiagnostics(store, doc, workspace);
		assertDiagnosticsEqual(diagnostics, []);
	}));

	test('Should generate diagnostics for non-existent link reference', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('doc.md'), joinLines(
			`[good link][good]`,
			`[bad link][no-such]`,
			``,
			`[good]: http://example.com`,
		));
		const workspace = store.add(new InMemoryWorkspace([doc]));

		const diagnostics = await getComputedDiagnostics(store, doc, workspace);
		assertDiagnosticsEqual(diagnostics, [
			makeRange(1, 11, 1, 18),
		]);
	}));

	test('Reference links should be case insensitive', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('doc.md'), joinLines(
			`[good link][GoOd]`,
			``,
			`[gOoD]: http://example.com`,
		));
		const workspace = store.add(new InMemoryWorkspace([doc]));

		const diagnostics = await getComputedDiagnostics(store, doc, workspace);
		assertDiagnosticsEqual(diagnostics, []);
	}));

	test('Should not generate diagnostics for email autolink', withStore(async (store) => {
		const doc1 = new InMemoryDocument(workspacePath('doc1.md'), joinLines(
			`a <user@example.com> c`,
		));

		const diagnostics = await getComputedDiagnostics(store, doc1, new InMemoryWorkspace([doc1]));
		assertDiagnosticsEqual(diagnostics, []);
	}));

	test('Should not generate diagnostics for html tag that looks like an autolink', withStore(async (store) => {
		const doc1 = new InMemoryDocument(workspacePath('doc1.md'), joinLines(
			`a <tag>b</tag> c`,
			`a <scope:tag>b</scope:tag> c`,
		));

		const diagnostics = await getComputedDiagnostics(store, doc1, new InMemoryWorkspace([doc1]));
		assertDiagnosticsEqual(diagnostics, []);
	}));

	test('Should allow ignoring invalid file link using glob', withStore(async (store) => {
		const doc1 = new InMemoryDocument(workspacePath('doc1.md'), joinLines(
			`[text](/no-such-file)`,
			`![img](/no-such-file)`,
			`[text]: /no-such-file`,
		));
		const workspace = store.add(new InMemoryWorkspace([doc1]));
		const diagnostics = await getComputedDiagnostics(store, doc1, workspace, { ignoreLinks: ['/no-such-file'], validateUnusedLinkDefinitions: DiagnosticLevel.ignore });
		assertDiagnosticsEqual(diagnostics, []);
	}));

	test('Should be able to disable fragment validation for external files', withStore(async (store) => {
		const doc1 = new InMemoryDocument(workspacePath('doc1.md'), joinLines(
			`![i](/doc2.md#no-such)`,
		));
		const doc2 = new InMemoryDocument(workspacePath('doc2.md'), joinLines(''));
		const workspace = new InMemoryWorkspace([doc1, doc2]);

		const diagnostics = await getComputedDiagnostics(store, doc1, workspace, { validateMarkdownFileLinkFragments: DiagnosticLevel.ignore });
		assertDiagnosticsEqual(diagnostics, []);
	}));

	test('Disabling own fragment validation should also disable path fragment validation by default', withStore(async (store) => {
		const doc1 = new InMemoryDocument(workspacePath('doc1.md'), joinLines(
			`[b](#no-head)`,
			`![i](/doc2.md#no-such)`,
		));
		const doc2 = new InMemoryDocument(workspacePath('doc2.md'), joinLines(''));
		const workspace = new InMemoryWorkspace([doc1, doc2]);

		{
			const diagnostics = await getComputedDiagnostics(store, doc1, workspace, { validateFragmentLinks: DiagnosticLevel.ignore });
			assertDiagnosticsEqual(diagnostics, []);
		}
		{
			// But we should be able to override the default
			const diagnostics = await getComputedDiagnostics(store, doc1, workspace, { validateFragmentLinks: DiagnosticLevel.ignore, validateMarkdownFileLinkFragments: DiagnosticLevel.warning });
			assertDiagnosticsEqual(diagnostics, [
				makeRange(1, 13, 1, 21),
			]);
		}
	}));

	test('ignoreLinks should allow skipping link to non-existent file', withStore(async (store) => {
		const doc1 = new InMemoryDocument(workspacePath('doc1.md'), joinLines(
			`[text](/no-such-file#header)`,
		));
		const workspace = store.add(new InMemoryWorkspace([doc1]));

		const diagnostics = await getComputedDiagnostics(store, doc1, workspace, { ignoreLinks: ['/no-such-file'] });
		assertDiagnosticsEqual(diagnostics, []);
	}));

	test('ignoreLinks should not consider link fragment', withStore(async (store) => {
		const doc1 = new InMemoryDocument(workspacePath('doc1.md'), joinLines(
			`[text](/no-such-file#header)`,
		));
		const workspace = store.add(new InMemoryWorkspace([doc1]));

		const diagnostics = await getComputedDiagnostics(store, doc1, workspace, { ignoreLinks: ['/no-such-file'] });
		assertDiagnosticsEqual(diagnostics, []);
	}));

	test('ignoreLinks should support globs', withStore(async (store) => {
		const doc1 = new InMemoryDocument(workspacePath('doc1.md'), joinLines(
			`![i](/images/aaa.png)`,
			`![i](/images/sub/bbb.png)`,
			`![i](/images/sub/sub2/ccc.png)`,
		));
		const workspace = store.add(new InMemoryWorkspace([doc1]));

		const diagnostics = await getComputedDiagnostics(store, doc1, workspace, { ignoreLinks: ['/images/**/*.png'] });
		assertDiagnosticsEqual(diagnostics, []);
	}));

	test('ignoreLinks should support ignoring header', withStore(async (store) => {
		const doc1 = new InMemoryDocument(workspacePath('doc1.md'), joinLines(
			`![i](#no-such)`,
		));
		const workspace = store.add(new InMemoryWorkspace([doc1]));

		const diagnostics = await getComputedDiagnostics(store, doc1, workspace, { ignoreLinks: ['#no-such'] });
		assertDiagnosticsEqual(diagnostics, []);
	}));

	test('ignoreLinks should support ignoring header in file', withStore(async (store) => {
		const doc1 = new InMemoryDocument(workspacePath('doc1.md'), joinLines(
			`![i](/doc2.md#no-such)`,
		));
		const doc2 = new InMemoryDocument(workspacePath('doc2.md'), joinLines(''));
		const workspace = store.add(new InMemoryWorkspace([doc1, doc2]));

		{
			const diagnostics = await getComputedDiagnostics(store, doc1, workspace, { ignoreLinks: ['/doc2.md#no-such'] });
			assertDiagnosticsEqual(diagnostics, []);
		}
		{
			const diagnostics = await getComputedDiagnostics(store, doc1, workspace, { ignoreLinks: ['/doc2.md#*'] });
			assertDiagnosticsEqual(diagnostics, []);
		}
	}));

	test('ignoreLinks should support ignore header links if file is ignored', withStore(async (store) => {
		const doc1 = new InMemoryDocument(workspacePath('doc1.md'), joinLines(
			`![i](/doc2.md#no-such)`,
		));
		const doc2 = new InMemoryDocument(workspacePath('doc2.md'), joinLines(''));
		const workspace = new InMemoryWorkspace([doc1, doc2]);

		const diagnostics = await getComputedDiagnostics(store, doc1, workspace, { ignoreLinks: ['/doc2.md'] });
		assertDiagnosticsEqual(diagnostics, []);
	}));

	test('Should not detect checkboxes as invalid links', withStore(async (store) => {
		const doc1 = new InMemoryDocument(workspacePath('doc1.md'), joinLines(
			`- [x]`,
			`- [X]`,
			`- [ ]`,
			``,
			`* [x]`,
			`* [X]`,
			`* [ ]`,
			``,
			`+ [x]`,
			`+ [X]`,
			`+ [ ]`,
		));
		const workspace = store.add(new InMemoryWorkspace([doc1]));

		const diagnostics = await getComputedDiagnostics(store, doc1, workspace, { ignoreLinks: ['/doc2.md'] });
		assertDiagnosticsEqual(diagnostics, []);
	}));

	test('Should detect invalid links with titles', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('doc1.md'), joinLines(
			`[link](<no such.md> "text")`,
			`[link](<no such.md> 'text')`,
			`[link](<no such.md> (text))`,
			`[link](no-such.md "text")`,
			`[link](no-such.md 'text')`,
			`[link](no-such.md (text))`,
		));
		const workspace = store.add(new InMemoryWorkspace([doc]));

		const diagnostics = await getComputedDiagnostics(store, doc, workspace);
		assertDiagnosticsEqual(diagnostics, [
			makeRange(0, 8, 0, 18),
			makeRange(1, 8, 1, 18),
			makeRange(2, 8, 2, 18),
			makeRange(3, 7, 3, 17),
			makeRange(4, 7, 4, 17),
			makeRange(5, 7, 5, 17),
		]);
	}));

	test('Should generate diagnostics for non-existent header using file link to own file', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('sub', 'doc.md'), joinLines(
			`[bad](doc.md#no-such)`,
			`[bad](doc#no-such)`,
			`[bad](/sub/doc.md#no-such)`,
			`[bad](/sub/doc#no-such)`,
		));
		const workspace = store.add(new InMemoryWorkspace([doc]));

		const diagnostics = await getComputedDiagnostics(store, doc, workspace);
		assertDiagnosticsEqual(orderDiagnosticsByRange(diagnostics), [
			makeRange(0, 12, 0, 20),
			makeRange(1, 9, 1, 17),
			makeRange(2, 17, 2, 25),
			makeRange(3, 14, 3, 22),
		]);
	}));

	test('Own header link using file path link should be controlled by "validateMarkdownFileLinkFragments" instead of "validateFragmentLinks"', withStore(async (store) => {
		const doc1 = new InMemoryDocument(workspacePath('sub', 'doc.md'), joinLines(
			`[bad](doc.md#no-such)`,
			`[bad](doc#no-such)`,
			`[bad](/sub/doc.md#no-such)`,
			`[bad](/sub/doc#no-such)`,
		));
		const workspace = store.add(new InMemoryWorkspace([doc1]));

		const diagnostics = await getComputedDiagnostics(store, doc1, workspace, {
			validateFragmentLinks: DiagnosticLevel.ignore,
			validateMarkdownFileLinkFragments: DiagnosticLevel.warning,
		});
		assertDiagnosticsEqual(orderDiagnosticsByRange(diagnostics), [
			makeRange(0, 12, 0, 20),
			makeRange(1, 9, 1, 17),
			makeRange(2, 17, 2, 25),
			makeRange(3, 14, 3, 22),
		]);
	}));

	test('Should use filename without brackets for bracketed link', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('doc1.md'), joinLines(
			`[link](<no such.md>)`,
			``,
			`[def]: <no such.md>`,
		));
		const workspace = store.add(new InMemoryWorkspace([doc]));

		const diagnostics = await getComputedDiagnostics(store, doc, workspace, { validateUnusedLinkDefinitions: DiagnosticLevel.ignore });
		assertDiagnosticsEqual(diagnostics, [
			makeRange(0, 8, 0, 18),
			makeRange(2, 8, 2, 18),
		]);

		const [diag1, diag2] = diagnostics;
		assert.strictEqual(diag1.data.fsPath, workspacePath('no such.md').fsPath);
		assert.strictEqual(diag2.data.fsPath, workspacePath('no such.md').fsPath);
	}));

	test('Should not validate line number links', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('doc1.md'), joinLines(
			`[link](#L1)`,
			`[link](doc1.md#L1)`,
			`[link](#L1,2)`,
			`[link](doc1.md#L1,2)`,
		));
		const workspace = store.add(new InMemoryWorkspace([doc]));

		const diagnostics = await getComputedDiagnostics(store, doc, workspace);
		assertDiagnosticsEqual(diagnostics, []);
	}));

	test('Should generate diagnostics for unused link definitions', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('doc.md'), joinLines(
			`[ref]`,
			`text`,
			`[ref]: http://example.com`,
			`[bad-ref]: http://example.com`,
			`text`,
			`[bad-ref2]: http://example.com`,
		));
		const workspace = store.add(new InMemoryWorkspace([doc]));

		const diagnostics = await getComputedDiagnostics(store, doc, workspace);
		assertDiagnosticsEqual(diagnostics, [
			makeRange(3, 0, 3, 29),
			makeRange(5, 0, 5, 30),
		]);
	}));

	test('Unused link definition diagnostic should span title', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('doc.md'), joinLines(
			`[unused]: http://example.com "title"`,
		));
		const workspace = store.add(new InMemoryWorkspace([doc]));

		const diagnostics = await getComputedDiagnostics(store, doc, workspace);
		assertDiagnosticsEqual(diagnostics, [
			makeRange(0, 0, 0, 36),
		]);
	}));

	test('Should generate diagnostics for duplicate link definitions', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('doc.md'), joinLines(
			`[def]: http://example.com`,
			`[other]: http://example.com`,
			`[def]: http://example.com/other`,
		));
		const workspace = store.add(new InMemoryWorkspace([doc]));

		const diagnostics = await getComputedDiagnostics(store, doc, workspace, { validateUnusedLinkDefinitions: DiagnosticLevel.ignore });
		assertDiagnosticsEqual(diagnostics, [
			makeRange(0, 1, 0, 4),
			makeRange(2, 1, 2, 4),
		]);
	}));

	test('Should not mark image reference as unused (#131)', withStore(async (store) => {
		const docUri = workspacePath('doc.md');
		const doc = new InMemoryDocument(docUri, joinLines(
			`text`,
			``,
			`![][cat]`,
			``,
			`[cat]: https://example.com/cat.png`,
		));

		const workspace = store.add(new InMemoryWorkspace([doc]));

		const diagnostics = await getComputedDiagnostics(store, doc, workspace, {});
		assertDiagnosticsEqual(diagnostics, []);
	}));

	test('Should detect reference link shorthand with nested brackets', withStore(async (store) => {
		const docUri = workspacePath('doc.md');
		const doc = new InMemoryDocument(docUri, joinLines(
			`[[test]]`,
			``,
			`[test]: http://example.com`,
		));

		const workspace = store.add(new InMemoryWorkspace([doc]));

		const diagnostics = await getComputedDiagnostics(store, doc, workspace, {});
		assertDiagnosticsEqual(diagnostics, []);
	}));

	test('Should detect reference links shorthand with escaped brackets', withStore(async (store) => {
		const docUri = workspacePath('doc.md');
		const doc = new InMemoryDocument(docUri, joinLines(
			String.raw`[abc][\[test\]]`,
			String.raw`[\[test\]][]`,
			String.raw`[\[test\]]`,
			String.raw``,
			String.raw`[\[test\]]: http://example.com`,
		));

		const workspace = store.add(new InMemoryWorkspace([doc]));

		const diagnostics = await getComputedDiagnostics(store, doc, workspace, {});
		assertDiagnosticsEqual(diagnostics, []);
	}));

	test(`Should handle file names with '%' in the name`, withStore(async (store) => {
		const doc1 = new InMemoryDocument(workspacePath('doc1.md'), joinLines(
			`[i](/a%20b.md)`, // These should fail since the file will be resolved to 'a b.md'
			`[i](a%20b.md)`,
			`[i](./a%20b.md)`,
			`[i](/a%2520b.md)`, // These should be resolved
			`[i](a%2520b.md)`,
			`[i](./a%2520b.md)`,
			`[i](<a b.md>)`, // This should also fail due since space should not resolve to a file name '%20'
		));
		const doc2 = new InMemoryDocument(workspacePath('a%20b.md'), joinLines(''));
		const workspace = store.add(new InMemoryWorkspace([doc1, doc2]));

		const diagnostics = await getComputedDiagnostics(store, doc1, workspace, {});
		assertDiagnosticsEqual(diagnostics, [
			makeRange(0, 4, 0, 13),
			makeRange(1, 4, 1, 12),
			makeRange(2, 4, 2, 14),
			makeRange(6, 5, 6, 11),
		]);
	}));

	test('Should not detect errors in inline code (#153)', withStore(async (store) => {
		const docUri = workspacePath('doc.md');
		const doc = new InMemoryDocument(docUri, joinLines(
			'- `[!xyz].js` `ab.js` `[^xyz].js` `[!x-z].js`。',
		));

		const workspace = store.add(new InMemoryWorkspace([doc]));

		const diagnostics = await getComputedDiagnostics(store, doc, workspace, {});
		assertDiagnosticsEqual(diagnostics, []);
	}));
});


suite('Diagnostic Manager', () => {
	function createManager(store: DisposableStore, workspace: InMemoryWorkspace) {
		const engine = createNewMarkdownEngine();
		const config = getLsConfiguration({});
		const tocProvider = store.add(new MdTableOfContentsProvider(engine, workspace, nulLogger));
		const linkProvider = store.add(new MdLinkProvider(config, engine, workspace, tocProvider, nulLogger));
		return store.add(new DiagnosticsManager(config, workspace, linkProvider, tocProvider, nulLogger));
	}

	test('Should not re-stat files on simple edits', withStore(async (store) => {
		const doc1 = new InMemoryDocument(workspacePath('doc1.md'), joinLines(
			`![i](/nosuch.png)`,
			`[ref]`,
		));
		const workspace = new InMemoryWorkspace([doc1]);

		const manager = createManager(store, workspace);
		const options = getDiagnosticsOptions({});

		const firstRequest = await manager.computeDiagnostics(doc1, options, noopToken);
		assertDiagnosticsEqual(firstRequest as lsp.Diagnostic[], [
			makeRange(0, 5, 0, 16),
			makeRange(1, 1, 1, 4),
		]);
		assert.strictEqual(workspace.statCallList.length, 1);

		await manager.computeDiagnostics(doc1, options, noopToken);
		assert.strictEqual(workspace.statCallList.length, 1);

		// Edit doc
		doc1.updateContent(joinLines(
			`![i](/nosuch.png)`,
			`[ref]`,
			`[ref]: http://example.com`
		));
		workspace.updateDocument(doc1);

		const thirdRequest = await manager.computeDiagnostics(doc1, options, noopToken);
		assertDiagnosticsEqual(thirdRequest as lsp.Diagnostic[], [
			makeRange(0, 5, 0, 16),
		]);

		await manager.computeDiagnostics(doc1, options, noopToken);
		// The file hasn't changed so we should not have re-stated it
		assert.strictEqual(workspace.statCallList.length, 1);
	}));

	test(`File delete should revalidate diagnostics`, withStore(async (store) => {
		const otherUri = workspacePath('other.png');
		const doc1 = new InMemoryDocument(workspacePath('doc.md'), joinLines(
			`![i](/other.png)`,
		));
		const workspace = new InMemoryWorkspace([doc1, otherUri]);

		const manager = createManager(store, workspace);
		const options = getDiagnosticsOptions({});

		const firstRequest = await manager.computeDiagnostics(doc1, options, noopToken);
		assertDiagnosticsEqual(firstRequest as lsp.Diagnostic[], []);

		// Trigger watcher change
		workspace.triggerFileDelete(otherUri);

		const thirdRequest = await manager.computeDiagnostics(doc1, options, noopToken);
		assertDiagnosticsEqual(thirdRequest as lsp.Diagnostic[], [
			makeRange(0, 5, 0, 15),
		]);
	}));

	test('Should support links both with and without .md file extension (with dot in file name, #153094)', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('doc.test.md'), joinLines(
			`# My header`,
			`[good](#my-header)`,
			`[good](/doc.test.md#my-header)`,
			`[good](doc.test.md#my-header)`,
			`[good](/doc.test#my-header)`,
			`[good](doc.test#my-header)`,
		));

		const workspace = store.add(new InMemoryWorkspace([doc]));

		const diagnostics = await getComputedDiagnostics(store, doc, workspace);
		assertDiagnosticsEqual(diagnostics, []);
	}));

	test(`Should resolve '/' relative to longest workspace root in multiroot workspace`, withStore(async (store) => {
		const docUri = workspacePath('doc.md');
		const doc = new InMemoryDocument(docUri, joinLines(
			`![img](/sub/img.png)`
		));

		const subDocUri = workspacePath('sub', 'doc.md');
		const subDoc = new InMemoryDocument(subDocUri, joinLines(
			`![img](/img.png)`
		));
		const workspace = store.add(new InMemoryWorkspace(
			[doc, subDoc, workspacePath('sub', 'img.png')],
			{ roots: [workspaceRoot, workspacePath('sub')] },
		));

		{
			const diagnostics = await getComputedDiagnostics(store, doc, workspace);
			assertDiagnosticsEqual(diagnostics, []);
		}
		{
			const diagnostics = await getComputedDiagnostics(store, subDoc, workspace);
			assertDiagnosticsEqual(diagnostics, []);
		}
	}));

	test('Should treat fragment links to self as marking file as existing', withStore(async (store) => {
		// Here we create a document that references itself using a link
		const doc1 = new InMemoryDocument(workspacePath('doc1.md'), joinLines(
			`# header`,
			`[link](#header)`
		));
		const workspace = new InMemoryWorkspace([doc1]);

		const manager = createManager(store, workspace);
		const options = getDiagnosticsOptions({});

		const firstRequest = await manager.computeDiagnostics(doc1, options, noopToken);
		assertDiagnosticsEqual(firstRequest as lsp.Diagnostic[], []);
		assert.strictEqual(workspace.statCallList.length, 0);

		// Now we open a second document that links to the first
		const doc2 = new InMemoryDocument(workspacePath('doc2.md'), joinLines(
			`[text](./doc1.md#header)`
		));
		workspace.createDocument(doc2);

		const secondRequest = await manager.computeDiagnostics(doc2, options, noopToken);
		assertDiagnosticsEqual(secondRequest as lsp.Diagnostic[], []);
		assert.strictEqual(workspace.statCallList.length, 0);
	}));
});
