/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as lsp from 'vscode-languageserver-protocol';
import { URI } from 'vscode-uri';
import { getLsConfiguration } from '../config';
import { createWorkspaceLinkCache } from '../languageFeatures/documentLinks';
import { MdReferencesProvider } from '../languageFeatures/references';
import { MdRenameProvider } from '../languageFeatures/rename';
import { githubSlugifier } from '../slugify';
import { MdTableOfContentsProvider } from '../tableOfContents';
import { InMemoryDocument } from '../types/inMemoryDocument';
import { makeRange } from '../types/range';
import { noopToken } from '../util/cancellation';
import { DisposableStore } from '../util/dispose';
import { IWorkspace } from '../workspace';
import { createNewMarkdownEngine } from './engine';
import { InMemoryWorkspace } from './inMemoryWorkspace';
import { nulLogger } from './nulLogging';
import { assertRangeEqual, joinLines, withStore, workspacePath } from './util';


/**
 * Get prepare rename info.
 */
function prepareRename(store: DisposableStore, doc: InMemoryDocument, pos: lsp.Position, workspace: IWorkspace): Promise<undefined | { readonly range: lsp.Range; readonly placeholder: string }> {
	const config = getLsConfiguration({});
	const engine = createNewMarkdownEngine();
	const tocProvider = store.add(new MdTableOfContentsProvider(engine, workspace, nulLogger));
	const linkCache = store.add(createWorkspaceLinkCache(engine, workspace));
	const referenceComputer = store.add(new MdReferencesProvider(config, engine, workspace, tocProvider, linkCache, nulLogger));
	const renameProvider = store.add(new MdRenameProvider(config, workspace, engine, referenceComputer, tocProvider, githubSlugifier, nulLogger));
	return renameProvider.prepareRename(doc, pos, noopToken);
}

/**
 * Get all the edits for the rename.
 */
function getRenameEdits(store: DisposableStore, doc: InMemoryDocument, pos: lsp.Position, newName: string, workspace: IWorkspace): Promise<lsp.WorkspaceEdit | undefined> {
	const config = getLsConfiguration({});
	const engine = createNewMarkdownEngine();
	const tocProvider = store.add(new MdTableOfContentsProvider(engine, workspace, nulLogger));
	const linkCache = store.add(createWorkspaceLinkCache(engine, workspace));
	const referencesProvider = store.add(new MdReferencesProvider(config, engine, workspace, tocProvider, linkCache, nulLogger));
	const renameProvider = store.add(new MdRenameProvider(config, workspace, engine, referencesProvider, tocProvider, githubSlugifier, nulLogger));
	return renameProvider.provideRenameEdits(doc, pos, newName, noopToken);
}

interface ExpectedTextEdit {
	readonly uri: URI;
	readonly edits: readonly lsp.TextEdit[];
}

interface ExpectedFileRename {
	readonly originalUri: URI;
	readonly newUri: URI;
}

function assertEditsEqual(actualEdit: lsp.WorkspaceEdit, ...expectedEdits: ReadonlyArray<ExpectedTextEdit | ExpectedFileRename>) {
	// Check file renames
	const expectedFileRenames = expectedEdits.filter(expected => 'originalUri' in expected) as ExpectedFileRename[];
	const actualFileRenames = actualEdit.documentChanges?.filter(edit => lsp.RenameFile.is(edit)) as lsp.RenameFile[] ?? [];
	assert.strictEqual(actualFileRenames.length, expectedFileRenames.length, `File rename count should match`);
	for (let i = 0; i < actualFileRenames.length; ++i) {
		const expected = expectedFileRenames[i];
		const actual = actualFileRenames[i];
		assert.strictEqual(actual.oldUri.toString(), expected.originalUri.toString(), `File rename '${i}' should have expected 'from' resource`);
		assert.strictEqual(actual.newUri.toString(), expected.newUri.toString(), `File rename '${i}' should have expected 'to' resource`);
	}

	// Check text edits
	const actualTextEdits = actualEdit.documentChanges?.filter(edit => lsp.TextDocumentEdit.is(edit)) as lsp.TextDocumentEdit[] ?? [];
	const expectedTextEdits = expectedEdits.filter(expected => 'edits' in expected) as ExpectedTextEdit[];
	assert.strictEqual(actualTextEdits.length, expectedTextEdits.length, `Reference counts should match`);
	for (let i = 0; i < actualTextEdits.length; ++i) {
		const expected = expectedTextEdits[i];
		const actual = actualTextEdits[i];

		if ('edits' in expected) {
			const actualDoc = actual.textDocument.uri;
			assert.strictEqual(actualDoc, expected.uri.toString(), `Ref '${i}' has expected document`);

			const actualEditForDoc = actual.edits;
			const expectedEditsForDoc = expected.edits;
			assert.strictEqual(actualEditForDoc.length, expectedEditsForDoc.length, `Edit counts for '${actualDoc}' should match`);

			for (let g = 0; g < actualEditForDoc.length; ++g) {
				assertRangeEqual(actualEditForDoc[g].range, expectedEditsForDoc[g].range, `Edit '${g}' of '${actualDoc}' has expected expected range. Expected range: ${JSON.stringify(actualEditForDoc[g].range)}. Actual range: ${JSON.stringify(expectedEditsForDoc[g].range)}`);
				assert.strictEqual(actualEditForDoc[g].newText, expectedEditsForDoc[g].newText, `Edit '${g}' of '${actualDoc}' has expected edits`);
			}
		}
	}
}

