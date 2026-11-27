/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import * as lsp from 'vscode-languageserver-protocol';
import { getLsConfiguration } from '../config.js';
import { MdLinkProvider } from '../languageFeatures/documentLinks.js';
import { MdOrganizeLinkDefinitionProvider } from '../languageFeatures/organizeLinkDefs.js';
import { MdTableOfContentsProvider } from '../tableOfContents.js';
import { InMemoryDocument } from '../types/inMemoryDocument.js';
import { noopToken } from '../util/cancellation.js';
import { createNewMarkdownEngine } from './engine.js';
import { InMemoryWorkspace } from './inMemoryWorkspace.js';
import { nulLogger } from './nulLogging.js';
import { DisposableStore, joinLines, withStore, workspacePath } from './util.js';

async function getOrganizeEdits(store: DisposableStore, doc: InMemoryDocument, removeUnused = false): Promise<lsp.TextEdit[]> {
	const workspace = store.add(new InMemoryWorkspace([doc]));
	const engine = createNewMarkdownEngine();
	const config = getLsConfiguration({});

	const tocProvider = store.add(new MdTableOfContentsProvider(engine, workspace, nulLogger));
	const linkProvider = store.add(new MdLinkProvider(config, engine, workspace, tocProvider, nulLogger));
	const organizer = new MdOrganizeLinkDefinitionProvider(linkProvider);
	return organizer.getOrganizeLinkDefinitionEdits(doc, { removeUnused }, noopToken);
}

