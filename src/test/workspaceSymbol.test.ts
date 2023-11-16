/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import * as lsp from 'vscode-languageserver-types';
import { IWorkspace } from '..';
import { getLsConfiguration } from '../config';
import { MdLinkProvider } from '../languageFeatures/documentLinks';
import { MdDocumentSymbolProvider } from '../languageFeatures/documentSymbols';
import { MdWorkspaceSymbolProvider } from '../languageFeatures/workspaceSymbols';
import { MdTableOfContentsProvider } from '../tableOfContents';
import { noopToken } from '../util/cancellation';
import { DisposableStore } from '../util/dispose';
import { createNewMarkdownEngine } from './engine';
import { InMemoryDocument } from './inMemoryDocument';
import { InMemoryWorkspace } from './inMemoryWorkspace';
import { nulLogger } from './nulLogging';
import { joinLines, withStore, workspacePath } from './util';

function getWorkspaceSymbols(store: DisposableStore, workspace: IWorkspace, query = ''): Promise<lsp.WorkspaceSymbol[]> {
	const engine = createNewMarkdownEngine();
	const tocProvider = store.add(new MdTableOfContentsProvider(engine, workspace, nulLogger));
	const linkProvider = store.add(new MdLinkProvider(getLsConfiguration({}), engine, workspace, tocProvider, nulLogger));
	const symbolProvider = new MdDocumentSymbolProvider(tocProvider, linkProvider, nulLogger);
	const workspaceSymbolProvider = store.add(new MdWorkspaceSymbolProvider(workspace, symbolProvider));
	return workspaceSymbolProvider.provideWorkspaceSymbols(query, noopToken);
}

function assertSymbolsMatch(symbols: readonly lsp.WorkspaceSymbol[], expectedNames: readonly string[]): void {
	assert.strictEqual(symbols.length, expectedNames.length);
	for (let i = 0; i < symbols.length; i++) {
		assert.strictEqual(symbols[i].name, expectedNames[i]);
	}
}

suite('Workspace symbols', () => {
	test('Should not return anything for empty workspace', withStore(async (store) => {
		const workspace = store.add(new InMemoryWorkspace([]));
		assert.deepStrictEqual(await getWorkspaceSymbols(store, workspace, ''), []);
	}));

	test('Should return symbols from workspace with one markdown file', withStore(async (store) => {
		const workspace = store.add(new InMemoryWorkspace([
			new InMemoryDocument(workspacePath('test.md'), `# header1\nabc\n## header2`)
		]));

		assertSymbolsMatch(await getWorkspaceSymbols(store, workspace, ''), ['# header1', '## header2']);
	}));

	test('Should return all content basic workspace', withStore(async (store) => {
		const fileNameCount = 10;
		const files: InMemoryDocument[] = [];
		for (let i = 0; i < fileNameCount; ++i) {
			const testFileName = workspacePath(`test${i}.md`);
			files.push(new InMemoryDocument(testFileName, `# common\nabc\n## header${i}`));
		}

		const workspace = store.add(new InMemoryWorkspace(files));

		const symbols = await getWorkspaceSymbols(store, workspace, '');
		assert.strictEqual(symbols.length, fileNameCount * 2);
	}));

	test('Should update results when markdown file changes symbols', withStore(async (store) => {
		const testFileName = workspacePath('test.md');
		const workspace = store.add(new InMemoryWorkspace([
			new InMemoryDocument(testFileName, `# header1`, 1 /* version */)
		]));

		assert.strictEqual((await getWorkspaceSymbols(store, workspace, '')).length, 1);

		// Update file
		workspace.updateDocument(new InMemoryDocument(testFileName, `# new header\nabc\n## header2`, 2 /* version */));
		assertSymbolsMatch(await getWorkspaceSymbols(store, workspace, ''), ['# new header', '## header2']);
	}));

	test('Should remove results when file is deleted', withStore(async (store) => {
		const testFileName = workspacePath('test.md');

		const workspace = store.add(new InMemoryWorkspace([
			new InMemoryDocument(testFileName, `# header1`)
		]));

		assert.strictEqual((await getWorkspaceSymbols(store, workspace, '')).length, 1);

		// delete file
		workspace.deleteDocument(testFileName);
		const newSymbols = await getWorkspaceSymbols(store, workspace, '');
		assert.strictEqual(newSymbols.length, 0);
	}));

	test('Should update results when markdown file is created', withStore(async (store) => {
		const testFileName = workspacePath('test.md');

		const workspace = store.add(new InMemoryWorkspace([
			new InMemoryDocument(testFileName, `# header1`)
		]));

		assert.strictEqual((await getWorkspaceSymbols(store, workspace, '')).length, 1);

		// Create file
		workspace.createDocument(new InMemoryDocument(workspacePath('test2.md'), `# new header\nabc\n## header2`));
		const newSymbols = await getWorkspaceSymbols(store, workspace, '');
		assert.strictEqual(newSymbols.length, 3);
	}));

	test('Should not include link definitions', withStore(async (store) => {
		const workspace = store.add(new InMemoryWorkspace([
			new InMemoryDocument(workspacePath('test.md'), joinLines(
				`# header1`,
				`[def]: http://example.com`
			))
		]));

		assertSymbolsMatch(await getWorkspaceSymbols(store, workspace, ''), ['# header1']);
	}));

	test('Should match case insensitively', withStore(async (store) => {
		const workspace = store.add(new InMemoryWorkspace([
			new InMemoryDocument(workspacePath('test.md'), `# aBc1\nabc\n## ABc2`)
		]));

		assertSymbolsMatch(await getWorkspaceSymbols(store, workspace, 'ABC'), ['# aBc1', '## ABc2']);
		assertSymbolsMatch(await getWorkspaceSymbols(store, workspace, 'abc'), ['# aBc1', '## ABc2']);
	}));

	test('Should match fuzzyily', withStore(async (store) => {
		const workspace = store.add(new InMemoryWorkspace([
			new InMemoryDocument(workspacePath('test.md'), `# cat dog fish`)
		]));

		assertSymbolsMatch(await getWorkspaceSymbols(store, workspace, 'cat'), ['# cat dog fish']);
		assertSymbolsMatch(await getWorkspaceSymbols(store, workspace, 'cdf'), ['# cat dog fish']);
		assertSymbolsMatch(await getWorkspaceSymbols(store, workspace, 'catfish'), ['# cat dog fish']);
		assertSymbolsMatch(await getWorkspaceSymbols(store, workspace, 'fishcat'), []); // wrong order
		assertSymbolsMatch(await getWorkspaceSymbols(store, workspace, 'ccat'), []); 
	}));
});
