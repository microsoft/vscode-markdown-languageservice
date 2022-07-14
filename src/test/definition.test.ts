/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as lsp from 'vscode-languageserver-types';
import { URI } from 'vscode-uri';
import { getLsConfiguration } from '../config';
import { MdDefinitionProvider } from '../languageFeatures/definitions';
import { MdReferencesProvider } from '../languageFeatures/references';
import { MdTableOfContentsProvider } from '../tableOfContents';
import { noopToken } from '../util/cancellation';
import { DisposableStore } from '../util/dispose';
import { IWorkspace } from '../workspace';
import { createNewMarkdownEngine } from './engine';
import { InMemoryDocument } from './inMemoryDocument';
import { InMemoryWorkspace } from './inMemoryWorkspace';
import { nulLogger } from './nulLogging';
import { joinLines, withStore, workspacePath } from './util';


function getDefinition(store: DisposableStore, doc: InMemoryDocument, pos: lsp.Position, workspace: IWorkspace) {
	const engine = createNewMarkdownEngine();
	const tocProvider = store.add(new MdTableOfContentsProvider(engine, workspace, nulLogger));
	const referencesProvider = store.add(new MdReferencesProvider(getLsConfiguration({}), engine, workspace, tocProvider, nulLogger));
	const provider = new MdDefinitionProvider(referencesProvider);
	return provider.provideDefinition(doc, pos, noopToken);
}

function assertDefinitionsEqual(actualDef: lsp.Definition, ...expectedDefs: { uri: URI; line: number; startCharacter?: number; endCharacter?: number }[]) {
	const actualDefsArr = Array.isArray(actualDef) ? actualDef : [actualDef];

	assert.strictEqual(actualDefsArr.length, expectedDefs.length, `Definition counts should match`);

	for (let i = 0; i < actualDefsArr.length; ++i) {
		const actual = actualDefsArr[i];
		const expected = expectedDefs[i];
		assert.strictEqual(actual.uri.toString(), expected.uri.toString(), `Definition '${i}' has expected document`);
		assert.strictEqual(actual.range.start.line, expected.line, `Definition '${i}' has expected start line`);
		assert.strictEqual(actual.range.end.line, expected.line, `Definition '${i}' has expected end line`);
		if (typeof expected.startCharacter !== 'undefined') {
			assert.strictEqual(actual.range.start.character, expected.startCharacter, `Definition '${i}' has expected start character`);
		}
		if (typeof expected.endCharacter !== 'undefined') {
			assert.strictEqual(actual.range.end.character, expected.endCharacter, `Definition '${i}' has expected end character`);
		}
	}
}

suite('Definitions', () => {
	test('Should not return definition when on link text', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('doc.md'), joinLines(
			`[ref](#abc)`,
			`[ref]: http://example.com`,
		));
		const workspace = store.add(new InMemoryWorkspace([doc]));

		const defs = await getDefinition(store, doc, { line: 0, character: 1 }, workspace);
		assert.deepStrictEqual(defs, undefined);
	}));

	test('Should find definition links within file from link', withStore(async (store) => {
		const docUri = workspacePath('doc.md');
		const doc = new InMemoryDocument(docUri, joinLines(
			`[link 1][abc]`, // trigger here
			``,
			`[abc]: https://example.com`,
		));
		const workspace = store.add(new InMemoryWorkspace([doc]));

		const defs = await getDefinition(store, doc, { line: 0, character: 12 }, workspace);
		assertDefinitionsEqual(defs!,
			{ uri: docUri, line: 2 },
		);
	}));

	test('Should find definition links using shorthand', withStore(async (store) => {
		const docUri = workspacePath('doc.md');
		const doc = new InMemoryDocument(docUri, joinLines(
			`[ref]`, // trigger 1
			``,
			`[yes][ref]`, // trigger 2
			``,
			`[ref]: /Hello.md` // trigger 3
		));
		const workspace = store.add(new InMemoryWorkspace([doc]));

		{
			const defs = await getDefinition(store, doc, { line: 0, character: 2 }, workspace);
			assertDefinitionsEqual(defs!,
				{ uri: docUri, line: 4 },
			);
		}
		{
			const defs = await getDefinition(store, doc, { line: 2, character: 7 }, workspace);
			assertDefinitionsEqual(defs!,
				{ uri: docUri, line: 4 },
			);
		}
		{
			const defs = await getDefinition(store, doc, { line: 4, character: 2 }, workspace);
			assertDefinitionsEqual(defs!,
				{ uri: docUri, line: 4 },
			);
		}
	}));

	test('Should find definition links within file from definition', withStore(async (store) => {
		const docUri = workspacePath('doc.md');
		const doc = new InMemoryDocument(docUri, joinLines(
			`[link 1][abc]`,
			``,
			`[abc]: https://example.com`, // trigger here
		));
		const workspace = store.add(new InMemoryWorkspace([doc]));

		const defs = await getDefinition(store, doc, { line: 2, character: 3 }, workspace);
		assertDefinitionsEqual(defs!,
			{ uri: docUri, line: 2 },
		);
	}));

	test('Should not find definition links across files', withStore(async (store) => {
		const docUri = workspacePath('doc.md');
		const doc = new InMemoryDocument(docUri, joinLines(
			`[link 1][abc]`,
			``,
			`[abc]: https://example.com`,
		));
		const workspace = store.add(new InMemoryWorkspace([
			doc,
			new InMemoryDocument(workspacePath('other.md'), joinLines(
				`[link 1][abc]`,
				``,
				`[abc]: https://example.com?bad`
			))
		]));

		const defs = await getDefinition(store, doc, { line: 0, character: 12 }, workspace);
		assertDefinitionsEqual(defs!,
			{ uri: docUri, line: 2 },
		);
	}));

	test('Should support going to header from link', withStore(async (store) => {
		const docUri = workspacePath('doc.md');
		const doc = new InMemoryDocument(docUri, joinLines(
			`# Header`,
			`[text](#header)`,
			`[ref]: #header`,
		));
		const workspace = store.add(new InMemoryWorkspace([doc]));

		{
			const defs = await getDefinition(store, doc, { line: 1, character: 8 }, workspace);
			assertDefinitionsEqual(defs!,
				{ uri: docUri, line: 0 },
			);
		}
		{
			const defs = await getDefinition(store, doc, { line: 2, character: 8 }, workspace);
			assertDefinitionsEqual(defs!,
				{ uri: docUri, line: 0 },
			);
		}
	}));
});
