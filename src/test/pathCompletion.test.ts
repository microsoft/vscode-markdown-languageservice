/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as lsp from 'vscode-languageserver-protocol';
import { URI } from 'vscode-uri';
import { getLsConfiguration, LsConfiguration, PreferredMdPathExtensionStyle } from '../config';
import { MdLinkProvider } from '../languageFeatures/documentLinks';
import { IncludeWorkspaceHeaderCompletions, MdPathCompletionProvider, PathCompletionOptions } from '../languageFeatures/pathCompletions';
import { MdTableOfContentsProvider } from '../tableOfContents';
import { InMemoryDocument } from '../types/inMemoryDocument';
import { noopToken } from '../util/cancellation';
import { IWorkspace } from '../workspace';
import { createNewMarkdownEngine } from './engine';
import { InMemoryWorkspace } from './inMemoryWorkspace';
import { nulLogger } from './nulLogging';
import { CURSOR, DisposableStore, getCursorPositions, joinLines, withStore, workspacePath } from './util';


async function getCompletionsAtCursor(store: DisposableStore, doc: InMemoryDocument, workspace: IWorkspace, configOverrides: Partial<LsConfiguration> = {}, context: Partial<PathCompletionOptions> = {}) {
	const config = getLsConfiguration(configOverrides);

	const engine = createNewMarkdownEngine();
	const tocProvider = store.add(new MdTableOfContentsProvider(engine, workspace, nulLogger));
	const linkProvider = store.add(new MdLinkProvider(config, engine, workspace, tocProvider, nulLogger));
	const provider = new MdPathCompletionProvider(config, workspace, engine, linkProvider, tocProvider);
	const cursorPositions = getCursorPositions(doc.getText(), doc);

	const completions = await provider.provideCompletionItems(doc, cursorPositions[0], {
		triggerCharacter: undefined,
		triggerKind: lsp.CompletionTriggerKind.Invoked,
		...context
	}, noopToken);

	return completions.sort((a, b) => {
		return (a.sortText ?? a.label).localeCompare(b.sortText ?? b.label);
	});
}

async function getCompletionsAtCursorForFileContents(store: DisposableStore, uri: URI, fileContents: string, workspace?: IWorkspace, configOverrides: Partial<LsConfiguration> = {}, context: Partial<PathCompletionOptions> = {}) {
	const doc = new InMemoryDocument(uri, fileContents);
	const ws = workspace ?? store.add(new InMemoryWorkspace([doc]));

	return getCompletionsAtCursor(store, doc, ws, configOverrides, context);
}

function assertCompletionsEqual(actual: readonly lsp.CompletionItem[], expected: readonly { label: string; insertText?: string }[]) {
	assert.strictEqual(actual.length, expected.length, 'Completion counts should be equal');

	for (let i = 0; i < actual.length; ++i) {
		const act = actual[i];
		const exp = expected[i];

		assert.strictEqual(act.label, exp.label, `Completion labels ${i} should be equal`);
		assert.strictEqual((act.textEdit as lsp.InsertReplaceEdit).newText, exp.insertText ?? exp.label, `New text ${i} should be equal`);
	}
}

