/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as lsp from 'vscode-languageserver-types';
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
		assert.strictEqual(folds.length, 1);
		const firstFold = folds[0];
		assert.strictEqual(firstFold.startLine, 1);
		assert.strictEqual(firstFold.endLine, 3);
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
		assert.strictEqual(folds.length, 2);
		const firstFold = folds[0];
		assert.strictEqual(firstFold.startLine, 1);
		assert.strictEqual(firstFold.endLine, 2);
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
		assert.strictEqual(folds.length, 2);
		const firstFold = folds[0];
		assert.strictEqual(firstFold.startLine, 1);
		assert.strictEqual(firstFold.endLine, 4);
	}));

	test('Should not collapse if there is no newline before next header', withStore(async (store) => {
		const folds = await getFoldsForDocument(store, joinLines(
			``,
			`# a`,
			`x`,
			`# b`,
			`y`,
		));
		assert.strictEqual(folds.length, 2);
		const firstFold = folds[0];
		assert.strictEqual(firstFold.startLine, 1);
		assert.strictEqual(firstFold.endLine, 2);
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
		assert.strictEqual(folds.length, 3);
		const [outer, first, second] = folds.sort((a, b) => a.startLine - b.startLine);

		assert.strictEqual(outer.startLine, 1);
		assert.strictEqual(outer.endLine, 11);
		assert.strictEqual(first.startLine, 3);
		assert.strictEqual(first.endLine, 5);
		assert.strictEqual(second.startLine, 7);
		assert.strictEqual(second.endLine, 9);
	}));

	test('Should fold from list to end of document', withStore(async (store) => {
		const folds = await getFoldsForDocument(store, joinLines(
			`a`,
			`- b`,
			`c`,
			`d`,
		));
		assert.strictEqual(folds.length, 1);
		const firstFold = folds[0];
		assert.strictEqual(firstFold.startLine, 1);
		assert.strictEqual(firstFold.endLine, 3);
	}));

	test('lists folds should span multiple lines of content', withStore(async (store) => {
		const folds = await getFoldsForDocument(store, joinLines(
			`a`,
			`- This list item\n  spans multiple\n  lines.`,
		));
		assert.strictEqual(folds.length, 1);
		const firstFold = folds[0];
		assert.strictEqual(firstFold.startLine, 1);
		assert.strictEqual(firstFold.endLine, 3);
	}));

	test('List should leave single blankline before new element', withStore(async (store) => {
		const folds = await getFoldsForDocument(store, joinLines(
			`- a`,
			`a`,
			``,
			``,
			`b`
		));
		assert.strictEqual(folds.length, 1);
		const firstFold = folds[0];
		assert.strictEqual(firstFold.startLine, 0);
		assert.strictEqual(firstFold.endLine, 2);
	}));

	test('Should fold fenced code blocks', withStore(async (store) => {
		const folds = await getFoldsForDocument(store, joinLines(
			`~~~ts`,
			`a`,
			`~~~`,
			`b`,
		));
		assert.strictEqual(folds.length, 1);
		const firstFold = folds[0];
		assert.strictEqual(firstFold.startLine, 0);
		assert.strictEqual(firstFold.endLine, 2);
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
		assert.strictEqual(folds.length, 1);
		const firstFold = folds[0];
		assert.strictEqual(firstFold.startLine, 4);
		assert.strictEqual(firstFold.endLine, 6);
	}));

	test('Should fold html blocks', withStore(async (store) => {
		const folds = await getFoldsForDocument(store, joinLines(
			`x`,
			`<div>`,
			`	fa`,
			`</div>`,
		));
		assert.strictEqual(folds.length, 1);
		const firstFold = folds[0];
		assert.strictEqual(firstFold.startLine, 1);
		assert.strictEqual(firstFold.endLine, 3);
	}));

	test('Should fold html block comments', withStore(async (store) => {
		const folds = await getFoldsForDocument(store, joinLines(
			`x`,
			`<!--`,
			`fa`,
			`-->`
		));
		assert.strictEqual(folds.length, 1);
		const firstFold = folds[0];
		assert.strictEqual(firstFold.startLine, 1);
		assert.strictEqual(firstFold.endLine, 3);
		assert.strictEqual(firstFold.kind, lsp.FoldingRangeKind.Comment);
	}));
});
