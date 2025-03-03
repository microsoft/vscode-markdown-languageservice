/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as lsp from 'vscode-languageserver-protocol';
import { URI } from 'vscode-uri';
import { getLsConfiguration, LsConfiguration, PreferredMdPathExtensionStyle } from '../config';
import { createWorkspaceLinkCache } from '../languageFeatures/documentLinks';
import { FileRenameResponse, MdFileRenameProvider } from '../languageFeatures/fileRename';
import { MdReferencesProvider } from '../languageFeatures/references';
import { MdTableOfContentsProvider } from '../tableOfContents';
import { InMemoryDocument } from '../types/inMemoryDocument';
import { noopToken } from '../util/cancellation';
import { IWorkspace } from '../workspace';
import { createNewMarkdownEngine } from './engine';
import { InMemoryWorkspace } from './inMemoryWorkspace';
import { nulLogger } from './nulLogging';
import { assertRangeEqual, DisposableStore, joinLines, withStore, workspacePath } from './util';

/**
 * Get all the edits for a file rename.
 */
function getFileRenameEdits(store: DisposableStore, edits: ReadonlyArray<{ oldUri: URI, newUri: URI }>, workspace: IWorkspace, configOverrides: Partial<LsConfiguration> = {}): Promise<FileRenameResponse | undefined> {
	const config = getLsConfiguration(configOverrides);
	const engine = createNewMarkdownEngine();
	const tocProvider = store.add(new MdTableOfContentsProvider(engine, workspace, nulLogger));
	const linkCache = store.add(createWorkspaceLinkCache(engine, workspace));
	const referencesProvider = store.add(new MdReferencesProvider(config, engine, workspace, tocProvider, linkCache, nulLogger));
	const renameProvider = new MdFileRenameProvider(config, workspace, linkCache, referencesProvider);
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
			assertRangeEqual(actualEditForDoc[g].range, expectedEditsForDoc[g].range, `Edit '${g}' of '${actualDoc}' has expected expected range. Expected range: ${JSON.stringify(expectedEditsForDoc[g].range)}. Actual range: ${JSON.stringify(actualEditForDoc[g].range)}`);
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
				lsp.TextEdit.replace(lsp.Range.create(0, 6, 0, 13), '/new.md'),
				lsp.TextEdit.replace(lsp.Range.create(1, 6, 1, 12), 'new.md'),
				lsp.TextEdit.replace(lsp.Range.create(2, 6, 2, 14), './new.md'),
				lsp.TextEdit.replace(lsp.Range.create(3, 7, 3, 15), './new.md'),
			]
		});
	}));

	test('Rename file should preserve fragments', withStore(async (store) => {
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
				lsp.TextEdit.replace(lsp.Range.create(0, 6, 0, 18), '/new.md#frag'),
				lsp.TextEdit.replace(lsp.Range.create(1, 6, 1, 17), 'new.md#frag'),
				lsp.TextEdit.replace(lsp.Range.create(2, 6, 2, 19), './new.md#frag'),
				lsp.TextEdit.replace(lsp.Range.create(3, 7, 3, 20), './new.md#frag'),
			]
		});
	}));

	test('Rename file should drop file extensions if it has been configured to', withStore(async (store) => {
		const docUri = workspacePath('doc.md');
		const doc = new InMemoryDocument(docUri, joinLines(
			`[abc](/old.md#frag)`,
			`[abc](old.md#frag)`,
			`[abc](./old.md#frag)`,
			`[xyz]: ./old.md#frag`,
		));
		const workspace = store.add(new InMemoryWorkspace([doc]));

		const oldUri = workspacePath('old.md');
		const newUri = workspacePath('new.md');

		const response = await getFileRenameEdits(store, [{ oldUri, newUri }], workspace, { preferredMdPathExtensionStyle: PreferredMdPathExtensionStyle.removeExtension });
		assertEditsEqual(response!.edit, {
			uri: docUri, edits: [
				lsp.TextEdit.replace(lsp.Range.create(0, 6, 0, 18), '/new#frag'),
				lsp.TextEdit.replace(lsp.Range.create(1, 6, 1, 17), 'new#frag'),
				lsp.TextEdit.replace(lsp.Range.create(2, 6, 2, 19), './new#frag'),
				lsp.TextEdit.replace(lsp.Range.create(3, 7, 3, 20), './new#frag'),
			]
		});
	}));

	test('Rename file should preserve usage of file extensions by default', withStore(async (store) => {
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
				lsp.TextEdit.replace(lsp.Range.create(0, 6, 0, 15), '/new#frag'),
				lsp.TextEdit.replace(lsp.Range.create(1, 6, 1, 14), 'new#frag'),
				lsp.TextEdit.replace(lsp.Range.create(2, 6, 2, 16), './new#frag'),
				lsp.TextEdit.replace(lsp.Range.create(3, 7, 3, 17), './new#frag'),
			]
		});
	}));

	test('Rename file should handle links with spaces', withStore(async (store) => {
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
				lsp.TextEdit.replace(lsp.Range.create(0, 6, 0, 13), '</new with space.md>'),
				lsp.TextEdit.replace(lsp.Range.create(1, 6, 1, 12), '<new with space.md>'),
				lsp.TextEdit.replace(lsp.Range.create(2, 6, 2, 14), '<./new with space.md>'),
				lsp.TextEdit.replace(lsp.Range.create(3, 7, 3, 15), '<./new with space.md>'),
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
				lsp.TextEdit.replace(lsp.Range.create(0, 6, 0, 14), '/kitty.png'),
				lsp.TextEdit.replace(lsp.Range.create(2, 6, 2, 13), 'kitty.png'),
				lsp.TextEdit.replace(lsp.Range.create(4, 6, 4, 15), './kitty.png'),
				lsp.TextEdit.replace(lsp.Range.create(6, 7, 6, 16), './kitty.png'),

				lsp.TextEdit.replace(lsp.Range.create(1, 6, 1, 14), '/hot/doggo.png'),
				lsp.TextEdit.replace(lsp.Range.create(3, 6, 3, 13), 'hot/doggo.png'),
				lsp.TextEdit.replace(lsp.Range.create(5, 6, 5, 15), './hot/doggo.png'),
				lsp.TextEdit.replace(lsp.Range.create(7, 7, 7, 16), './hot/doggo.png'),
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
				lsp.TextEdit.replace(lsp.Range.create(1, 6, 1, 19), '../other.md#frag'),
				lsp.TextEdit.replace(lsp.Range.create(2, 6, 2, 21), '../other.md#frag'),
				lsp.TextEdit.replace(lsp.Range.create(3, 7, 3, 22), '../other.md#frag'),
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
				lsp.TextEdit.replace(lsp.Range.create(1, 6, 1, 16), '../other#frag'),
				lsp.TextEdit.replace(lsp.Range.create(2, 6, 2, 18), '../other#frag'),
				lsp.TextEdit.replace(lsp.Range.create(3, 7, 3, 19), '../other#frag'),
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
				lsp.TextEdit.replace(lsp.Range.create(0, 6, 0, 15), '/new/a.md'),
				lsp.TextEdit.replace(lsp.Range.create(1, 6, 1, 15), '/new/b.md'),

				lsp.TextEdit.replace(lsp.Range.create(2, 6, 2, 14), 'new/a.md'),
				lsp.TextEdit.replace(lsp.Range.create(3, 6, 3, 14), 'new/b.md'),

				lsp.TextEdit.replace(lsp.Range.create(4, 6, 4, 16), './new/a.md'),
				lsp.TextEdit.replace(lsp.Range.create(5, 6, 5, 16), './new/b.md'),

				lsp.TextEdit.replace(lsp.Range.create(6, 7, 6, 17), './new/a.md'),
				lsp.TextEdit.replace(lsp.Range.create(7, 7, 7, 17), './new/b.md'),
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
				lsp.TextEdit.replace(lsp.Range.create(0, 6, 0, 15), '/new/a.md'),
				lsp.TextEdit.replace(lsp.Range.create(1, 6, 1, 15), '/new/b.md'),

				lsp.TextEdit.replace(lsp.Range.create(8, 7, 8, 18), './a.md'),
				lsp.TextEdit.replace(lsp.Range.create(9, 7, 9, 18), './b.md'),
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
				lsp.TextEdit.replace(lsp.Range.create(2, 6, 2, 13), '../../a.md'),
				lsp.TextEdit.replace(lsp.Range.create(3, 6, 3, 13), '../../b.md'),
			]
		});
	}));

	test('Renaming directory containing file should use updated file name in edit', withStore(async (store) => {
		const docUri = workspacePath('newSub', 'doc.md');
		const doc = new InMemoryDocument(docUri, joinLines(
			`[abc](../sub/other.md)`,
			`[abc](/sub/other.md)`,
		));

		const oldUri = workspacePath('sub');
		const newUri = workspacePath('newSub');

		// Create workspace state after the rename
		const workspace = store.add(new InMemoryWorkspace([
			doc,
			workspacePath('newSub', 'other.md'),
		]));

		const response = await getFileRenameEdits(store, [{ oldUri: oldUri, newUri: newUri }], workspace);
		assertEditsEqual(response!.edit, {
			// Here we need to be using the new path to 'doc'
			uri: docUri, edits: [
				lsp.TextEdit.replace(lsp.Range.create(0, 6, 0, 21), './other.md'),
				lsp.TextEdit.replace(lsp.Range.create(1, 6, 1, 19), '/newSub/other.md'),
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
				lsp.TextEdit.replace(lsp.Range.create(0, 6, 0, 14), '/new1.md'),
				lsp.TextEdit.replace(lsp.Range.create(2, 6, 2, 15), './new1.md'),
				lsp.TextEdit.replace(lsp.Range.create(1, 6, 1, 13), 'new2.md'),
				lsp.TextEdit.replace(lsp.Range.create(3, 7, 3, 16), './new2.md'),
			]
		});

		assert.strictEqual(response?.participatingRenames.length, 2);
		assert.strictEqual(response?.participatingRenames[0].oldUri.toString(), old1Uri.toString());
		assert.strictEqual(response?.participatingRenames[1].oldUri.toString(), old2Uri.toString());
	}));


	test('Should not use ./../ when updating relative path', withStore(async (store) => {
		const docUri = workspacePath('sub', 'doc.md');
		const doc = new InMemoryDocument(docUri, joinLines(
			`[abc](./other.md)`,
			`[abc](other.md)`,
			`[abc](other)`,
			`[abc](/sub/other.md)`,
		));

		const oldLinkedUri = workspacePath('sub', 'other.md');
		const newLinkedUri = workspacePath('other.md');

		const workspace = store.add(new InMemoryWorkspace([
			doc,
			workspacePath('sub', 'other.md'),
		]));

		const response = await getFileRenameEdits(store, [{ oldUri: oldLinkedUri, newUri: newLinkedUri }], workspace);
		assertEditsEqual(response!.edit, {
			uri: docUri, edits: [
				lsp.TextEdit.replace(lsp.Range.create(0, 6, 0, 16), '../other.md'),
				lsp.TextEdit.replace(lsp.Range.create(1, 6, 1, 14), '../other.md'),
				lsp.TextEdit.replace(lsp.Range.create(2, 6, 2, 11), '../other'),
				lsp.TextEdit.replace(lsp.Range.create(3, 6, 3, 19), '/other.md'),
			]
		});
	}));

	test('Should update paths when both referenced file and doc are moved', withStore(async (store) => {
		const docUri = workspacePath('doc.md');

		const newDocUri = workspacePath('newSub', 'newDoc.md');
		const newDoc = new InMemoryDocument(newDocUri, joinLines(
			`[abc](images/cat.gif)`,
			`[abc](./images/cat.gif)`,
		));

		// Create workspace state after the rename
		const workspace = store.add(new InMemoryWorkspace([
			newDoc,
			workspacePath('newSub', 'kitty.gif'),
			workspacePath('newSub', 'kitty.gif'),
		]));

		// Move both the image and the document
		const response = await getFileRenameEdits(store, [
			{ oldUri: docUri, newUri: newDocUri },
			{ oldUri: workspacePath('images', 'cat.gif'), newUri: workspacePath('newSub', 'kitty.gif') },
		], workspace);

		assertEditsEqual(response!.edit, {
			// Here we need to be using the new path to 'doc'
			uri: newDocUri, edits: [
				lsp.TextEdit.replace(lsp.Range.create(0, 6, 0, 20), 'kitty.gif'),
				lsp.TextEdit.replace(lsp.Range.create(1, 6, 1, 22), './kitty.gif'),
			]
		});
	}));

	test('Should update paths when containing folder is moved', withStore(async (store) => {
		// Create workspace state after the rename
		const newDocUri = workspacePath('new', 'old', 'readme.md');
		const newDoc = new InMemoryDocument(newDocUri, joinLines(
			`[abc](/top.md)`,
			`[abc](/old/sibling.md)`,
			`[abc](../top.md)`,
			`[abc](../old/sibling.md)`,
			`[abc](../old/)`,
			`[abc](../old)`,
			`[abc](/old)`,
			`[abc](/old/)`,
			``, // Own header links should not get rewritten here
			`# header`,
			`[text](#header)`,
		));

		const workspace = store.add(new InMemoryWorkspace([
			newDoc,
			workspacePath('new', 'old', 'sibling.md'),
			workspacePath('top.md'),
		]));

		// Move both the image and the document
		const response = await getFileRenameEdits(store, [
			{ oldUri: workspacePath('old'), newUri: workspacePath('new', 'old') },
		], workspace);

		assertEditsEqual(response!.edit, {
			// Here we need to be using the new path to 'doc'
			uri: newDocUri, edits: [
				lsp.TextEdit.replace(lsp.Range.create(1, 6, 1, 21), '/new/old/sibling.md'),
				lsp.TextEdit.replace(lsp.Range.create(2, 6, 2, 15), '../../top.md'),
				lsp.TextEdit.replace(lsp.Range.create(3, 6, 3, 23), './sibling.md'),
				lsp.TextEdit.replace(lsp.Range.create(4, 6, 4, 13), './'),
				lsp.TextEdit.replace(lsp.Range.create(5, 6, 5, 12), './'),
				lsp.TextEdit.replace(lsp.Range.create(6, 6, 6, 10), '/new/old'),
				lsp.TextEdit.replace(lsp.Range.create(7, 6, 7, 11), '/new/old'),
			]
		});
	}));

	test('Should not rewrite fragment links to self', withStore(async (store) => {
		// Create workspace state after the rename
		const newDocUri = workspacePath('sub', 'newReadme.md');
		const newDoc = new InMemoryDocument(newDocUri, joinLines(
			`# Header`,
			`[abc](#header)`, // No change
			`[abc](oldReadme.md#header)`, // Needs rewrite
			`[abc](./oldReadme.md#header)`, // Needs rewrite
			``,
			`[def1]: #header`, // No change
			`[def2]: oldReadme.md#header`, // Needs rewrite
			`[def3]: ./oldReadme.md#header`, // Needs rewrite
		));

		const workspace = store.add(new InMemoryWorkspace([
			newDoc,
		]));

		const response = await getFileRenameEdits(store, [
			{ oldUri: workspacePath('oldReadme.md'), newUri: newDocUri },
		], workspace);

		assertEditsEqual(response!.edit, {
			// Here we need to be using the new path to 'doc'
			uri: newDocUri, edits: [
				lsp.TextEdit.replace(lsp.Range.create(2, 6, 2, 25), 'newReadme.md#header'),
				lsp.TextEdit.replace(lsp.Range.create(3, 6, 3, 27), './newReadme.md#header'),

				lsp.TextEdit.replace(lsp.Range.create(6, 8, 6, 27), 'newReadme.md#header'),
				lsp.TextEdit.replace(lsp.Range.create(7, 8, 7, 29), './newReadme.md#header'),
			]
		});
	}));

	test('Rename file with angle bracket links should not add extra escapes', withStore(async (store) => {
		const uri = workspacePath('doc.md');
		const doc = new InMemoryDocument(uri, joinLines(
			`[abc](</old.md>)`,
			`[abc](<old.md>)`,
		));
		const workspace = store.add(new InMemoryWorkspace([doc]));

		const oldUri = workspacePath('old.md');
		const newUri = workspacePath('sp ace.md');

		const response = await getFileRenameEdits(store, [{ oldUri, newUri }], workspace);
		assertEditsEqual(response!.edit, {
			uri, edits: [
				lsp.TextEdit.replace(lsp.Range.create(0, 7, 0, 14), '/sp ace.md'),
				lsp.TextEdit.replace(lsp.Range.create(1, 7, 1, 13), 'sp ace.md'),
			]
		});
	}));

	test('Rename file should escape angle brackets in angle bracket links', withStore(async (store) => {
		const uri = workspacePath('doc.md');
		const doc = new InMemoryDocument(uri, joinLines(
			`[abc](</old.md>)`,
			`[abc](<old.md>)`,
			`[abc](old.md)`,
			``,
			`[def]: </old.md>`,
			`[def]: <old.md>`,
		));
		const workspace = store.add(new InMemoryWorkspace([doc]));

		const oldUri = workspacePath('old.md');
		const newUri = workspacePath('<a>.md');

		const response = await getFileRenameEdits(store, [{ oldUri, newUri }], workspace);
		assertEditsEqual(response!.edit, {
			uri, edits: [
				lsp.TextEdit.replace(lsp.Range.create(0, 6, 0, 15), '/<a>.md'), // Should remove link's <...>
				lsp.TextEdit.replace(lsp.Range.create(1, 7, 1, 13), '\\<a\\>.md'), // Still need's link's <...>
				lsp.TextEdit.replace(lsp.Range.create(2, 6, 2, 12), '<\\<a\\>.md>'),
				lsp.TextEdit.replace(lsp.Range.create(4, 7, 4, 16), '/<a>.md'),
				lsp.TextEdit.replace(lsp.Range.create(5, 8, 5, 14), '\\<a\\>.md'),
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

		const oldUri = workspacePath('cat.gif');
		const newUri = workspacePath('n<ew>.gif');

		const response = await getFileRenameEdits(store, [{ oldUri, newUri }], workspace);
		assertEditsEqual(response!.edit, {
			uri, edits: [
				lsp.TextEdit.replace(lsp.Range.create(0, 8, 0, 15), 'n<ew>.gif'),
				lsp.TextEdit.replace(lsp.Range.create(1, 8, 1, 17), 'n<ew>.gif'),
				lsp.TextEdit.replace(lsp.Range.create(3, 7, 3, 16), 'n<ew>.gif'),
			]
		});
	}));

	test('Should add angle brackets when parent dir is moved', withStore(async (store) => {
		// Create workspace state after the renaming /old -> /par(en
		const newDocUri = workspacePath('par(en', 'readme.md');
		const newDoc = new InMemoryDocument(newDocUri, joinLines(
			/* 00 */ `[abc](/top.md)`, // skip
			/* 01 */ `[abc](/old/sibling.md)`, // edit 0
			/* 02 */ `[abc](../top.md)`, // skip 
			/* 03 */ `[abc](../old/sibling.md)`, // edit 1
			/* 04 */ `[abc](../old/)`, // edit 2
			/* 05 */ `[abc](../old)`, // edit 3
			/* 06 */ `[abc](/old)`, // edit 4
			/* 07 */ `[abc](/old/)`, // edit 5
			/* 08 */ ``, // Own header links should not get rewritten here
			/* 09 */ `# header`,
			/* 10 */ `[text](#header)`,
		));
		const workspace = store.add(new InMemoryWorkspace([
			newDoc,
			workspacePath('par(en', 'sibling.md'),
			workspacePath('top.md'),
		]));

		// Move both the image and the document.
		// Rename to have an opening '(' which should force angle brackets to be used
		const response = await getFileRenameEdits(store, [
			{ oldUri: workspacePath('old'), newUri: workspacePath('par(en') },
		], workspace);

		assertEditsEqual(response!.edit, {
			// Here we need to be using the new path to 'doc'
			uri: newDocUri, edits: [
				lsp.TextEdit.replace(lsp.Range.create(1, 6, 1, 21), '</par(en/sibling.md>'),
				lsp.TextEdit.replace(lsp.Range.create(3, 6, 3, 23), './sibling.md'),
				lsp.TextEdit.replace(lsp.Range.create(4, 6, 4, 13), './'),
				lsp.TextEdit.replace(lsp.Range.create(5, 6, 5, 12), './'),
				lsp.TextEdit.replace(lsp.Range.create(6, 6, 6, 10), '</par(en>'),
				lsp.TextEdit.replace(lsp.Range.create(7, 6, 7, 11), '</par(en>'),
			]
		});
	}));

	test('Should handle renames for angle bracket link with fragment when angle brackets are removed (#150)', withStore(async (store) => {
		const uri = workspacePath('doc.md');
		const doc = new InMemoryDocument(uri, joinLines(
			`[text](foo.md#abc 'text')`,
			`[text](<foo.md#abc>)`,
			``,
			`[def1]: foo.md#abc`,
			`[def2]: <foo.md#abc> 'text'`,
		));

		const workspace = store.add(new InMemoryWorkspace([doc]));

		const oldUri = workspacePath('foo.md');
		const newUri = workspacePath('bar.md');

		const response = await getFileRenameEdits(store, [{ oldUri, newUri }], workspace);
		assertEditsEqual(response!.edit, {
			uri, edits: [
				lsp.TextEdit.replace(lsp.Range.create(0, 7, 0, 17), 'bar.md#abc'),
				lsp.TextEdit.replace(lsp.Range.create(1, 7, 1, 19), 'bar.md#abc'),
				lsp.TextEdit.replace(lsp.Range.create(3, 8, 3, 18), 'bar.md#abc'),
				lsp.TextEdit.replace(lsp.Range.create(4, 8, 4, 20), 'bar.md#abc'),
			]
		});
	}));

	test('Should handle renames for angle bracket link with fragment when angle brackets are added (#150)', withStore(async (store) => {
		const uri = workspacePath('doc.md');
		const doc = new InMemoryDocument(uri, joinLines(
			`[text](foo.md#abc 'text')`,
			`[text](<foo.md#abc>)`,
			``,
			`[def1]: foo.md#abc 'text'`,
			`[def2]: <foo.md#abc>`,
		));

		const workspace = store.add(new InMemoryWorkspace([doc]));

		const oldUri = workspacePath('foo.md');
		const newUri = workspacePath('foo space.md');

		const response = await getFileRenameEdits(store, [{ oldUri, newUri }], workspace);
		assertEditsEqual(response!.edit, {
			uri, edits: [
				lsp.TextEdit.replace(lsp.Range.create(0, 7, 0, 17), '<foo space.md#abc>'),
				lsp.TextEdit.replace(lsp.Range.create(1, 8, 1, 18), 'foo space.md#abc'),
				lsp.TextEdit.replace(lsp.Range.create(3, 8, 3, 18), '<foo space.md#abc>'),
				lsp.TextEdit.replace(lsp.Range.create(4, 9, 4, 19), 'foo space.md#abc'),
			]
		});
	}));

	test('Should handle renames for multi-line links (#202)', withStore(async (store) => {
		const uri = workspacePath('doc.md');
		const doc = new InMemoryDocument(uri, joinLines(
			`[te`,
			`xt](foo.md)`,
			`[te`,
			`xt](foo.md#abc 'text')`,
			`[te`,
			`xt](<foo.md#abc>)`,
			``,
			`[`,
			`text`,
			`](`,
			`foo.md`,
			`)`,
		));

		const workspace = store.add(new InMemoryWorkspace([doc]));

		const oldUri = workspacePath('foo.md');
		const newUri = workspacePath('new foo.md');

		const response = await getFileRenameEdits(store, [{ oldUri, newUri }], workspace);
		assertEditsEqual(response!.edit, {
			uri, edits: [
				lsp.TextEdit.replace(lsp.Range.create(1, 4, 1, 10), '<new foo.md>'),
				lsp.TextEdit.replace(lsp.Range.create(3, 4, 3, 14), '<new foo.md#abc>'),
				lsp.TextEdit.replace(lsp.Range.create(5, 5, 5, 15), 'new foo.md#abc'),
				lsp.TextEdit.replace(lsp.Range.create(10, 0, 10, 6), '<new foo.md>'),
			]
		});
	}));
});
