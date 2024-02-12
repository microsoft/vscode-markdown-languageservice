/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as lsp from 'vscode-languageserver-protocol';
import { URI } from 'vscode-uri';
import { MdFoldingProvider } from '../languageFeatures/folding';
import { MdTableOfContentsProvider } from '../tableOfContents';
import { noopToken } from '../util/cancellation';
import { DisposableStore } from '../util/dispose';
import { createNewMarkdownEngine } from './engine';
import { InMemoryDocument } from './inMemoryDocument';
import { InMemoryWorkspace } from './inMemoryWorkspace';
import { nulLogger } from './nulLogging';
import { joinLines, withStore } from './util';

const testFileName = URI.file('test.md');

async function getFoldsForDocument(store: DisposableStore, contents: string) {
	const doc = new InMemoryDocument(testFileName, contents);
	const workspace = store.add(new InMemoryWorkspace([doc]));
	const engine = createNewMarkdownEngine();
	const tocProvider = store.add(new MdTableOfContentsProvider(engine, workspace, nulLogger));
	const provider = new MdFoldingProvider(engine, tocProvider, nulLogger);
	return provider.provideFoldingRanges(doc, noopToken);
}

interface ExpectedFold {
	readonly startLine: number;
	readonly endLine: number;
	readonly kind?: lsp.FoldingRangeKind;
}

function assertFoldsEqual(actualRanges: readonly lsp.FoldingRange[], expectedRanges: readonly ExpectedFold[]) {
	assert.strictEqual(actualRanges.length, expectedRanges.length, 'Folding range counts should be equal');

	for (let i = 0; i < actualRanges.length; ++i) {
		const actual = actualRanges[i];
		const expected = expectedRanges[i];

		assert.strictEqual(actual.startLine, expected.startLine, `Start lines of fold ${i} to be equal`);
		assert.strictEqual(actual.endLine, expected.endLine, 'End lines of fold ${i} to be equal');

		if (typeof expected.kind !== 'undefined') {
			assert.strictEqual(actual.kind, expected.kind, 'Folding kinds of fold ${i} to be equal');
		}
	}
}