suite('Organize link definitions', () => {
	test('Should organize thousands of scattered definitions without overflowing the stack', withStore(async (store) => {
		const count = 8000;
		const definitions = Array.from({ length: count }, (_, index) => {
			const id = String(count - index - 1).padStart(4, '0');
			return `[ref-${id}]: https://example.com/${id}`;
		});
		const content = definitions.flatMap((definition, index) => [definition, '', `Paragraph ${index}`, '']).concat('Tail').join('\n');
		const doc = new InMemoryDocument(workspacePath('large.md'), content);
		const edits = await getOrganizeEdits(store, doc);

		assert.strictEqual(edits.length, count + 1);
		const expected = definitions.flatMap((_, index) => ['', '', `Paragraph ${index}`, ''])
			.concat('Tail', '', [...definitions].reverse().join('\n')).join('\n');
		assert.strictEqual(doc.previewEdits(edits), expected);
	}));

	test('Should preserve mixed group boundaries and replace the trailing definition block', withStore(async (store) => {
		const definitions = ['a', 'b', 'c', 'd'].map(id => `[${id}]: https://example.com/${id}`);
		const doc = new InMemoryDocument(workspacePath('mixed.md'), joinLines(
			'head', definitions[1], definitions[0], 'middle', definitions[3], 'tail', '', definitions[2],
		));
		const edits = await getOrganizeEdits(store, doc);
		assert.strictEqual(doc.previewEdits(edits), joinLines(
			'head', '', 'middle', '', 'tail', '', ...definitions,
		));
	}));

	test('Should return empty edit for file without links', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('test.md'), joinLines(`# h1`));
		const edits = await getOrganizeEdits(store, doc);
		assert.deepStrictEqual(edits, []);
	}));

	test('Should return empty if definitions are already sorted', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('test.md'), joinLines(
			`[a]: http://example.com`,
			`[b]: http://example.com`,
		));
		const edits = await getOrganizeEdits(store, doc);
		assert.deepStrictEqual(edits, []);
	}));

	test('Should sort basic link definitions', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('test.md'), joinLines(
			`[b]: http://example.com`,
			`[a]: http://example.com`,
		));
		const edits = await getOrganizeEdits(store, doc);
		const newContent = doc.previewEdits(edits);
		assert.deepStrictEqual(newContent, joinLines(
			`[a]: http://example.com`,
			`[b]: http://example.com`,
		));
	}));

	test('Should move link definition to bottom of file', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('test.md'), joinLines(
			`x`,
			`[a]: http://example.com`,
			`y`,
		));
		const edits = await getOrganizeEdits(store, doc);
		const newContent = doc.previewEdits(edits);
		assert.deepStrictEqual(newContent, joinLines(
			`x`,
			``,
			`y`,
			``,
			`[a]: http://example.com`,
		));
	}));

	test('Should not add extra new line if one already exists', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('test.md'), joinLines(
			`x`,
			`[a]: http://example.com`,
			`y`,
			``,
		));
		const edits = await getOrganizeEdits(store, doc);
		const newContent = doc.previewEdits(edits);
		assert.deepStrictEqual(newContent, joinLines(
			`x`,
			``,
			`y`,
			``,
			`[a]: http://example.com`,
		));
	}));

	test('Should group link definitions to bottom of file', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('test.md'), joinLines(
			`x`,
			`[b]: http://example.com`,
			`y`,
			`[a]: http://example.com`,
		));
		const edits = await getOrganizeEdits(store, doc);
		const newContent = doc.previewEdits(edits);
		assert.deepStrictEqual(newContent, joinLines(
			`x`,
			``,
			`y`,
			``,
			`[a]: http://example.com`,
			`[b]: http://example.com`,
		));
	}));

	test('Should sort existing definition block', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('test.md'), joinLines(
			`* [SQL Server documentation]`,
			`* [SQL Server on Linux documentation]`,
			`* [SQL Server Blog]`,
			``,
			`[Transact-SQL]: https://docs.microsoft.com/sql/t-sql/language-reference`,
			`[mssql]: https://aka.ms/mssql-marketplace`,
			`[Download VS Code]: https://code.visualstudio.com/download`,
			`[SQL Server 2017 Developer Edition]: https://www.microsoft.com/sql-server/sql-server-downloads`,
			`[Build an app]: https://aka.ms/sqldev`,
			`[SQL Server documentation]: https://docs.microsoft.com/sql/sql-server/sql-server-technical-documentation`,
			`[SQL Server on Linux documentation]: https://docs.microsoft.com/sql/linux/`,
			`[SQL Server Blog]: https://blogs.technet.microsoft.com/dataplatforminsider/`,
			`[GitHub]: https://github.com/microsoft/vscode-mssql`,
			`[GitHub Issue Tracker]: https://github.com/microsoft/vscode-mssql/issues`,
		));
		const edits = await getOrganizeEdits(store, doc);
		const newContent = doc.previewEdits(edits);
		assert.deepStrictEqual(newContent, joinLines(
			`* [SQL Server documentation]`,
			`* [SQL Server on Linux documentation]`,
			`* [SQL Server Blog]`,
			``,
			`[Build an app]: https://aka.ms/sqldev`,
			`[Download VS Code]: https://code.visualstudio.com/download`,
			`[GitHub]: https://github.com/microsoft/vscode-mssql`,
			`[GitHub Issue Tracker]: https://github.com/microsoft/vscode-mssql/issues`,
			`[mssql]: https://aka.ms/mssql-marketplace`,
			`[SQL Server 2017 Developer Edition]: https://www.microsoft.com/sql-server/sql-server-downloads`,
			`[SQL Server Blog]: https://blogs.technet.microsoft.com/dataplatforminsider/`,
			`[SQL Server documentation]: https://docs.microsoft.com/sql/sql-server/sql-server-technical-documentation`,
			`[SQL Server on Linux documentation]: https://docs.microsoft.com/sql/linux/`,
			`[Transact-SQL]: https://docs.microsoft.com/sql/t-sql/language-reference`,
		));
	}));

	test('Should preserved trailing newline', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('test.md'), joinLines(
			`x`,
			`[b]: http://example.com`,
			`y`,
			``,
			`[a]: http://example.com`,
			``,
		));
		const edits = await getOrganizeEdits(store, doc);
		const newContent = doc.previewEdits(edits);
		assert.deepStrictEqual(newContent, joinLines(
			`x`,
			``,
			`y`,
			``,
			`[a]: http://example.com`,
			`[b]: http://example.com`,
			``,
		));
	}));

	test('Should leave behind single newline after moving definition', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('test.md'), joinLines(
			`[z]: http://example.com?z`,
			`a`,
			`[x]: http://example.com?x`,
			`[x2]: http://example.com?x2`,
			`b`,
			`[y]: http://example.com?y`,
			`c`,
			``,
		));

		const edits = await getOrganizeEdits(store, doc);
		const newContent = doc.previewEdits(edits);
		assert.deepStrictEqual(newContent, joinLines(
			``,
			`a`,
			``,
			`b`,
			``,
			`c`,
			``,
			`[x]: http://example.com?x`,
			`[x2]: http://example.com?x2`,
			`[y]: http://example.com?y`,
			`[z]: http://example.com?z`,
		));
	}));

	test('Should not move links within code blocks', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('test.md'), joinLines(
			`[z]: http://example.com?z`,
			`a`,
			`~~~`,
			`[x]: http://example.com?x`,
			`~~~`,
			``,
			``,
			`    [x2]: http://example.com?x2`,
			``,
			`b`,
			`[y]: http://example.com?y`,
			`c`,
			``,
		));

		const edits = await getOrganizeEdits(store, doc);
		const newContent = doc.previewEdits(edits);
		assert.deepStrictEqual(newContent, joinLines(
			``,
			`a`,
			`~~~`,
			`[x]: http://example.com?x`,
			`~~~`,
			``,
			``,
			`    [x2]: http://example.com?x2`,
			``,
			`b`,
			``,
			`c`,
			``,
			`[y]: http://example.com?y`,
			`[z]: http://example.com?z`,
		));
	}));

	test('Should preserve order of duplicate link definitions', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('test.md'), joinLines(
			`x`,
			`[def]: http://example.com?1`,
			`y`,
			`[def]: http://example.com?2`,
			`z`,
		));
		const edits = await getOrganizeEdits(store, doc);
		const newContent = doc.previewEdits(edits);
		assert.deepStrictEqual(newContent, joinLines(
			`x`,
			``,
			`y`,
			``,
			`z`,
			``,
			`[def]: http://example.com?1`,
			`[def]: http://example.com?2`,
		));
	}));

	test('Should remove unused definitions when enabled', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('test.md'), joinLines(
			`text [b] text`,
			``,
			`[a]: http://example.com`,
			`[b]: http://example.com`,
		));
		const edits = await getOrganizeEdits(store, doc, /* removeUnused */ true);
		const newContent = doc.previewEdits(edits);
		assert.deepStrictEqual(newContent, joinLines(
			`text [b] text`,
			``,
			`[b]: http://example.com`,
		));
	}));

	test('Should sort and remove unused definitions when enabled', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('test.md'), joinLines(
			`text [a] text [link][c]`,
			``,
			`[c]: http://example.com?c`,
			`[b]: http://example.com?b`,
			`[a]: http://example.com?a`,
		));
		const edits = await getOrganizeEdits(store, doc, /* removeUnused */ true);
		const newContent = doc.previewEdits(edits);
		assert.deepStrictEqual(newContent, joinLines(
			`text [a] text [link][c]`,
			``,
			`[a]: http://example.com?a`,
			`[c]: http://example.com?c`,
		));
	}));
});
