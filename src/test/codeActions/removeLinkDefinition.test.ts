/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import * as lsp from 'vscode-languageserver-types';
import { getLsConfiguration } from '../../config';
import { MdRemoveLinkDefinitionCodeActionProvider } from '../../languageFeatures/codeActions/removeLinkDefinition';
import { DiagnosticComputer } from '../../languageFeatures/diagnostics';
import { MdLinkProvider } from '../../languageFeatures/documentLinks';
import { MdTableOfContentsProvider } from '../../tableOfContents';
import { makeRange } from '../../types/range';
import { noopToken } from '../../util/cancellation';
import { DisposableStore } from '../../util/dispose';
import { createNewMarkdownEngine } from '../engine';
import { InMemoryDocument } from '../inMemoryDocument';
import { InMemoryWorkspace } from '../inMemoryWorkspace';
import { nulLogger } from '../nulLogging';
import { applyActionEdit, defaultDiagnosticsOptions, joinLines, withStore, workspacePath } from '../util';

async function getActions(store: DisposableStore, doc: InMemoryDocument, pos: lsp.Position): Promise<lsp.CodeAction[]> {
	const workspace = store.add(new InMemoryWorkspace([doc]));
	const engine = createNewMarkdownEngine();
	const config = getLsConfiguration({});

	const tocProvider = store.add(new MdTableOfContentsProvider(engine, workspace, nulLogger));
	const linkProvider = store.add(new MdLinkProvider(config, engine, workspace, tocProvider, nulLogger));
	const computer = new DiagnosticComputer(config, workspace, linkProvider, tocProvider, nulLogger);

	const provider = new MdRemoveLinkDefinitionCodeActionProvider();
	return Array.from(
		provider.getActions(doc, makeRange(pos, pos), lsp.CodeActionContext.create((await computer.compute(doc, defaultDiagnosticsOptions, noopToken)).diagnostics, undefined, undefined))
	);
}


suite('Remove link definition code action', () => {
	test('Should not return code action when not on link', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('test.md'), joinLines(
			`test`
		));
		const actions = await getActions(store, doc, { line: 0, character: 3 });
		assert.strictEqual(actions.length, 0);
	}));

	test('Should not return action when not on unused definition', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('test.md'), joinLines(
			`text`,
			``,
			`[def]: http://example.com`,
			``,
			`more text`,
		));
		const actions = await getActions(store, doc, { line: 0, character: 3 });
		assert.strictEqual(actions.length, 0);
	}));

	test('Should return when on unused definition', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('test.md'), joinLines(
			`text`,
			``,
			`[def]: http://example.com`,
			``,
			`more text`,
		));
		const actions = await getActions(store, doc, { line: 2, character: 3 });
		assert.strictEqual(actions.length, 1);

		const newContent = applyActionEdit(doc, actions[0]);
		assert.strictEqual(newContent, joinLines(
			`text`,
			``,
			``,
			`more text`,
		));
	}));

	test('Should remove entire line instead of leaving blank line', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('test.md'), joinLines(
			`[a]: http://example.com "title"`,
			`[b]: http://example.com/b "title2"`,
			`[c]: http://example.com/c "title3"`,
		));
		const actions = await getActions(store, doc, { line: 1, character: 3 });
		assert.strictEqual(actions.length, 1);

		const newContent = applyActionEdit(doc, actions[0]);
		assert.strictEqual(newContent, joinLines(
			`[a]: http://example.com "title"`,
			`[c]: http://example.com/c "title3"`,
		));
	}));

	test('Should return when on unused definition with title', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('test.md'), joinLines(
			`text`,
			``,
			`[def]: http://example.com "title"`,
			``,
			`more text`,
		));
		const actions = await getActions(store, doc, { line: 2, character: 3 });
		assert.strictEqual(actions.length, 1);

		const newContent = applyActionEdit(doc, actions[0]);
		assert.strictEqual(newContent, joinLines(
			`text`,
			``,
			``,
			`more text`,
		));
	}));

	test('Should return action when on duplicate definition', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('test.md'), joinLines(
			`text`,
			``,
			`[def]: http://example.com/first`,
			`[def]: http://example.com/second`,
			``,
			`more text`,
		));
		{
			const actions = await getActions(store, doc, { line: 2, character: 3 });
			assert.strictEqual(actions.length, 1);

			const newContent = applyActionEdit(doc, actions[0]);
			assert.strictEqual(newContent, joinLines(
				`text`,
				``,
				`[def]: http://example.com/second`,
				``,
				`more text`,
			));
		}
		{
			const actions = await getActions(store, doc, { line: 3, character: 3 });
			assert.strictEqual(actions.length, 1);

			const newContent = applyActionEdit(doc, actions[0]);
			assert.strictEqual(newContent, joinLines(
				`text`,
				``,
				`[def]: http://example.com/first`,
				``,
				`more text`,
			));
		}
	}));

	test('Should prefer unused code action if link definition is both unused and duplicated', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('test.md'), joinLines(
			`text`,
			``,
			`[def]: http://example.com "title"`,
			`[def]: http://example.com/other "title2"`,
			``,
			`more text`,
		));
		const actions = await getActions(store, doc, { line: 2, character: 3 });
		assert.strictEqual(actions.length, 1);

		const newContent = applyActionEdit(doc, actions[0]);
		assert.strictEqual(newContent, joinLines(
			`text`,
			``,
			`[def]: http://example.com/other "title2"`,
			``,
			`more text`,
		));
	}));
});


