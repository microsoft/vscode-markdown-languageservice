/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as lsp from 'vscode-languageserver-types';
import { MdDocumentSymbolProvider } from '../languageFeatures/documentSymbols';
import { MdTableOfContentsProvider } from '../tableOfContents';
import { DisposableStore } from '../util/dispose';
import { createNewMarkdownEngine } from './engine';
import { InMemoryDocument } from './inMemoryDocument';
import { InMemoryWorkspace } from './inMemoryWorkspace';
import { nulLogger } from './nulLogging';
import { joinLines, withStore, workspacePath } from './util';


function getSymbolsForFile(store: DisposableStore, fileContents: string) {
	const doc = new InMemoryDocument(workspacePath('test.md'), fileContents);
	const workspace = store.add(new InMemoryWorkspace([doc]));
	const engine = createNewMarkdownEngine();
	const tocProvider = store.add(new MdTableOfContentsProvider(engine, workspace, nulLogger));
	const provider = new MdDocumentSymbolProvider(tocProvider, nulLogger);
	return provider.provideDocumentSymbols(doc);
}

type ExpectedDocSymbol = {
	name: string;
	children?: readonly ExpectedDocSymbol[];
};

function assertDocumentSymbolsEqual(actual: readonly lsp.DocumentSymbol[], expected: ReadonlyArray<ExpectedDocSymbol>, path = '') {
	assert.strictEqual(actual.length, expected.length, 'Link counts to be equal');

	for (let i = 0; i < actual.length; ++i) {
		const exp = expected[i];
		const act = actual[i];
		assert.strictEqual(act.name, exp.name, `Name to be equal. Path: ${path}`);
		if (!act.children) {
			assert.ok(!exp.children || exp.children.length === 0);
		} else if (!exp.children) {
			assert.ok(!act.children || act.children.length === 0);
		} else {
			assertDocumentSymbolsEqual(act.children, exp.children, path ? `${path}-${i}` : `${i}`);
		}
	}
}

suite('Document symbols', () => {
	test('Should not return anything for empty document', withStore(async (store) => {
		const symbols = await getSymbolsForFile(store, '');
		assertDocumentSymbolsEqual(symbols, []);
	}));

	test('Should not return anything for document with no headers', withStore(async (store) => {
		const symbols = await getSymbolsForFile(store, joinLines(
			`a`,
			`a`,
		));
		assertDocumentSymbolsEqual(symbols, []);
	}));

	test('Should not return anything for document with # but no real headers', withStore(async (store) => {
		const symbols = await getSymbolsForFile(store, joinLines(
			`a#a`,
			`a#`,
		));
		assertDocumentSymbolsEqual(symbols, []);
	}));

	test('Should return single symbol for single header', withStore(async (store) => {
		const symbols = await getSymbolsForFile(store, '# h');
		assertDocumentSymbolsEqual(symbols, [
			{ name: '# h' },
		]);
	}));

	test('Should not care about symbol level for single header', withStore(async (store) => {
		const symbols = await getSymbolsForFile(store, '### h');
		assertDocumentSymbolsEqual(symbols, [
			{ name: '### h' },
		]);
	}));

	test('Should put symbols of same level in flat list', withStore(async (store) => {
		const symbols = await getSymbolsForFile(store, joinLines(
			`## h`,
			`## h2`,
		));
		assertDocumentSymbolsEqual(symbols, [
			{ name: '## h' },
			{ name: '## h2' },
		]);
	}));

	test('Should nest symbol of level - 1 under parent', withStore(async (store) => {
		const symbols = await getSymbolsForFile(store, joinLines(
			`# h`,
			`## h2`,
			`## h3`,
		));
		assertDocumentSymbolsEqual(symbols, [
			{
				name: '# h',
				children: [
					{ name: '## h2' },
					{ name: '## h3' },
				]
			}
		]);
	}));

	test('Should nest symbol of level - n under parent', withStore(async (store) => {
		const symbols = await getSymbolsForFile(store, joinLines(
			`# h`,
			`#### h2`,
		));
		assertDocumentSymbolsEqual(symbols, [
			{
				name: '# h',
				children: [
					{ name: '#### h2' }
				]
			}
		]);
	}));

	test('Should flatten children where lower level occurs first', withStore(async (store) => {
		const symbols = await getSymbolsForFile(store, joinLines(
			`# h`,
			`### h2`,
			`## h3`,
		));
		assertDocumentSymbolsEqual(symbols, [
			{
				name: '# h',
				children: [
					{ name: '### h2' },
					{ name: '## h3' },
				]
			},
		]);
	}));

	test('Should handle line separator in file. Issue #63749', withStore(async (store) => {
		const symbols = await getSymbolsForFile(store, joinLines(
			`# A`,
			`- foo`,
			``,
			`# B`,
			`- bar`,
		));
		assertDocumentSymbolsEqual(symbols, [
			{ name: '# A' },
			{ name: '# B' },
		]);
	}));
});

