/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as lsp from 'vscode-languageserver-types';
import { URI } from 'vscode-uri';
import { getLsConfiguration } from '../config';
import { createWorkspaceLinkCache } from '../languageFeatures/documentLinks';
import { FileRenameResponse, MdFileRenameProvider } from '../languageFeatures/fileRename';
import { MdReferencesProvider } from '../languageFeatures/references';
import { MdTableOfContentsProvider } from '../tableOfContents';
import { makeRange } from '../types/range';
import { noopToken } from '../util/cancellation';
import { DisposableStore } from '../util/dispose';
import { IWorkspace } from '../workspace';
import { createNewMarkdownEngine } from './engine';
import { InMemoryDocument } from './inMemoryDocument';
import { InMemoryWorkspace } from './inMemoryWorkspace';
import { nulLogger } from './nulLogging';
import { assertRangeEqual, joinLines, withStore, workspacePath } from './util';

/**
 * Get all the edits for a file rename.
 */
function getFileRenameEdits(store: DisposableStore, edits: ReadonlyArray<{ oldUri: URI, newUri: URI }>, workspace: IWorkspace): Promise<FileRenameResponse | undefined> {
	const config = getLsConfiguration({});
	const engine = createNewMarkdownEngine();
	const tocProvider = store.add(new MdTableOfContentsProvider(engine, workspace, nulLogger));
	const linkCache = store.add(createWorkspaceLinkCache(engine, workspace));
	const referencesProvider = store.add(new MdReferencesProvider(config, engine, workspace, tocProvider, linkCache, nulLogger));
	const renameProvider = store.add(new MdFileRenameProvider(getLsConfiguration({}), workspace, linkCache, referencesProvider));
	return renameProvider.getRenameFilesInWorkspaceEdit(edits, noopToken);
}

interface ExpectedTextEdit {
	readonly uri: URI;
	readonly edits: readonly lsp.TextEdit[];
}


function assertEditsEqual(actualEdit: lsp.WorkspaceEdit, ...expectedTextEdits: ReadonlyArray<ExpectedTextEdit>) {
	const actualTextEdits = actualEdit.documentChanges?.filter(edit => lsp.TextDocumentEdit.is(edit)) as lsp.TextDocumentEdit[] ?? [];
	assert.strictEqual(actualTextEdits.length, expectedTextEdits.length, `Edit counts should match`);
	for (let i = 0; i < actualTextEdits.length; ++i) {
		const expected = expectedTextEdits[i];
		const actual = actualTextEdits[i];

		const actualDoc = actual.textDocument.uri;

		assert.strictEqual(actualDoc, expected.uri.toString(), `Edit '${i}' has expected document`);

		const actualEditForDoc = actual.edits;
		const expectedEditsForDoc = expected.edits;
		assert.strictEqual(actualEditForDoc.length, expectedEditsForDoc.length, `Edit counts for '${actualDoc}' should match`);

		for (let g = 0; g < actualEditForDoc.length; ++g) {
			assertRangeEqual(actualEditForDoc[g].range, expectedEditsForDoc[g].range, `Edit '${g}' of '${actualDoc}' has expected expected range. Expected range: ${JSON.stringify(actualEditForDoc[g].range)}. Actual range: ${JSON.stringify(expectedEditsForDoc[g].range)}`);
			assert.strictEqual(actualEditForDoc[g].newText, expectedEditsForDoc[g].newText, `Edit '${g}' of '${actualDoc}' has expected edits`);
		}
	}
}

