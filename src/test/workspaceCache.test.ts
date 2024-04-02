/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { InMemoryDocument } from '../types/inMemoryDocument';
import { MdWorkspaceInfoCache } from '../workspaceCache';
import { InMemoryWorkspace } from './inMemoryWorkspace';
import { joinLines, withStore, workspacePath } from './util';


suite('Workspace Cache', () => {

	test('Entries should return basic value', withStore(async (_store) => {
		const uri = workspacePath('doc.md');
		const contents = joinLines(
			`# hello!`
		);
		const doc = new InMemoryDocument(uri, contents);
		const cache = new MdWorkspaceInfoCache<string>(new InMemoryWorkspace([doc]), async doc => doc.getText());

		const entires = await cache.entries();
		assert.deepStrictEqual(entires.length, 1);
		assert.deepStrictEqual(entires[0][0].toString(), uri.toString());
		assert.deepStrictEqual(entires[0][1], contents);
	}));

	test('Entries should update when document changes', withStore(async (_store) => {
		const uri = workspacePath('doc.md');
		const originalContents = joinLines(
			`# hello!`
		);
		const doc = new InMemoryDocument(uri, originalContents);
		const workspace = new InMemoryWorkspace([doc]);
		const cache = new MdWorkspaceInfoCache<string>(workspace, async doc => doc.getText());

		{
			const entires = await cache.entries();
			assert.deepStrictEqual(entires.length, 1);
			assert.deepStrictEqual(entires[0][0].toString(), uri.toString());
			assert.deepStrictEqual(entires[0][1], originalContents);
		}

		const newContents = joinLines(
			`new`
		);
		doc.replaceContents(newContents);
		workspace.updateDocument(doc);

		{
			const entires = await cache.entries();
			assert.deepStrictEqual(entires.length, 1);
			assert.deepStrictEqual(entires[0][0].toString(), uri.toString());
			assert.deepStrictEqual(entires[0][1], newContents);
		}
	}));

	test('GetForDocs should update when document changes', withStore(async (_store) => {
		const uri = workspacePath('doc.md');
		const originalContents = joinLines(
			`# hello!`
		);
		const doc = new InMemoryDocument(uri, originalContents);
		const workspace = new InMemoryWorkspace([doc]);
		const cache = new MdWorkspaceInfoCache<string>(workspace, async doc => doc.getText());

		{
			const values = await cache.getForDocs([doc]);
			assert.deepStrictEqual(values[0], originalContents);
		}

		const newContents = joinLines(
			`new`
		);
		doc.replaceContents(newContents);
		workspace.updateDocument(doc);

		{
			const entires = await cache.entries();
			assert.deepStrictEqual(entires.length, 1);
			assert.deepStrictEqual(entires[0][0].toString(), uri.toString());
			assert.deepStrictEqual(entires[0][1], newContents);
		}
	}));

	test('Should cancel computation when document is deleted', withStore(async (_store) => {
		const docUri = workspacePath('doc.md');
		const doc = new InMemoryDocument(docUri, 'abc');
		const workspace = new InMemoryWorkspace([doc]);

		let didCancel = false;
		const cache = new MdWorkspaceInfoCache<string>(workspace, (_doc, token) => {
			return new Promise<string>(resolve => token.onCancellationRequested(() => {
				didCancel = true;
				return resolve('cancelled');
			}));
		});

		const req = cache.getForDocs([doc]); // Trigger compute

		// Delete doc should cancel pending compute
		workspace.deleteDocument(docUri);

		assert.deepStrictEqual(await req, ['cancelled']);
		assert.deepStrictEqual(didCancel, true);
	}));
});