suite('Path completions', () => {

	test('Should not return anything when triggered in empty doc', withStore(async (store) => {
		const completions = await getCompletionsAtCursorForFileContents(store, workspacePath('new.md'), `${CURSOR}`);
		assertCompletionsEqual(completions, []);
	}));

	test('Should return anchor completions', withStore(async (store) => {
		const completions = await getCompletionsAtCursorForFileContents(store, workspacePath('new.md'), joinLines(
			`[](#${CURSOR}`,
			``,
			`# A b C`,
			`# x y Z`,
		));

		assertCompletionsEqual(completions, [
			{ label: '#a-b-c' },
			{ label: '#x-y-z' },
		]);
	}));

	test('Should not return suggestions for http links', withStore(async (store) => {
		const completions = await getCompletionsAtCursorForFileContents(store, workspacePath('new.md'), joinLines(
			`[](http:${CURSOR}`,
			``,
			`# http`,
			`# http:`,
			`# https:`,
		));

		assertCompletionsEqual(completions, []);
	}));

	test('Should return relative path suggestions', withStore(async (store) => {
		const workspace = store.add(new InMemoryWorkspace([
			new InMemoryDocument(workspacePath('a.md'), ''),
			new InMemoryDocument(workspacePath('b.md'), ''),
			new InMemoryDocument(workspacePath('sub', 'foo.md'), ''),
		]));
		const completions = await getCompletionsAtCursorForFileContents(store, workspacePath('new.md'), joinLines(
			`[](${CURSOR}`,
			``,
			`# A b C`,
		), workspace);

		assertCompletionsEqual(completions, [
			{ label: '#a-b-c' },
			{ label: 'a.md' },
			{ label: 'b.md' },
			{ label: 'sub/' },
		]);
	}));

	test('Should return relative path suggestions using ./', withStore(async (store) => {
		const workspace = store.add(new InMemoryWorkspace([
			new InMemoryDocument(workspacePath('a.md'), ''),
			new InMemoryDocument(workspacePath('b.md'), ''),
			new InMemoryDocument(workspacePath('sub', 'foo.md'), ''),
		]));

		const completions = await getCompletionsAtCursorForFileContents(store, workspacePath('new.md'), joinLines(
			`[](./${CURSOR}`,
			``,
			`# A b C`,
		), workspace);

		assertCompletionsEqual(completions, [
			{ label: 'a.md' },
			{ label: 'b.md' },
			{ label: 'sub/' },
		]);
	}));

	test('Should return absolute path suggestions using /', withStore(async (store) => {
		const workspace = store.add(new InMemoryWorkspace([
			new InMemoryDocument(workspacePath('a.md'), ''),
			new InMemoryDocument(workspacePath('b.md'), ''),
			new InMemoryDocument(workspacePath('sub', 'c.md'), ''),
		]));

		const completions = await getCompletionsAtCursorForFileContents(store, workspacePath('sub', 'new.md'), joinLines(
			`[](/${CURSOR}`,
			``,
			`# A b C`,
		), workspace);

		assertCompletionsEqual(completions, [
			{ label: 'a.md' },
			{ label: 'b.md' },
			{ label: 'sub/' },
		]);
	}));

	test('Should return anchor suggestions in other file', withStore(async (store) => {
		const workspace = store.add(new InMemoryWorkspace([
			new InMemoryDocument(workspacePath('b.md'), joinLines(
				`# b`,
				``,
				`[./a](./a)`,
				``,
				`# header1`,
			)),
		]));
		const completions = await getCompletionsAtCursorForFileContents(store, workspacePath('sub', 'new.md'), joinLines(
			`[](/b.md#${CURSOR}`,
		), workspace);

		assertCompletionsEqual(completions, [
			{ label: '#b' },
			{ label: '#header1' },
		]);
	}));

	test('Should reference links for current file', withStore(async (store) => {
		const completions = await getCompletionsAtCursorForFileContents(store, workspacePath('sub', 'new.md'), joinLines(
			`[][${CURSOR}`,
			``,
			`[ref-1]: bla`,
			`[ref-2]: bla`,
		));

		assertCompletionsEqual(completions, [
			{ label: 'ref-1' },
			{ label: 'ref-2' },
		]);
	}));

	test('Should complete headers in link definitions', withStore(async (store) => {
		const completions = await getCompletionsAtCursorForFileContents(store, workspacePath('sub', 'new.md'), joinLines(
			`# a B c`,
			`# x y    Z`,
			`[ref-1]: ${CURSOR}`,
		));

		assertCompletionsEqual(completions, [
			{ label: '#a-b-c' },
			{ label: '#x-y-z' },
			{ label: 'new.md' },
		]);
	}));

	test('Should complete relative paths in link definitions', withStore(async (store) => {
		const workspace = store.add(new InMemoryWorkspace([
			new InMemoryDocument(workspacePath('a.md'), ''),
			new InMemoryDocument(workspacePath('b.md'), ''),
			new InMemoryDocument(workspacePath('sub', 'c.md'), ''),
		]));

		const completions = await getCompletionsAtCursorForFileContents(store, workspacePath('new.md'), joinLines(
			`# a B c`,
			`[ref-1]: ${CURSOR}`,
		), workspace);

		assertCompletionsEqual(completions, [
			{ label: '#a-b-c' },
			{ label: 'a.md' },
			{ label: 'b.md' },
			{ label: 'sub/' },
		]);
	}));

	test('Should escape spaces in path names', withStore(async (store) => {
		const workspace = store.add(new InMemoryWorkspace([
			new InMemoryDocument(workspacePath('a.md'), ''),
			new InMemoryDocument(workspacePath('b.md'), ''),
			new InMemoryDocument(workspacePath('sub', 'file with space.md'), ''),
		]));

		const completions = await getCompletionsAtCursorForFileContents(store, workspacePath('new.md'), joinLines(
			`[](./sub/${CURSOR})`
		), workspace);

		assertCompletionsEqual(completions, [
			{ label: 'file with space.md', insertText: 'file%20with%20space.md' },
		]);
	}));

	test('Should support completions on angle bracket path with spaces', withStore(async (store) => {
		const workspace = store.add(new InMemoryWorkspace([
			new InMemoryDocument(workspacePath('sub with space', 'a.md'), ''),
			new InMemoryDocument(workspacePath('b.md'), ''),
		]));

		const completions = await getCompletionsAtCursorForFileContents(store, workspacePath('new.md'), joinLines(
			`[](</sub with space/${CURSOR}`
		), workspace);

		assertCompletionsEqual(completions, [
			{ label: 'a.md', insertText: 'a.md' },
		]);
	}));

	test('Should not escape spaces in path names that use angle brackets', withStore(async (store) => {
		const workspace = store.add(new InMemoryWorkspace([
			new InMemoryDocument(workspacePath('sub', 'file with space.md'), ''),
		]));

		{
			const completions = await getCompletionsAtCursorForFileContents(store, workspacePath('new.md'), joinLines(
				`[](<./sub/${CURSOR}`
			), workspace);

			assertCompletionsEqual(completions, [
				{ label: 'file with space.md', insertText: 'file with space.md' },
			]);
		}
		{
			const completions = await getCompletionsAtCursorForFileContents(store, workspacePath('new.md'), joinLines(
				`[](<./sub/${CURSOR}>`
			), workspace);

			assertCompletionsEqual(completions, [
				{ label: 'file with space.md', insertText: 'file with space.md' },
			]);
		}
	}));

	test('Should complete paths for path with encoded spaces', withStore(async (store) => {
		const workspace = store.add(new InMemoryWorkspace([
			new InMemoryDocument(workspacePath('a.md'), ''),
			new InMemoryDocument(workspacePath('b.md'), ''),
			new InMemoryDocument(workspacePath('sub with space', 'file.md'), ''),
		]));

		const completions = await getCompletionsAtCursorForFileContents(store, workspacePath('new.md'), joinLines(
			`[](./sub%20with%20space/${CURSOR})`
		), workspace);

		assertCompletionsEqual(completions, [
			{ label: 'file.md', insertText: 'file.md' },
		]);
	}));

	test('Should complete definition path for path with encoded spaces', withStore(async (store) => {
		const workspace = store.add(new InMemoryWorkspace([
			new InMemoryDocument(workspacePath('a.md'), ''),
			new InMemoryDocument(workspacePath('b.md'), ''),
			new InMemoryDocument(workspacePath('sub with space', 'file.md'), ''),
		]));

		const completions = await getCompletionsAtCursorForFileContents(store, workspacePath('new.md'), joinLines(
			`[def]: ./sub%20with%20space/${CURSOR}`
		), workspace);

		assertCompletionsEqual(completions, [
			{ label: 'file.md', insertText: 'file.md' },
		]);
	}));

	test('Should support definition path with angle brackets', withStore(async (store) => {
		const workspace = store.add(new InMemoryWorkspace([
			new InMemoryDocument(workspacePath('a.md'), ''),
			new InMemoryDocument(workspacePath('b.md'), ''),
			new InMemoryDocument(workspacePath('sub with space', 'file.md'), ''),
		]));

		const completions = await getCompletionsAtCursorForFileContents(store, workspacePath('new.md'), joinLines(
			`[def]: <./${CURSOR}>`
		), workspace);

		assertCompletionsEqual(completions, [
			{ label: 'a.md', insertText: 'a.md' },
			{ label: 'b.md', insertText: 'b.md' },
			{ label: 'sub with space/', insertText: 'sub with space/' },
		]);
	}));

	test('Should return completions for links with square brackets', withStore(async (store) => {
		const completions = await getCompletionsAtCursorForFileContents(store, workspacePath('new.md'), joinLines(
			`[x [y] z](#${CURSOR}`,
			``,
			`# A b C`,
		));

		assertCompletionsEqual(completions, [
			{ label: '#a-b-c' },
		]);
	}));

	test('Should exclude completions for excluded paths', withStore(async (store) => {
		const workspace = store.add(new InMemoryWorkspace([
			new InMemoryDocument(workspacePath('a.md'), ''),
			new InMemoryDocument(workspacePath('.other.md'), ''),
			new InMemoryDocument(workspacePath('sub', 'file.md'), ''),
			new InMemoryDocument(workspacePath('b.md'), ''),
		]));

		const completions = await getCompletionsAtCursorForFileContents(store, workspacePath('new.md'), joinLines(
			`[def]: ./${CURSOR}`
		), workspace, {
			excludePaths: [
				'**/sub/**',
				'**/.*',
			]
		});

		assertCompletionsEqual(completions, [
			{ label: 'a.md', insertText: 'a.md' },
			{ label: 'b.md', insertText: 'b.md' },
		]);
	}));

	test('Should allowing configuring if md file suggestions include .md file extension', withStore(async (store) => {
		const workspace = store.add(new InMemoryWorkspace([
			new InMemoryDocument(workspacePath('a.md'), ''),
			new InMemoryDocument(workspacePath('b.md'), ''),
			new InMemoryDocument(workspacePath('sub', 'foo.md'), ''),
		]));

		const completions = await getCompletionsAtCursorForFileContents(store, workspacePath('new.md'), joinLines(
			`[](./${CURSOR}`,
			``,
			`# A b C`,
		), workspace, { preferredMdPathExtensionStyle: PreferredMdPathExtensionStyle.removeExtension });

		assertCompletionsEqual(completions, [
			{ label: 'a' },
			{ label: 'b' },
			{ label: 'sub/' },
		]);
	}));

	test('Should support multibyte character paths', withStore(async (store) => {
		const workspace = store.add(new InMemoryWorkspace([
			new InMemoryDocument(workspacePath('テスト1.md'), ''),
			new InMemoryDocument(workspacePath('テスト', 'テスト2.md'), ''),
			new InMemoryDocument(workspacePath('テ ス ト3.md'), ''),
		]));

		const completions = await getCompletionsAtCursorForFileContents(store, workspacePath('new.md'), joinLines(
			`[](./${CURSOR}`,
		), workspace);

		assertCompletionsEqual(completions, [
			{ label: 'テ ス ト3.md', insertText: 'テ%20ス%20ト3.md' },
			{ label: 'テスト/' },
			{ label: 'テスト1.md' },
		]);
	}));

	test('Should escape angle brackets if in angle bracket link', withStore(async (store) => {
		const workspace = store.add(new InMemoryWorkspace([
			new InMemoryDocument(workspacePath('<a>.md'), ''),
			new InMemoryDocument(workspacePath('a<b>c.md'), ''),
		]));

		const completions = await getCompletionsAtCursorForFileContents(store, workspacePath('new.md'), joinLines(
			`[](<./${CURSOR}`,
		), workspace);

		assertCompletionsEqual(completions, [
			{ label: '<a>.md', insertText: '\\<a\\>.md' },
			{ label: 'a<b>c.md', insertText: 'a\\<b\\>c.md' },
		]);
	}));

	test('Should escape mismatched parens', withStore(async (store) => {
		const workspace = store.add(new InMemoryWorkspace([
			new InMemoryDocument(workspacePath('(a).md'), ''),
			new InMemoryDocument(workspacePath('a(b.md'), ''),
		]));

		const completions = await getCompletionsAtCursorForFileContents(store, workspacePath('new.md'), joinLines(
			`[](./${CURSOR}`,
		), workspace);

		assertCompletionsEqual(completions, [
			{ label: '(a).md', insertText: '(a).md' },
			{ label: 'a(b.md', insertText: 'a\\(b.md' },
		]);
	}));

	test(`Should escape '%' used in file name`, withStore(async (store) => {
		const workspace = store.add(new InMemoryWorkspace([
			new InMemoryDocument(workspacePath('a%b.md'), ''),
		]));

		const completions = await getCompletionsAtCursorForFileContents(store, workspacePath('new.md'), joinLines(
			`[](./${CURSOR}`,
		), workspace);

		assertCompletionsEqual(completions, [
			{ label: 'a%b.md', insertText: 'a%25b.md' },
		]);
	}));

	suite('Cross file header completions', () => {

		test('Should return completions for headers in current doc', withStore(async (store) => {
			const completions = await getCompletionsAtCursorForFileContents(store, workspacePath('new.md'), joinLines(
				`[](##${CURSOR}`,
				``,
				`# A b C`,
				`# x y Z`,
			), undefined, undefined, { includeWorkspaceHeaderCompletions: IncludeWorkspaceHeaderCompletions.onDoubleHash });

			assertCompletionsEqual(completions, [
				{ label: '#a-b-c' },
				{ label: '#x-y-z' },
			]);
		}));

		test('Should return completions for headers across files in workspace', withStore(async (store) => {
			const workspace = store.add(new InMemoryWorkspace([
				new InMemoryDocument(workspacePath('a.md'), joinLines(
					'# A b C',
				)),
				new InMemoryDocument(workspacePath('sub', 'b.md'), joinLines(
					'# x Y z',
				)),
			]));

			const completions = await getCompletionsAtCursorForFileContents(store, workspacePath('new.md'), joinLines(
				`[](##${CURSOR}`,
			), workspace, undefined, { includeWorkspaceHeaderCompletions: IncludeWorkspaceHeaderCompletions.onDoubleHash });

			assertCompletionsEqual(completions, [
				{ label: '#a-b-c', insertText: 'a.md#a-b-c' },
				{ label: '#x-y-z', insertText: 'sub/b.md#x-y-z' },
			]);
		}));

		test('Should use .. to access parent folders', withStore(async (store) => {
			const workspace = store.add(new InMemoryWorkspace([
				new InMemoryDocument(workspacePath('a.md'), joinLines(
					'# A b C',
				)),
				new InMemoryDocument(workspacePath('sub', 'b.md'), joinLines(
					'# x Y z',
				)),
			]));

			const completions = await getCompletionsAtCursorForFileContents(store, workspacePath('sub', 'new.md'), joinLines(
				`[](##${CURSOR}`,
			), workspace, undefined, { includeWorkspaceHeaderCompletions: IncludeWorkspaceHeaderCompletions.onDoubleHash });

			assertCompletionsEqual(completions, [
				{ label: '#a-b-c', insertText: '../a.md#a-b-c' },
				{ label: '#x-y-z', insertText: 'b.md#x-y-z' },
			]);
		}));

		test('Should encode spaces in folder paths', withStore(async (store) => {
			const workspace = store.add(new InMemoryWorkspace([
				new InMemoryDocument(workspacePath('a b.md'), joinLines(
					'# A b C',
				)),
				new InMemoryDocument(workspacePath('sub space', 'other sub', 'c d.md'), joinLines(
					'# x Y z',
				)),
			]));

			const completions = await getCompletionsAtCursorForFileContents(store, workspacePath('other', 'new.md'), joinLines(
				`[](##${CURSOR}`,
			), workspace, undefined, { includeWorkspaceHeaderCompletions: IncludeWorkspaceHeaderCompletions.onDoubleHash });

			assertCompletionsEqual(completions, [
				{ label: '#a-b-c', insertText: '../a%20b.md#a-b-c' },
				{ label: '#x-y-z', insertText: '../sub%20space/other%20sub/c%20d.md#x-y-z' },
			]);
		}));

		test('Should not be enabled by default', withStore(async (store) => {
			const workspace = store.add(new InMemoryWorkspace([
				new InMemoryDocument(workspacePath('a b.md'), joinLines(
					'# A b C',
				)),
				new InMemoryDocument(workspacePath('sub space', 'other sub', 'c d.md'), joinLines(
					'# x Y z',
				)),
			]));

			const completions = await getCompletionsAtCursorForFileContents(store, workspacePath('other', 'new.md'), joinLines(
				`[](##${CURSOR}`,
			), workspace, undefined, { includeWorkspaceHeaderCompletions: undefined });

			assertCompletionsEqual(completions, []);
		}));

		test('Should not return completions on single hash if configured to only trigger on double hash', withStore(async (store) => {
			const doc = new InMemoryDocument(workspacePath('other', 'new.md'), joinLines(
				`# header`,
				``,
				`[](#${CURSOR}`,
			));
			const workspace = store.add(new InMemoryWorkspace([
				doc,
				new InMemoryDocument(workspacePath('a b.md'), joinLines(
					'# A b C',
				)),
				new InMemoryDocument(workspacePath('sub space', 'other sub', 'c d.md'), joinLines(
					'# x Y z',
				)),
			]));

			const completions = await getCompletionsAtCursor(store, doc, workspace, undefined, { includeWorkspaceHeaderCompletions: IncludeWorkspaceHeaderCompletions.onDoubleHash });

			assertCompletionsEqual(completions, [
				{ label: '#header' }
			]);
		}));

		test('Should return completions on single hash if configured to', withStore(async (store) => {
			const doc = new InMemoryDocument(workspacePath('other', 'new.md'), joinLines(
				`# header`,
				``,
				`[](#${CURSOR}`,
			));
			const workspace = store.add(new InMemoryWorkspace([
				doc,
				new InMemoryDocument(workspacePath('a.md'), joinLines(
					'# A b C',
				)),
				new InMemoryDocument(workspacePath('sub', 'c.md'), joinLines(
					'# x Y z',
				)),
			]));

			const completions = await getCompletionsAtCursor(store, doc, workspace, undefined, { includeWorkspaceHeaderCompletions: IncludeWorkspaceHeaderCompletions.onSingleOrDoubleHash });

			assertCompletionsEqual(completions, [
				{ label: '#header' },
				{ label: '#a-b-c', insertText: '../a.md#a-b-c' },
				{ label: '#x-y-z', insertText: '../sub/c.md#x-y-z' },
			]);
		}));

		test('Should work in link definitions', withStore(async (store) => {
			const workspace = store.add(new InMemoryWorkspace([
				new InMemoryDocument(workspacePath('a.md'), joinLines(
					'# A b C',
				)),
				new InMemoryDocument(workspacePath('sub', 'b.md'), joinLines(
					'# x Y z',
				)),
			]));

			const completions = await getCompletionsAtCursorForFileContents(store, workspacePath('sub', 'new.md'), joinLines(
				`[ref]: ##${CURSOR}`,
			), workspace, undefined, { includeWorkspaceHeaderCompletions: IncludeWorkspaceHeaderCompletions.onDoubleHash });

			assertCompletionsEqual(completions, [
				{ label: '#a-b-c', insertText: '../a.md#a-b-c' },
				{ label: '#x-y-z', insertText: 'b.md#x-y-z' },
			]);
		}));

		test('Should skip encoding for angle bracket paths', withStore(async (store) => {
			const workspace = store.add(new InMemoryWorkspace([
				new InMemoryDocument(workspacePath('a b.md'), joinLines(
					'# A b C',
				)),
				new InMemoryDocument(workspacePath('sub space', 'other sub', 'c d.md'), joinLines(
					'# x Y z',
				)),
			]));

			const completions = await getCompletionsAtCursorForFileContents(store, workspacePath('other', 'new.md'), joinLines(
				`[text](<##${CURSOR}`,
			), workspace, undefined, { includeWorkspaceHeaderCompletions: IncludeWorkspaceHeaderCompletions.onDoubleHash });

			assertCompletionsEqual(completions, [
				{ label: '#a-b-c', insertText: '../a b.md#a-b-c' },
				{ label: '#x-y-z', insertText: '../sub space/other sub/c d.md#x-y-z' },
			]);
		}));

		test('Should allowing configuring if md file suggestions include .md file extension', withStore(async (store) => {
			const workspace = store.add(new InMemoryWorkspace([
				new InMemoryDocument(workspacePath('a.md'), joinLines(
					'# A b C',
				)),
				new InMemoryDocument(workspacePath('sub', 'b.md'), joinLines(
					'# x Y z',
				)),
			]));

			const completions = await getCompletionsAtCursorForFileContents(store, workspacePath('sub', 'new.md'), joinLines(
				`[](##${CURSOR}`,
			), workspace, { preferredMdPathExtensionStyle: PreferredMdPathExtensionStyle.removeExtension }, { includeWorkspaceHeaderCompletions: IncludeWorkspaceHeaderCompletions.onDoubleHash });

			assertCompletionsEqual(completions, [
				{ label: '#a-b-c', insertText: '../a#a-b-c' },
				{ label: '#x-y-z', insertText: 'b#x-y-z' },
			]);
		}));

		test('Should support multibyte character paths', withStore(async (store) => {
			const workspace = store.add(new InMemoryWorkspace([
				new InMemoryDocument(workspacePath('テ ス ト.md'), joinLines(
					`# Header`
				)),
			]));
	
			const completions = await getCompletionsAtCursorForFileContents(store, workspacePath('new.md'), joinLines(
				`[](##${CURSOR}`,
			), workspace, undefined, { includeWorkspaceHeaderCompletions: IncludeWorkspaceHeaderCompletions.onDoubleHash });
	
			assertCompletionsEqual(completions, [
				{ label: '#header', insertText: 'テ%20ス%20ト.md#header' },
			]);
		}));

		test(`Should escape '%' used in file name`, withStore(async (store) => {
			const workspace = store.add(new InMemoryWorkspace([
				new InMemoryDocument(workspacePath('a%b.md'), '# Header'),
			]));
	
			const completions = await getCompletionsAtCursorForFileContents(store, workspacePath('new.md'), joinLines(
				`[](##${CURSOR}`,
			), workspace, undefined, {includeWorkspaceHeaderCompletions: IncludeWorkspaceHeaderCompletions.onDoubleHash});
	
			assertCompletionsEqual(completions, [
				{ label: '#header', insertText: 'a%25b.md#header' },
			]);
		}));
	});

	suite('Html attribute path completions', () => {

		test('Should return completions for headers in current doc', withStore(async (store) => {
			const completions = await getCompletionsAtCursorForFileContents(store, workspacePath('new.md'), joinLines(
				`# a B c`,
				``,
				`<img src="${CURSOR}`,
			));

			assertCompletionsEqual(completions, [
				{ label: '#a-b-c' },
				{ label: 'new.md' },
			]);
		}));

		test('Should not return completions on unknown tags or attributes', withStore(async (store) => {
			{
				const completions = await getCompletionsAtCursorForFileContents(store, workspacePath('new.md'), joinLines(
					`# a B c`,
					``,
					`<img source="${CURSOR}`,
				));
				assertCompletionsEqual(completions, []);
			}
			{
				const completions = await getCompletionsAtCursorForFileContents(store, workspacePath('new.md'), joinLines(
					`# a B c`,
					``,
					`<image src="${CURSOR}`,
				));
				assertCompletionsEqual(completions, []);
			}
		}));

		test('Should not return completions for links with scheme', withStore(async (store) => {
			{
				const completions = await getCompletionsAtCursorForFileContents(store, workspacePath('new.md'), joinLines(
					`# a B c`,
					``,
					`<img src="http://${CURSOR}`,
				));

				assertCompletionsEqual(completions, []);
			}
			{
				const completions = await getCompletionsAtCursorForFileContents(store, workspacePath('new.md'), joinLines(
					`# a B c`,
					``,
					`<img src="mailto:${CURSOR}`,
				));

				assertCompletionsEqual(completions, []);
			}
		}));

		test('Should return completions when other attributes are present', withStore(async (store) => {
			const completions = await getCompletionsAtCursorForFileContents(store, workspacePath('new.md'), joinLines(
				`<img style="color: red" src="${CURSOR}" height="10px">`,
			));

			assertCompletionsEqual(completions, [
				{ label: 'new.md' },
			]);
		}));

		test('Should return completions for inline html', withStore(async (store) => {
			const completions = await getCompletionsAtCursorForFileContents(store, workspacePath('new.md'), joinLines(
				`some text <img src="./${CURSOR}"> more text`,
			));

			assertCompletionsEqual(completions, [
				{ label: 'new.md' },
			]);
		}));

		test('Should escape quotes in html', withStore(async (store) => {
			const workspace = store.add(new InMemoryWorkspace([
				new InMemoryDocument(workspacePath(`double qu"ot"e.md`,), joinLines()),
				new InMemoryDocument(workspacePath(`single qu'ot'e.md`,), joinLines()),
			]));

			const completions = await getCompletionsAtCursorForFileContents(store, workspacePath('new.md'), joinLines(
				`some text <img src="./${CURSOR}"> more text`,
			), workspace);

			assertCompletionsEqual(completions, [
				{ label: `double qu"ot"e.md`, insertText: 'double qu&quot;ot&quot;e.md' },
				{ label: `single qu'ot'e.md`, insertText: 'single qu&apos;ot&apos;e.md' },
			]);
		}));
	});
});