suite('File Rename', () => {

	test('Rename file should update links', withStore(async (store) => {
		const uri = workspacePath('doc.md');
		const doc = new InMemoryDocument(uri, joinLines(
			`[abc](/old.md)`,
			`[abc](old.md)`,
			`[abc](./old.md)`,
			`[xyz]: ./old.md`,
			`[abc](/other.md)`,
			`[xyz1]: ./other.md`,
		));
		const workspace = store.add(new InMemoryWorkspace([doc]));

		const oldUri = workspacePath('old.md');
		const newUri = workspacePath('new.md');

		const response = await getFileRenameEdits(store, [{ oldUri, newUri }], workspace);
		assertEditsEqual(response!.edit, {
			uri, edits: [
				lsp.TextEdit.replace(makeRange(0, 6, 0, 13), '/new.md'),
				lsp.TextEdit.replace(makeRange(1, 6, 1, 12), 'new.md'),
				lsp.TextEdit.replace(makeRange(2, 6, 2, 14), './new.md'),
				lsp.TextEdit.replace(makeRange(3, 7, 3, 15), './new.md'),
			]
		});
	}));

	test('Rename file should ignore fragments', withStore(async (store) => {
		const uri = workspacePath('doc.md');
		const doc = new InMemoryDocument(uri, joinLines(
			`[abc](/old.md#frag)`,
			`[abc](old.md#frag)`,
			`[abc](./old.md#frag)`,
			`[xyz]: ./old.md#frag`,
		));
		const workspace = store.add(new InMemoryWorkspace([doc]));

		const oldUri = workspacePath('old.md');
		const newUri = workspacePath('new.md');

		const response = await getFileRenameEdits(store, [{ oldUri, newUri }], workspace);
		assertEditsEqual(response!.edit, {
			uri, edits: [
				lsp.TextEdit.replace(makeRange(0, 6, 0, 13), '/new.md'),
				lsp.TextEdit.replace(makeRange(1, 6, 1, 12), 'new.md'),
				lsp.TextEdit.replace(makeRange(2, 6, 2, 14), './new.md'),
				lsp.TextEdit.replace(makeRange(3, 7, 3, 15), './new.md'),
			]
		});
	}));

	test('Rename file should preserve usage of file extensions', withStore(async (store) => {
		const docUri = workspacePath('doc.md');
		const doc = new InMemoryDocument(docUri, joinLines(
			`[abc](/old#frag)`,
			`[abc](old#frag)`,
			`[abc](./old#frag)`,
			`[xyz]: ./old#frag`,
		));
		const workspace = store.add(new InMemoryWorkspace([doc]));

		const oldUri = workspacePath('old.md');
		const newUri = workspacePath('new.md');

		const response = await getFileRenameEdits(store, [{ oldUri, newUri }], workspace);
		assertEditsEqual(response!.edit, {
			uri: docUri, edits: [
				lsp.TextEdit.replace(makeRange(0, 6, 0, 10), '/new'),
				lsp.TextEdit.replace(makeRange(1, 6, 1, 9), 'new'),
				lsp.TextEdit.replace(makeRange(2, 6, 2, 11), './new'),
				lsp.TextEdit.replace(makeRange(3, 7, 3, 12), './new'),
			]
		});
	}));

	test('Rename file should encode links with spaces', withStore(async (store) => {
		const docUri = workspacePath('doc.md');
		const doc = new InMemoryDocument(docUri, joinLines(
			`[abc](/old.md)`,
			`[abc](old.md)`,
			`[abc](./old.md)`,
			`[xyz]: ./old.md`,
			`[abc](/other.md)`,
			`[xyz1]: ./other.md`,
		));
		const workspace = store.add(new InMemoryWorkspace([doc]));

		const oldUri = workspacePath('old.md');
		const newUri = workspacePath('new with space.md');

		const response = await getFileRenameEdits(store, [{ oldUri, newUri }], workspace);
		assertEditsEqual(response!.edit, {
			uri: docUri, edits: [
				lsp.TextEdit.replace(makeRange(0, 6, 0, 13), '/new%20with%20space.md'),
				lsp.TextEdit.replace(makeRange(1, 6, 1, 12), 'new%20with%20space.md'),
				lsp.TextEdit.replace(makeRange(2, 6, 2, 14), './new%20with%20space.md'),
				lsp.TextEdit.replace(makeRange(3, 7, 3, 15), './new%20with%20space.md'),
			]
		});
	}));

	test('Should support multiple file renames', withStore(async (store) => {
		const uri = workspacePath('doc.md');
		const doc = new InMemoryDocument(uri, joinLines(
			`[cat](/cat.png)`,
			`[dog](/dog.png)`,

			`[cat](cat.png)`,
			`[dog](dog.png)`,

			`[cat](./cat.png)`,
			`[dog](./dog.png)`,

			`[cat]: ./cat.png`,
			`[dog]: ./dog.png`,
		));
		const workspace = store.add(new InMemoryWorkspace([doc]));

		const response = await getFileRenameEdits(store, [
			{ oldUri: workspacePath('cat.png'), newUri: workspacePath('kitty.png') },
			{ oldUri: workspacePath('dog.png'), newUri: workspacePath('hot', 'doggo.png') },
		], workspace);

		assertEditsEqual(response!.edit, {
			uri, edits: [
				lsp.TextEdit.replace(makeRange(0, 6, 0, 14), '/kitty.png'),
				lsp.TextEdit.replace(makeRange(2, 6, 2, 13), 'kitty.png'),
				lsp.TextEdit.replace(makeRange(4, 6, 4, 15), './kitty.png'),
				lsp.TextEdit.replace(makeRange(6, 7, 6, 16), './kitty.png'),

				lsp.TextEdit.replace(makeRange(1, 6, 1, 14), '/hot/doggo.png'),
				lsp.TextEdit.replace(makeRange(3, 6, 3, 13), 'hot/doggo.png'),
				lsp.TextEdit.replace(makeRange(5, 6, 5, 15), './hot/doggo.png'),
				lsp.TextEdit.replace(makeRange(7, 7, 7, 16), './hot/doggo.png'),
			]
		});
	}));

	test('Move of markdown file should update links within that file', withStore(async (store) => {
		const oldUri = workspacePath('doc.md');
		const newUri = workspacePath('sub', 'new.md');

		// Create the workspace in the state just after the file rename
		const doc = new InMemoryDocument(newUri, joinLines(
			`[abc](/other.md#frag)`,
			`[abc](other.md#frag)`, // 1
			`[abc](./other.md#frag)`, // 2
			`[xyz]: ./other.md#frag`, // 3
		));
		const workspace = store.add(new InMemoryWorkspace([doc]));

		const response = await getFileRenameEdits(store, [{ oldUri: oldUri, newUri }], workspace);
		assertEditsEqual(response!.edit, {
			uri: newUri, edits: [
				lsp.TextEdit.replace(makeRange(1, 6, 1, 14), '../other.md'),
				lsp.TextEdit.replace(makeRange(2, 6, 2, 16), '../other.md'),
				lsp.TextEdit.replace(makeRange(3, 7, 3, 17), '../other.md'),
			]
		});
	}));

	test('Rename within moved file should preserve file extensions', withStore(async (store) => {
		const oldUri = workspacePath('doc.md');
		const newUri = workspacePath('sub', 'new.md');

		// Create the workspace in the state just after the file rename
		const doc = new InMemoryDocument(newUri, joinLines(
			`[abc](/other#frag)`,
			`[abc](other#frag)`, // 1
			`[abc](./other#frag)`, // 2
			`[xyz]: ./other#frag`, // 3
		));
		const workspace = store.add(new InMemoryWorkspace([doc]));

		const response = await getFileRenameEdits(store, [{ oldUri: oldUri, newUri }], workspace);
		assertEditsEqual(response!.edit, {
			uri: newUri, edits: [
				lsp.TextEdit.replace(makeRange(1, 6, 1, 11), '../other'),
				lsp.TextEdit.replace(makeRange(2, 6, 2, 13), '../other'),
				lsp.TextEdit.replace(makeRange(3, 7, 3, 14), '../other'),
			]
		});
	}));

	test('Rename directory should update links to md files in that dir', withStore(async (store) => {
		const uri = workspacePath('doc.md');
		const doc = new InMemoryDocument(uri, joinLines(
			`[abc](/old/a.md)`, // 1
			`[abc](/old/b.md)`, // 2
			`[abc](old/a.md)`, // 3
			`[abc](old/b.md)`, // 4
			`[abc](./old/a.md)`, // 5
			`[abc](./old/b.md)`, // 6
			`[xyz]: ./old/a.md`, // 7
			`[xyz]: ./old/b.md`, // 8
			`[abc](/other.md)`,
			`[xyz1]: ./other.md`,
		));
		const workspace = store.add(new InMemoryWorkspace([
			doc,
			workspacePath('new', 'a.md'),
			workspacePath('new', 'b.md'),
		]));

		const oldUri = workspacePath('old');
		const newUri = workspacePath('new');

		const response = await getFileRenameEdits(store, [{ oldUri, newUri }], workspace);
		assertEditsEqual(response!.edit, {
			uri, edits: [
				lsp.TextEdit.replace(makeRange(0, 6, 0, 15), '/new/a.md'),
				lsp.TextEdit.replace(makeRange(1, 6, 1, 15), '/new/b.md'),

				lsp.TextEdit.replace(makeRange(2, 6, 2, 14), 'new/a.md'),
				lsp.TextEdit.replace(makeRange(3, 6, 3, 14), 'new/b.md'),

				lsp.TextEdit.replace(makeRange(4, 6, 4, 16), './new/a.md'),
				lsp.TextEdit.replace(makeRange(5, 6, 5, 16), './new/b.md'),

				lsp.TextEdit.replace(makeRange(6, 7, 6, 17), './new/a.md'),
				lsp.TextEdit.replace(makeRange(7, 7, 7, 17), './new/b.md'),
			]
		});
	}));

	test('Rename within moved file on directory move should update links within dir', withStore(async (store) => {
		const uri = workspacePath('new', 'doc.md');
		const doc = new InMemoryDocument(uri, joinLines(
			`[abc](/old/a.md)`, // 1
			`[abc](/old/b.md)`, // 2
			`[abc](a.md)`,
			`[abc](b.md)`,
			`[abc](./a.md)`,
			`[abc](./b.md)`,
			`[xyz]: ./a.md`,
			`[xyz]: ./b.md`,
			`[xyz]: ../old/a.md`, // 3
			`[xyz]: ../old/b.md`, // 4
			`[abc](/other.md)`,
			`[xyz1]: ./other.md`,
		));
		const workspace = store.add(new InMemoryWorkspace([
			doc,
			workspacePath('new', 'a.md'),
			workspacePath('new', 'b.md'),
		]));

		const oldUri = workspacePath('old');
		const newUri = workspacePath('new');

		const response = await getFileRenameEdits(store, [{ oldUri: oldUri, newUri }], workspace);
		assertEditsEqual(response!.edit, {
			uri: uri, edits: [
				lsp.TextEdit.replace(makeRange(0, 6, 0, 15), '/new/a.md'),
				lsp.TextEdit.replace(makeRange(1, 6, 1, 15), '/new/b.md'),

				lsp.TextEdit.replace(makeRange(8, 7, 8, 18), './a.md'),
				lsp.TextEdit.replace(makeRange(9, 7, 9, 18), './b.md'),
			]
		});
	}));

	test('Rename within moved file on directory move should update links to files outside of dir', withStore(async (store) => {
		const uri = workspacePath('new', 'sub', 'doc.md');
		const doc = new InMemoryDocument(uri, joinLines(
			`[abc](/a.md)`,
			`[abc](/b.md)`,
			`[abc](../a.md)`, // 1
			`[abc](../b.md)`, // 2
		));
		const workspace = store.add(new InMemoryWorkspace([
			doc,
			workspacePath('a.md'),
			workspacePath('b.md'),
		]));

		const oldUri = workspacePath('old');
		const newUri = workspacePath('new', 'sub');

		const response = await getFileRenameEdits(store, [{ oldUri: oldUri, newUri }], workspace);
		assertEditsEqual(response!.edit, {
			uri: uri, edits: [
				lsp.TextEdit.replace(makeRange(2, 6, 2, 13), '../../a.md'),
				lsp.TextEdit.replace(makeRange(3, 6, 3, 13), '../../b.md'),
			]
		});
	}));

	test('Should update links when renaming multiple files', withStore(async (store) => {
		const uri = workspacePath('doc.md');
		const doc = new InMemoryDocument(uri, joinLines(
			`[abc](/old1.md)`,
			`[abc](old2.md)`,
			`[abc](./old1.md)`,
			`[xyz]: ./old2.md`,
			`[abc](/other1.md)`,
			`[xyz1]: ./other1.md`,
		));
		const workspace = store.add(new InMemoryWorkspace([doc]));

		const old1Uri = workspacePath('old1.md');
		const new1Uri = workspacePath('new1.md');

		const old2Uri = workspacePath('old2.md');
		const new2Uri = workspacePath('new2.md');

		const response = await getFileRenameEdits(store, [
			{ oldUri: old1Uri, newUri: new1Uri },
			{ oldUri: old2Uri, newUri: new2Uri },
			// And create an edit that does not effect the result
			{
				oldUri: workspacePath('uninvolved.md'), 
				newUri: workspacePath('uninvolved-new.md')
			}
		], workspace);
		assertEditsEqual(response!.edit, {
			uri, edits: [
				lsp.TextEdit.replace(makeRange(0, 6, 0, 14), '/new1.md'),
				lsp.TextEdit.replace(makeRange(2, 6, 2, 15), './new1.md'),
				lsp.TextEdit.replace(makeRange(1, 6, 1, 13), 'new2.md'),
				lsp.TextEdit.replace(makeRange(3, 7, 3, 16), './new2.md'),
			]
		});

		assert.strictEqual(response?.participatingRenames.length, 2);
		assert.strictEqual(response?.participatingRenames[0].oldUri.toString(), old1Uri.toString());
		assert.strictEqual(response?.participatingRenames[1].oldUri.toString(), old2Uri.toString());
	}));
});