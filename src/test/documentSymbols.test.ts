/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as lsp from 'vscode-languageserver-types';
import { MdLinkProvider } from '../languageFeatures/documentLinks';
import { MdDocumentSymbolProvider, ProvideDocumentSymbolOptions } from '../languageFeatures/documentSymbols';
import { MdTableOfContentsProvider } from '../tableOfContents';
import { makeRange } from '../types/range';
import { noopToken } from '../util/cancellation';
import { DisposableStore } from '../util/dispose';
import { createNewMarkdownEngine } from './engine';
import { InMemoryDocument } from './inMemoryDocument';
import { InMemoryWorkspace } from './inMemoryWorkspace';
import { nulLogger } from './nulLogging';
import { assertRangeEqual, joinLines, withStore, workspacePath } from './util';


function getSymbolsForFile(store: DisposableStore, fileContents: string, options: ProvideDocumentSymbolOptions = {}) {
	const doc = new InMemoryDocument(workspacePath('test.md'), fileContents);
	const workspace = store.add(new InMemoryWorkspace([doc]));
	const engine = createNewMarkdownEngine();
	const tocProvider = store.add(new MdTableOfContentsProvider(engine, workspace, nulLogger));
	const linkProvider = store.add(new MdLinkProvider(engine, workspace, tocProvider, nulLogger));
	const provider = new MdDocumentSymbolProvider(tocProvider, linkProvider, nulLogger);
	return provider.provideDocumentSymbols(doc, options, noopToken);
}

interface ExpectedDocSymbol {
	readonly name: string;
	readonly range?: lsp.Range;
	readonly selectionRange?: lsp.Range;
	readonly children?: readonly ExpectedDocSymbol[];
}

function assertDocumentSymbolsEqual(actual: readonly lsp.DocumentSymbol[], expected: ReadonlyArray<ExpectedDocSymbol>, path = '') {
	assert.strictEqual(actual.length, expected.length, 'Link counts to be equal');

	for (let i = 0; i < actual.length; ++i) {
		const exp = expected[i];
		const act = actual[i];
		assert.strictEqual(act.name, exp.name, `Name to be equal. Path: ${path}`);

		if (exp.range) {
			assertRangeEqual(exp.range, act.range, `Range to be equal. Path: ${path}`);
		}

		if (exp.selectionRange) {
			assertRangeEqual(exp.selectionRange, act.selectionRange, `Selection range to be equal. Path: ${path}`);
		}

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

	test('Should not include document symbols by default', withStore(async (store) => {
		const symbols = await getSymbolsForFile(store, joinLines(
			`[def]: http://example.com`,
			``,
			`[def 2]: http://example.com`,
		), {});
		assertDocumentSymbolsEqual(symbols, []);
	}));

	test('Should provide symbols for link definitions', withStore(async (store) => {
		const symbols = await getSymbolsForFile(store, joinLines(
			`[def]: http://example.com`,
			``,
			`[def 2]: http://example.com`,
		), { includeLinkDefinitions: true });
		assertDocumentSymbolsEqual(symbols, [
			{ name: '[def]', range: makeRange(0, 0, 0, 25), selectionRange: makeRange(0, 1, 0, 4), },
			{ name: '[def 2]', range: makeRange(2, 0, 2, 27), selectionRange: makeRange(2, 1, 2, 6), },
		]);
	}));

	test('Should nest link definitions under headers but put trailing links in top level', withStore(async (store) => {
		const symbols = await getSymbolsForFile(store, joinLines(
			`[def 1]: http://example.com`,
			`# h1`,
			`[def 2]: http://example.com`,
			`#### h2`,
			`[def 3]: http://example.com`,
			`## h3`,
			`[def 4]: http://example.com`, // Should be under top level document, not under h3
		), { includeLinkDefinitions: true });

		assertDocumentSymbolsEqual(symbols, [
			{ name: '[def 1]', range: makeRange(0, 0, 0, 27), selectionRange: makeRange(0, 1, 0, 6), },
			{
				name: '# h1',
				children: [
					{ name: '[def 2]', range: makeRange(2, 0, 2, 27), selectionRange: makeRange(2, 1, 2, 6), },
					{
						name: '#### h2',
						children: [
							{ name: '[def 3]', range: makeRange(4, 0, 4, 27), selectionRange: makeRange(4, 1, 4, 6), },
						]
					},
					{ name: '## h3', children: [] },
				]
			},
			{ name: '[def 4]', range: makeRange(6, 0, 6, 27), selectionRange: makeRange(6, 1, 6, 6), },
		]);
	}));
});