suite('Rename', () => {

	suite('Header rename', () => {

		test('Rename on header should not include leading #', withStore(async (store) => {
			const uri = workspacePath('doc.md');
			const doc = new InMemoryDocument(uri, joinLines(
				`# abc`
			));
			const workspace = store.add(new InMemoryWorkspace([doc]));

			const info = await prepareRename(store, doc, { line: 0, character: 0 }, workspace);
			assertRangeEqual(info!.range, makeRange(0, 2, 0, 5));

			const edit = await getRenameEdits(store, doc, { line: 0, character: 0 }, 'New Header', workspace);
			assertEditsEqual(edit!, {
				uri, edits: [
					lsp.TextEdit.replace(makeRange(0, 2, 0, 5), 'New Header')
				]
			});
		}));

		test('Rename on header should include leading or trailing #s', withStore(async (store) => {
			const uri = workspacePath('doc.md');
			const doc = new InMemoryDocument(uri, joinLines(
				`### abc ###`
			));

			const workspace = store.add(new InMemoryWorkspace([doc]));

			const info = await prepareRename(store, doc, { line: 0, character: 0 }, workspace);
			assertRangeEqual(info!.range, makeRange(0, 4, 0, 7));

			const edit = await getRenameEdits(store, doc, { line: 0, character: 0 }, 'New Header', workspace);
			assertEditsEqual(edit!, {
				uri, edits: [
					lsp.TextEdit.replace(makeRange(0, 4, 0, 7), 'New Header')
				]
			});
		}));

		test('Rename on header should pick up links in doc', withStore(async (store) => {
			const uri = workspacePath('doc.md');
			const doc = new InMemoryDocument(uri, joinLines(
				`### A b C`, // rename here
				`[text](#a-b-c)`,
			));

			const workspace = store.add(new InMemoryWorkspace([doc]));
			const edit = await getRenameEdits(store, doc, { line: 0, character: 0 }, 'New Header', workspace);
			assertEditsEqual(edit!, {
				uri, edits: [
					lsp.TextEdit.replace(makeRange(0, 4, 0, 9), 'New Header'),
					lsp.TextEdit.replace(makeRange(1, 8, 1, 13), 'new-header'),
				]
			});
		}));

		test('Rename on link should use slug for link', withStore(async (store) => {
			const uri = workspacePath('doc.md');
			const doc = new InMemoryDocument(uri, joinLines(
				`### A b C`,
				`[text](#a-b-c)`, // rename here
			));

			const workspace = store.add(new InMemoryWorkspace([doc]));
			const edit = await getRenameEdits(store, doc, { line: 1, character: 10 }, 'New Header', workspace);
			assertEditsEqual(edit!, {
				uri, edits: [
					lsp.TextEdit.replace(makeRange(0, 4, 0, 9), 'New Header'),
					lsp.TextEdit.replace(makeRange(1, 8, 1, 13), 'new-header'),
				]
			});
		}));

		test('Rename on link definition should work', withStore(async (store) => {
			const uri = workspacePath('doc.md');
			const doc = new InMemoryDocument(uri, joinLines(
				`### A b C`,
				`[text](#a-b-c)`,
				`[ref]: #a-b-c`// rename here
			));

			const workspace = store.add(new InMemoryWorkspace([doc]));
			const edit = await getRenameEdits(store, doc, { line: 2, character: 10 }, 'New Header', workspace);
			assertEditsEqual(edit!, {
				uri, edits: [
					lsp.TextEdit.replace(makeRange(0, 4, 0, 9), 'New Header'),
					lsp.TextEdit.replace(makeRange(1, 8, 1, 13), 'new-header'),
					lsp.TextEdit.replace(makeRange(2, 8, 2, 13), 'new-header'),
				]
			});
		}));

		test('Rename on header should pick up links across files', withStore(async (store) => {
			const uri = workspacePath('doc.md');
			const otherUri = workspacePath('other.md');
			const doc = new InMemoryDocument(uri, joinLines(
				`### A b C`, // rename here
				`[text](#a-b-c)`,
			));

			const edit = await getRenameEdits(store, doc, { line: 0, character: 0 }, 'New Header', new InMemoryWorkspace([
				doc,
				new InMemoryDocument(otherUri, joinLines(
					`[text](#a-b-c)`, // Should not find this
					`[text](./doc.md#a-b-c)`, // But should find this
					`[text](./doc#a-b-c)`, // And this
				))
			]));
			assertEditsEqual(edit!, {
				uri: uri, edits: [
					lsp.TextEdit.replace(makeRange(0, 4, 0, 9), 'New Header'),
					lsp.TextEdit.replace(makeRange(1, 8, 1, 13), 'new-header'),
				]
			}, {
				uri: otherUri, edits: [
					lsp.TextEdit.replace(makeRange(1, 16, 1, 21), 'new-header'),
					lsp.TextEdit.replace(makeRange(2, 13, 2, 18), 'new-header'),
				]
			});
		}));

		test('Rename on link should pick up links across files', withStore(async (store) => {
			const uri = workspacePath('doc.md');
			const otherUri = workspacePath('other.md');
			const doc = new InMemoryDocument(uri, joinLines(
				`### A b C`,
				`[text](#a-b-c)`,  // rename here
			));

			const edit = await getRenameEdits(store, doc, { line: 1, character: 10 }, 'New Header', new InMemoryWorkspace([
				doc,
				new InMemoryDocument(otherUri, joinLines(
					`[text](#a-b-c)`, // Should not find this
					`[text](./doc.md#a-b-c)`, // But should find this
					`[text](./doc#a-b-c)`, // And this
				))
			]));
			assertEditsEqual(edit!, {
				uri: uri, edits: [
					lsp.TextEdit.replace(makeRange(0, 4, 0, 9), 'New Header'),
					lsp.TextEdit.replace(makeRange(1, 8, 1, 13), 'new-header'),
				]
			}, {
				uri: otherUri, edits: [
					lsp.TextEdit.replace(makeRange(1, 16, 1, 21), 'new-header'),
					lsp.TextEdit.replace(makeRange(2, 13, 2, 18), 'new-header'),
				]
			});
		}));

		test('Rename on link in other file should pick up all refs', withStore(async (store) => {
			const uri = workspacePath('doc.md');
			const otherUri = workspacePath('other.md');
			const doc = new InMemoryDocument(uri, joinLines(
				`### A b C`,
				`[text](#a-b-c)`,
			));

			const otherDoc = new InMemoryDocument(otherUri, joinLines(
				`[text](#a-b-c)`,
				`[text](./doc.md#a-b-c)`,
				`[text](./doc#a-b-c)`
			));

			const expectedEdits = [
				{
					uri: uri, edits: [
						lsp.TextEdit.replace(makeRange(0, 4, 0, 9), 'New Header'),
						lsp.TextEdit.replace(makeRange(1, 8, 1, 13), 'new-header'),
					]
				}, {
					uri: otherUri, edits: [
						lsp.TextEdit.replace(makeRange(1, 16, 1, 21), 'new-header'),
						lsp.TextEdit.replace(makeRange(2, 13, 2, 18), 'new-header'),
					]
				}
			];

			{
				// Rename on header with file extension
				const edit = await getRenameEdits(store, otherDoc, { line: 1, character: 17 }, 'New Header', new InMemoryWorkspace([
					doc,
					otherDoc
				]));
				assertEditsEqual(edit!, ...expectedEdits);
			}
			{
				// Rename on header without extension
				const edit = await getRenameEdits(store, otherDoc, { line: 2, character: 15 }, 'New Header', new InMemoryWorkspace([
					doc,
					otherDoc
				]));
				assertEditsEqual(edit!, ...expectedEdits);
			}
		}));

		test('Rename on header should rename html tags', withStore(async (store) => {
			const uri = workspacePath('doc.md');
			const doc = new InMemoryDocument(uri, joinLines(
				`### A b C`, // rename here
				`<a href="#a-b-c">text</a>`,
			));

			const workspace = store.add(new InMemoryWorkspace([doc]));
			const edit = await getRenameEdits(store, doc, { line: 0, character: 0 }, 'New Header', workspace);
			assertEditsEqual(edit!, {
				uri, edits: [
					lsp.TextEdit.replace(makeRange(0, 4, 0, 9), 'New Header'),
					lsp.TextEdit.replace(makeRange(1, 10, 1, 15), 'new-header'),
				]
			});
		}));

		test('Rename should add unique id when new name duplicates existing header', withStore(async (store) => {
			const uri = workspacePath('doc.md');
			const doc = new InMemoryDocument(uri, joinLines(
				`# header a`,
				`# header b`,
				`# header a`,
				`[h1](#header-a)`,
				`[h1](#header-b)`,
				`[h1](#header-a-1)`,
			));

			const workspace = store.add(new InMemoryWorkspace([doc]));
			{
				const edit = await getRenameEdits(store, doc, { line: 1, character: 0 }, 'header a', workspace);
				assertEditsEqual(edit!, {
					uri, edits: [
						// Update link to duplicated header after new header 
						lsp.TextEdit.replace(makeRange(5, 6, 5, 16), 'header-a-2'),

						// And the header itself
						lsp.TextEdit.replace(makeRange(1, 2, 1, 10), 'header a'),
						lsp.TextEdit.replace(makeRange(4, 6, 4, 14), 'header-a-1'),

					]
				});
			}
		}));

		test('Rename should remove ids when renaming duplicated header to new name', withStore(async (store) => {
			const uri = workspacePath('doc.md');
			const doc = new InMemoryDocument(uri, joinLines(
				`# header`,
				`# header`,
				`[h1](#header)`,
				`[h1](#header-1)`
			));

			const workspace = store.add(new InMemoryWorkspace([doc]));
			const edit = await getRenameEdits(store, doc, { line: 0, character: 0 }, 'New Header', workspace);
			assertEditsEqual(edit!, {
				uri, edits: [
					// Update previously duplicated header
					lsp.TextEdit.replace(makeRange(3, 6, 3, 14), 'header'),

					// And main header
					lsp.TextEdit.replace(makeRange(0, 2, 0, 8), 'New Header'),
					lsp.TextEdit.replace(makeRange(2, 6, 2, 12), 'new-header'),
				]
			});
		}));
	});

	suite('Reference rename', () => {
		test('Rename on reference should rename references and definition', withStore(async (store) => {
			const uri = workspacePath('doc.md');
			const doc = new InMemoryDocument(uri, joinLines(
				`[text][ref]`, // rename here
				`[other][ref]`,
				``,
				`[ref]: https://example.com`,
			));

			const workspace = store.add(new InMemoryWorkspace([doc]));
			const edit = await getRenameEdits(store, doc, { line: 0, character: 8 }, 'new ref', workspace);
			assertEditsEqual(edit!, {
				uri, edits: [
					lsp.TextEdit.replace(makeRange(0, 7, 0, 10), 'new ref'),
					lsp.TextEdit.replace(makeRange(1, 8, 1, 11), 'new ref'),
					lsp.TextEdit.replace(makeRange(3, 1, 3, 4), 'new ref'),
				]
			});
		}));

		test('Rename on definition should rename references and definitions', withStore(async (store) => {
			const uri = workspacePath('doc.md');
			const doc = new InMemoryDocument(uri, joinLines(
				`[text][ref]`,
				`[other][ref]`,
				``,
				`[ref]: https://example.com`, // rename here
			));

			const workspace = store.add(new InMemoryWorkspace([doc]));
			const edit = await getRenameEdits(store, doc, { line: 3, character: 3 }, 'new ref', workspace);
			assertEditsEqual(edit!, {
				uri, edits: [
					lsp.TextEdit.replace(makeRange(0, 7, 0, 10), 'new ref'),
					lsp.TextEdit.replace(makeRange(1, 8, 1, 11), 'new ref'),
					lsp.TextEdit.replace(makeRange(3, 1, 3, 4), 'new ref'),
				]
			});
		}));

		test('Rename on definition entry should rename header and references', withStore(async (store) => {
			const uri = workspacePath('doc.md');
			const doc = new InMemoryDocument(uri, joinLines(
				`# a B c`,
				`[ref text][ref]`,
				`[direct](#a-b-c)`,
				`[ref]: #a-b-c`, // rename here
			));
			const workspace = store.add(new InMemoryWorkspace([doc]));

			const preparedInfo = await prepareRename(store, doc, { line: 3, character: 10 }, workspace);
			assert.strictEqual(preparedInfo!.placeholder, 'a B c');
			assertRangeEqual(preparedInfo!.range, makeRange(3, 8, 3, 13));

			const edit = await getRenameEdits(store, doc, { line: 3, character: 10 }, 'x Y z', workspace);
			assertEditsEqual(edit!, {
				uri, edits: [
					lsp.TextEdit.replace(makeRange(0, 2, 0, 7), 'x Y z'),
					lsp.TextEdit.replace(makeRange(2, 10, 2, 15), 'x-y-z'),
					lsp.TextEdit.replace(makeRange(3, 8, 3, 13), 'x-y-z'),
				]
			});
		}));

		test('Rename should not be supported on link text', withStore(async (store) => {
			const uri = workspacePath('doc.md');
			const doc = new InMemoryDocument(uri, joinLines(
				`# Header`,
				`[text](#header)`,
			));
			const workspace = store.add(new InMemoryWorkspace([doc]));

			await assert.rejects(prepareRename(store, doc, { line: 1, character: 2 }, workspace));
		}));

		test('Path rename should use file path as range', withStore(async (store) => {
			const uri = workspacePath('doc.md');
			const doc = new InMemoryDocument(uri, joinLines(
				`[text](./doc.md)`,
				`[ref]: ./doc.md`,
			));
			const workspace = store.add(new InMemoryWorkspace([doc]));

			const info = await prepareRename(store, doc, { line: 0, character: 10 }, workspace);
			assert.strictEqual(info!.placeholder, './doc.md');
			assertRangeEqual(info!.range, makeRange(0, 7, 0, 15));
		}));

		test('Path rename\'s range should excludes fragment', withStore(async (store) => {
			const uri = workspacePath('doc.md');
			const doc = new InMemoryDocument(uri, joinLines(
				`[text](./doc.md#some-header)`,
				`[ref]: ./doc.md#some-header`,
			));
			const workspace = store.add(new InMemoryWorkspace([doc]));

			const info = await prepareRename(store, doc, { line: 0, character: 10 }, workspace);
			assert.strictEqual(info!.placeholder, './doc.md');
			assertRangeEqual(info!.range, makeRange(0, 7, 0, 15));
		}));

		test('Path rename should update file and all refs', withStore(async (store) => {
			const uri = workspacePath('doc.md');
			const doc = new InMemoryDocument(uri, joinLines(
				`[text](./doc.md)`,
				`[ref]: ./doc.md`,
			));
			const workspace = store.add(new InMemoryWorkspace([doc]));

			const edit = await getRenameEdits(store, doc, { line: 0, character: 10 }, './sub/newDoc.md', workspace);
			assertEditsEqual(edit!, {
				originalUri: uri,
				newUri: workspacePath('sub', 'newDoc.md'),
			}, {
				uri: uri, edits: [
					lsp.TextEdit.replace(makeRange(0, 7, 0, 15), './sub/newDoc.md'),
					lsp.TextEdit.replace(makeRange(1, 7, 1, 15), './sub/newDoc.md'),
				]
			});
		}));

		test('Path rename using absolute file path should anchor to workspace root', withStore(async (store) => {
			const uri = workspacePath('sub', 'doc.md');
			const doc = new InMemoryDocument(uri, joinLines(
				`[text](/sub/doc.md)`,
				`[ref]: /sub/doc.md`,
			));
			const workspace = store.add(new InMemoryWorkspace([doc]));

			const edit = await getRenameEdits(store, doc, { line: 0, character: 10 }, '/newSub/newDoc.md', workspace);
			assertEditsEqual(edit!, {
				originalUri: uri,
				newUri: workspacePath('newSub', 'newDoc.md'),
			}, {
				uri: uri, edits: [
					lsp.TextEdit.replace(makeRange(0, 7, 0, 18), '/newSub/newDoc.md'),
					lsp.TextEdit.replace(makeRange(1, 7, 1, 18), '/newSub/newDoc.md'),
				]
			});
		}));

		test('Path rename should use un-encoded paths as placeholder', withStore(async (store) => {
			const uri = workspacePath('sub', 'doc with spaces.md');
			const doc = new InMemoryDocument(uri, joinLines(
				`[text](/sub/doc%20with%20spaces.md)`,
			));
			const workspace = store.add(new InMemoryWorkspace([doc]));

			const info = await prepareRename(store, doc, { line: 0, character: 10 }, workspace);
			assert.strictEqual(info!.placeholder, '/sub/doc with spaces.md');
		}));

		test('Path rename should handle paths with spaces', withStore(async (store) => {
			const uri = workspacePath('sub', 'doc.md');
			const doc = new InMemoryDocument(uri, joinLines(
				`[text](/sub/doc.md)`,
				`[ref]: /sub/doc.md`,
			));
			const workspace = store.add(new InMemoryWorkspace([doc]));

			const edit = await getRenameEdits(store, doc, { line: 0, character: 10 }, '/NEW sub/new DOC.md', workspace);
			assertEditsEqual(edit!, {
				originalUri: uri,
				newUri: workspacePath('NEW sub', 'new DOC.md'),
			}, {
				uri: uri, edits: [
					lsp.TextEdit.replace(makeRange(0, 7, 0, 18), '</NEW sub/new DOC.md>'),
					lsp.TextEdit.replace(makeRange(1, 7, 1, 18), '</NEW sub/new DOC.md>'),
				]
			});
		}));

		test('Path rename should work with unknown files', withStore(async (store) => {
			const uri1 = workspacePath('doc1.md');
			const doc1 = new InMemoryDocument(uri1, joinLines(
				`![img](/images/more/image.png)`,
				``,
				`[ref]: /images/more/image.png`,
			));

			const uri2 = workspacePath('sub', 'doc2.md');
			const doc2 = new InMemoryDocument(uri2, joinLines(
				`![img](/images/more/image.png)`,
			));

			const workspace = store.add(new InMemoryWorkspace([
				doc1,
				doc2
			]));

			const edit = await getRenameEdits(store, doc1, { line: 0, character: 10 }, '/img/test/new.png', workspace);
			assertEditsEqual(edit!,
				// Should not have file edits since the files don't exist here
				{
					uri: uri1, edits: [
						lsp.TextEdit.replace(makeRange(0, 7, 0, 29), '/img/test/new.png'),
						lsp.TextEdit.replace(makeRange(2, 7, 2, 29), '/img/test/new.png'),
					]
				},
				{
					uri: uri2, edits: [
						lsp.TextEdit.replace(makeRange(0, 7, 0, 29), '/img/test/new.png'),
					]
				});
		}));

		test('Path rename should use .md extension on extension-less link', withStore(async (store) => {
			const uri = workspacePath('doc.md');
			const doc = new InMemoryDocument(uri, joinLines(
				`[text](/doc#header)`,
				`[ref]: /doc#other`,
			));
			const workspace = store.add(new InMemoryWorkspace([doc]));

			const edit = await getRenameEdits(store, doc, { line: 0, character: 10 }, '/new File', workspace);
			assertEditsEqual(edit!, {
				originalUri: uri,
				newUri: workspacePath('new File.md'), // Rename on disk should use file extension
			}, {
				uri: uri, edits: [
					lsp.TextEdit.replace(makeRange(0, 7, 0, 18), '</new File#header>'), // Links should continue to use extension-less paths
					lsp.TextEdit.replace(makeRange(1, 7, 1, 17), '</new File#other>'),
				]
			});
		}));

		// TODO: fails on windows
		test.skip('Path rename should use correctly resolved paths across files', withStore(async (store) => {
			const uri1 = workspacePath('sub', 'doc.md');
			const doc1 = new InMemoryDocument(uri1, joinLines(
				`[text](./doc.md)`,
				`[ref]: ./doc.md`,
			));

			const uri2 = workspacePath('doc2.md');
			const doc2 = new InMemoryDocument(uri2, joinLines(
				`[text](./sub/doc.md)`,
				`[ref]: ./sub/doc.md`,
			));

			const uri3 = workspacePath('sub2', 'doc3.md');
			const doc3 = new InMemoryDocument(uri3, joinLines(
				`[text](../sub/doc.md)`,
				`[ref]: ../sub/doc.md`,
			));

			const uri4 = workspacePath('sub2', 'doc4.md');
			const doc4 = new InMemoryDocument(uri4, joinLines(
				`[text](/sub/doc.md)`,
				`[ref]: /sub/doc.md`,
			));

			const workspace = store.add(new InMemoryWorkspace([
				doc1, doc2, doc3, doc4,
			]));

			const edit = await getRenameEdits(store, doc1, { line: 0, character: 10 }, './new/new-doc.md', workspace);
			assertEditsEqual(edit!, {
				originalUri: uri1,
				newUri: workspacePath('sub', 'new', 'new-doc.md'),
			}, {
				uri: uri1, edits: [
					lsp.TextEdit.replace(makeRange(0, 7, 0, 15), './new/new-doc.md'),
					lsp.TextEdit.replace(makeRange(1, 7, 1, 15), './new/new-doc.md'),
				]
			}, {
				uri: uri2, edits: [
					lsp.TextEdit.replace(makeRange(0, 7, 0, 19), './sub/new/new-doc.md'),
					lsp.TextEdit.replace(makeRange(1, 7, 1, 19), './sub/new/new-doc.md'),
				]
			}, {
				uri: uri3, edits: [
					lsp.TextEdit.replace(makeRange(0, 7, 0, 20), '../sub/new/new-doc.md'),
					lsp.TextEdit.replace(makeRange(1, 7, 1, 20), '../sub/new/new-doc.md'),
				]
			}, {
				uri: uri4, edits: [
					lsp.TextEdit.replace(makeRange(0, 7, 0, 18), '/sub/new/new-doc.md'),
					lsp.TextEdit.replace(makeRange(1, 7, 1, 18), '/sub/new/new-doc.md'),
				]
			});
		}));

		test('Path rename should resolve on links without prefix', withStore(async (store) => {
			const uri1 = workspacePath('sub', 'doc.md');
			const doc1 = new InMemoryDocument(uri1, joinLines(
				`![text](sub2/doc3.md)`,
			));

			const uri2 = workspacePath('doc2.md');
			const doc2 = new InMemoryDocument(uri2, joinLines(
				`![text](sub/sub2/doc3.md)`,
			));

			const uri3 = workspacePath('sub', 'sub2', 'doc3.md');
			const doc3 = new InMemoryDocument(uri3, joinLines());

			const workspace = store.add(new InMemoryWorkspace([
				doc1, doc2, doc3
			]));

			const edit = await getRenameEdits(store, doc1, { line: 0, character: 10 }, 'sub2/cat.md', workspace);
			assertEditsEqual(edit!, {
				originalUri: workspacePath('sub', 'sub2', 'doc3.md'),
				newUri: workspacePath('sub', 'sub2', 'cat.md'),
			}, {
				uri: uri1, edits: [lsp.TextEdit.replace(makeRange(0, 8, 0, 20), 'sub2/cat.md')]
			}, {
				uri: uri2, edits: [lsp.TextEdit.replace(makeRange(0, 8, 0, 24), 'sub/sub2/cat.md')]
			});
		}));

		test('Rename on link should use header text as placeholder', withStore(async (store) => {
			const uri = workspacePath('doc.md');
			const doc = new InMemoryDocument(uri, joinLines(
				`### a B c ###`,
				`[text](#a-b-c)`,
			));

			const workspace = store.add(new InMemoryWorkspace([doc]));
			const info = await prepareRename(store, doc, { line: 1, character: 10 }, workspace);
			assert.strictEqual(info!.placeholder, 'a B c');
			assertRangeEqual(info!.range, makeRange(1, 8, 1, 13));
		}));

		test('Rename on http uri should work', withStore(async (store) => {
			const uri1 = workspacePath('doc.md');
			const uri2 = workspacePath('doc2.md');
			const doc = new InMemoryDocument(uri1, joinLines(
				`[1](http://example.com)`,
				`[2]: http://example.com`,
				`<http://example.com>`,
			));

			const workspace = store.add(new InMemoryWorkspace([
				doc,
				new InMemoryDocument(uri2, joinLines(
					`[4](http://example.com)`
				))
			]));

			const edit = await getRenameEdits(store, doc, { line: 1, character: 10 }, 'https://example.com/sub', workspace);
			assertEditsEqual(edit!, {
				uri: uri1, edits: [
					lsp.TextEdit.replace(makeRange(0, 4, 0, 22), 'https://example.com/sub'),
					lsp.TextEdit.replace(makeRange(1, 5, 1, 23), 'https://example.com/sub'),
					lsp.TextEdit.replace(makeRange(2, 1, 2, 19), 'https://example.com/sub'),
				]
			}, {
				uri: uri2, edits: [
					lsp.TextEdit.replace(makeRange(0, 4, 0, 22), 'https://example.com/sub'),
				]
			});
		}));

		test('Rename on definition path should update all references to path', withStore(async (store) => {
			const uri = workspacePath('doc.md');
			const doc = new InMemoryDocument(uri, joinLines(
				`[ref text][ref]`,
				`[direct](/file)`,
				`[ref]: /file`, // rename here
			));

			const workspace = store.add(new InMemoryWorkspace([doc]));

			const preparedInfo = await prepareRename(store, doc, { line: 2, character: 10 }, workspace);
			assert.strictEqual(preparedInfo!.placeholder, '/file');
			assertRangeEqual(preparedInfo!.range, makeRange(2, 7, 2, 12));

			const edit = await getRenameEdits(store, doc, { line: 2, character: 10 }, '/newFile', workspace);
			assertEditsEqual(edit!, {
				uri, edits: [
					lsp.TextEdit.replace(makeRange(1, 9, 1, 14), '/newFile'),
					lsp.TextEdit.replace(makeRange(2, 7, 2, 12), '/newFile'),
				]
			});
		}));

		test('Rename on definition path where file exists should also update file', withStore(async (store) => {
			const uri1 = workspacePath('doc.md');
			const doc1 = new InMemoryDocument(uri1, joinLines(
				`[ref text][ref]`,
				`[direct](/doc2)`,
				`[ref]: /doc2`, // rename here
			));

			const uri2 = workspacePath('doc2.md');
			const doc2 = new InMemoryDocument(uri2, joinLines());

			const workspace = store.add(new InMemoryWorkspace([doc1, doc2]));

			const preparedInfo = await prepareRename(store, doc1, { line: 2, character: 10 }, workspace);
			assert.strictEqual(preparedInfo!.placeholder, '/doc2');
			assertRangeEqual(preparedInfo!.range, makeRange(2, 7, 2, 12));

			const edit = await getRenameEdits(store, doc1, { line: 2, character: 10 }, '/new-doc', workspace);
			assertEditsEqual(edit!, {
				uri: uri1, edits: [
					lsp.TextEdit.replace(makeRange(1, 9, 1, 14), '/new-doc'),
					lsp.TextEdit.replace(makeRange(2, 7, 2, 12), '/new-doc'),
				]
			}, {
				originalUri: uri2,
				newUri: workspacePath('new-doc.md')
			});
		}));

		test('Rename on definition path header should update all references to header', withStore(async (store) => {
			const uri = workspacePath('doc.md');
			const doc = new InMemoryDocument(uri, joinLines(
				`[ref text][ref]`,
				`[direct](/file#header)`,
				`[ref]: /file#header`, // rename here
			));

			const workspace = store.add(new InMemoryWorkspace([doc]));

			const preparedInfo = await prepareRename(store, doc, { line: 2, character: 16 }, workspace);
			assert.strictEqual(preparedInfo!.placeholder, 'header');
			assertRangeEqual(preparedInfo!.range, makeRange(2, 13, 2, 19));

			const edit = await getRenameEdits(store, doc, { line: 2, character: 16 }, 'New Header', workspace);
			assertEditsEqual(edit!, {
				uri, edits: [
					lsp.TextEdit.replace(makeRange(1, 15, 1, 21), 'new-header'),
					lsp.TextEdit.replace(makeRange(2, 13, 2, 19), 'new-header'),
				]
			});
		}));

		test('Path rename should rename paths in html tags', withStore(async (store) => {
			const uri1 = workspacePath('doc1.md');
			const doc1 = new InMemoryDocument(uri1, joinLines(
				`![img](/images/more/image.png)`,
				``,
				`<img src="/images/more/image.png">`,
			));

			const uri2 = workspacePath('sub', 'doc2.md');
			const doc2 = new InMemoryDocument(uri2, joinLines(
				`<img src="/images/more/image.png">`,
			));

			const workspace = store.add(new InMemoryWorkspace([
				doc1,
				doc2
			]));

			const expectedEdits = [
				// Should not have file edits since the files don't exist here
				{
					uri: uri1, edits: [
						lsp.TextEdit.replace(makeRange(0, 7, 0, 29), '/img/test/new.png'),
						lsp.TextEdit.replace(makeRange(2, 10, 2, 32), '/img/test/new.png'),
					]
				},
				{
					uri: uri2, edits: [
						lsp.TextEdit.replace(makeRange(0, 10, 0, 32), '/img/test/new.png'),
					]
				}
			];

			{
				// Trigger on image path
				const edit = await getRenameEdits(store, doc1, { line: 0, character: 10 }, '/img/test/new.png', workspace);
				assertEditsEqual(edit!, ...expectedEdits);
			}
			{
				// Trigger on html tag path
				const edit = await getRenameEdits(store, doc1, { line: 2, character: 12 }, '/img/test/new.png', workspace);
				assertEditsEqual(edit!, ...expectedEdits);
			}
		}));

		test('Rename on angle bracket link should not add extra escapes', withStore(async (store) => {
			const uri = workspacePath('doc.md');
			const doc = new InMemoryDocument(uri, joinLines(
				`![text](<cat.gif>)`,
				``,
				`[def]: <cat.gif>`,
			));

			const workspace = store.add(new InMemoryWorkspace([doc]));

			const edit = await getRenameEdits(store, doc, { line: 0, character: 10 }, 'sp ace.gif', workspace);
			assertEditsEqual(edit!, {
				uri, edits: [
					lsp.TextEdit.replace(makeRange(0, 9, 0, 16), 'sp ace.gif'),
					lsp.TextEdit.replace(makeRange(2, 8, 2, 15), 'sp ace.gif'),
				]
			});
		}));

		test('Rename that adds unmatched parens should force angle bracket link', withStore(async (store) => {
			const uri = workspacePath('doc.md');
			const doc = new InMemoryDocument(uri, joinLines(
				`![text](cat.gif)`,
				`![text](<cat.gif>)`,
				``,
				`[def]: cat.gif`,
			));

			const workspace = store.add(new InMemoryWorkspace([doc]));

			// Mismatched parens should force use of `<...>` links
			const mismatchedit = await getRenameEdits(store, doc, { line: 0, character: 10 }, 'open(.gif', workspace);
			assertEditsEqual(mismatchedit!, {
				uri, edits: [
					lsp.TextEdit.replace(makeRange(0, 8, 0, 15), '<open(.gif>'),
					lsp.TextEdit.replace(makeRange(1, 9, 1, 16), 'open(.gif'),
					lsp.TextEdit.replace(makeRange(3, 7, 3, 14), '<open(.gif>'),
				]
			});

			// But we don't need this if the parens are matched
			const matchedEdit = await getRenameEdits(store, doc, { line: 0, character: 10 }, 'o(p)(e(n)).gif', workspace);
			assertEditsEqual(matchedEdit!, {
				uri, edits: [
					lsp.TextEdit.replace(makeRange(0, 8, 0, 15), 'o(p)(e(n)).gif'),
					lsp.TextEdit.replace(makeRange(1, 8, 1, 17), 'o(p)(e(n)).gif'), // removes <...> from link
					lsp.TextEdit.replace(makeRange(3, 7, 3, 14), 'o(p)(e(n)).gif'),
				]
			});
		}));

		test('Rename should remove angle angle brackets from link if they are not needed', withStore(async (store) => {
			const uri = workspacePath('doc.md');
			const doc = new InMemoryDocument(uri, joinLines(
				`![text](cat.gif)`,
				`![text](<cat.gif>)`,
				``,
				`[def]: <cat.gif>`,
			));

			const workspace = store.add(new InMemoryWorkspace([doc]));

			const edit = await getRenameEdits(store, doc, { line: 0, character: 10 }, 'n<ew>.gif', workspace);
			assertEditsEqual(edit!, {
				uri, edits: [
					lsp.TextEdit.replace(makeRange(0, 8, 0, 15), 'n<ew>.gif'),
					lsp.TextEdit.replace(makeRange(1, 8, 1, 17), 'n<ew>.gif'),
					lsp.TextEdit.replace(makeRange(3, 7, 3, 16), 'n<ew>.gif'),
				]
			});
		}));
	});
}); 