suite('Folding', () => {
	test('Should not return anything for empty document', withStore(async (store) => {
		const folds = await getFoldsForDocument(store, ``);
		assert.strictEqual(folds.length, 0);
	}));

	test('Should not return anything for document without headers', withStore(async (store) => {
		const folds = await getFoldsForDocument(store, joinLines(
			`a`,
			`**b** afas`,
			`a#b`,
			`a`,
		));
		assert.strictEqual(folds.length, 0);
	}));

	test('Should fold from header to end of document', withStore(async (store) => {
		const folds = await getFoldsForDocument(store, joinLines(
			`a`,
			`# b`,
			`c`,
			`d`,
		));

		assertFoldsEqual(folds, [
			{ startLine: 1, endLine: 3 }
		]);
	}));

	test('Should leave single newline before next header', withStore(async (store) => {
		const folds = await getFoldsForDocument(store, joinLines(
			``,
			`# a`,
			`x`,
			``,
			`# b`,
			`y`,
		));

		assertFoldsEqual(folds, [
			{ startLine: 1, endLine: 2 },
			{ startLine: 4, endLine: 5 },
		]);
	}));

	test('Should collapse multiple newlines to single newline before next header', withStore(async (store) => {
		const folds = await getFoldsForDocument(store, joinLines(
			``,
			`# a`,
			`x`,
			``,
			``,
			``,
			`# b`,
			`y`
		));
		assertFoldsEqual(folds, [
			{ startLine: 1, endLine: 4 },
			{ startLine: 6, endLine: 7 },
		]);
	}));

	test('Should not collapse if there is no newline before next header', withStore(async (store) => {
		const folds = await getFoldsForDocument(store, joinLines(
			``,
			`# a`,
			`x`,
			`# b`,
			`y`,
		));
		assertFoldsEqual(folds, [
			{ startLine: 1, endLine: 2 },
			{ startLine: 3, endLine: 4 },
		]);
	}));

	test('Should fold nested <!-- #region --> markers', withStore(async (store) => {
		const folds = await getFoldsForDocument(store, joinLines(
			`a`,
			`<!-- #region -->`,
			`b`,
			`<!-- #region hello!-->`,
			`b.a`,
			`<!-- #endregion -->`,
			`b`,
			`<!-- #region: foo! -->`,
			`b.b`,
			`<!-- #endregion: foo -->`,
			`b`,
			`<!-- #endregion -->`,
			`a`,
		));
		assertFoldsEqual(folds.sort((a, b) => a.startLine - b.startLine), [
			{ startLine: 1, endLine: 11 },
			{ startLine: 3, endLine: 5 },
			{ startLine: 7, endLine: 9 },
		]);
	}));

	test('Should fold from list to end of document', withStore(async (store) => {
		const folds = await getFoldsForDocument(store, joinLines(
			`a`,
			`- b`,
			`c`,
			`d`,
		));
		assertFoldsEqual(folds, [
			{ startLine: 1, endLine: 3 },
		]);
	}));

	test('lists folds should span multiple lines of content', withStore(async (store) => {
		const folds = await getFoldsForDocument(store, joinLines(
			`a`,
			`- This list item\n  spans multiple\n  lines.`,
		));
		assertFoldsEqual(folds, [
			{ startLine: 1, endLine: 3 },
		]);
	}));

	test('List should leave single blankline before new element', withStore(async (store) => {
		const folds = await getFoldsForDocument(store, joinLines(
			`- a`,
			`a`,
			``,
			``,
			`b`
		));
		assertFoldsEqual(folds, [
			{ startLine: 0, endLine: 2 },
		]);
	}));

	test('Should fold fenced code blocks', withStore(async (store) => {
		const folds = await getFoldsForDocument(store, joinLines(
			`~~~ts`,
			`a`,
			`~~~`,
			`b`,
		));
		assertFoldsEqual(folds, [
			{ startLine: 0, endLine: 2 },
		]);
	}));

	test.skip('Should fold fenced code blocks with yaml front matter', withStore(async (store) => {
		const folds = await getFoldsForDocument(store, joinLines(
			`---`,
			`title: bla`,
			`---`,
			``,
			`~~~ts`,
			`a`,
			`~~~`,
			``,
			`a`,
			`a`,
			`b`,
			`a`,
		));
		assertFoldsEqual(folds, [
			{ startLine: 4, endLine: 6 },
		]);
	}));

	test('Should fold html blocks', withStore(async (store) => {
		const folds = await getFoldsForDocument(store, joinLines(
			`x`,
			`<div>`,
			`	fa`,
			`</div>`,
		));
		assertFoldsEqual(folds, [
			{ startLine: 1, endLine: 3 },
		]);
	}));

	test('Should fold html block comments', withStore(async (store) => {
		const folds = await getFoldsForDocument(store, joinLines(
			`x`,
			`<!--`,
			`fa`,
			`-->`
		));
		assertFoldsEqual(folds, [
			{ startLine: 1, endLine: 3, kind: lsp.FoldingRangeKind.Comment },
		]);
	}));

	test('Should fold tables', withStore(async (store) => {
		const folds = await getFoldsForDocument(store, joinLines(
			`| a | b |`,
			`|---|---|`,
			`| b | c |`,
		));
		assertFoldsEqual(folds, [
			{ startLine: 0, endLine: 2 },
		]);
	}));

	test('Should fold block quotes', withStore(async (store) => {
		const folds = await getFoldsForDocument(store, joinLines(
			`a`,
			``,
			`> b1`,
			`> b1`,
			``,
			`> b2`, // Should not be included since it is one line long
			``,
			`> b3`, // Block quote extends to next line automatically
			`b3`,
			``,
			`z`,
		));

		assertFoldsEqual(folds, [
			{ startLine: 2, endLine: 3 },
			{ startLine: 7, endLine: 8 },
		]);
	}));
});
