/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import * as lsp from 'vscode-languageserver-protocol';
import { getLsConfiguration } from '../../config';
import { MdExtractLinkDefinitionCodeActionProvider } from '../../languageFeatures/codeActions/extractLinkDef';
import { MdLinkProvider } from '../../languageFeatures/documentLinks';
import { MdTableOfContentsProvider } from '../../tableOfContents';
import { InMemoryDocument } from '../../types/inMemoryDocument';
import { noopToken } from '../../util/cancellation';
import { createNewMarkdownEngine } from '../engine';
import { InMemoryWorkspace } from '../inMemoryWorkspace';
import { nulLogger } from '../nulLogging';
import { applyActionEdit, DisposableStore, joinLines, withStore, workspacePath } from '../util';

async function getActions(store: DisposableStore, doc: InMemoryDocument, pos: lsp.Position): Promise<lsp.CodeAction[]> {
	const workspace = store.add(new InMemoryWorkspace([doc]));
	const engine = createNewMarkdownEngine();
	const config = getLsConfiguration({});

	const tocProvider = store.add(new MdTableOfContentsProvider(engine, workspace, nulLogger));
	const linkProvider = store.add(new MdLinkProvider(config, engine, workspace, tocProvider, nulLogger));
	const provider = new MdExtractLinkDefinitionCodeActionProvider(linkProvider);
	return provider.getActions(doc, lsp.Range.create(pos, pos), lsp.CodeActionContext.create([], undefined, undefined), noopToken);
}

function assertActiveActionCount(actions: readonly lsp.CodeAction[], expectedCount: number) {
	assert.strictEqual(actions.filter(action => !action.disabled).length, expectedCount);
}

suite('Extract link definition code action', () => {
	test('Should return disabled code action when not on link', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('test.md'), joinLines(
			`test`
		));
		const actions = await getActions(store, doc, { line: 0, character: 3 });
		assert.strictEqual(actions.length, 1);
		assert.strictEqual(actions[0].disabled?.reason, MdExtractLinkDefinitionCodeActionProvider.notOnLinkAction.disabled!.reason!);
	}));

	test('Should return disabled code action when already on reference link', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('test.md'), joinLines(
			`[text][ref]`
		));
		const actions = await getActions(store, doc, { line: 0, character: 3 });
		assert.strictEqual(actions.length, 1);
		assert.strictEqual(actions[0].disabled?.reason, MdExtractLinkDefinitionCodeActionProvider.alreadyRefLinkAction.disabled!.reason!);
	}));

	test('Should return action for simple internal link', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('test.md'), joinLines(
			`[text](./img.png)`
		));
		const actions = await getActions(store, doc, { line: 0, character: 3 });
		assert.strictEqual(actions.length, 1);

		const newContent = applyActionEdit(doc, actions[0]);
		assert.strictEqual(newContent, joinLines(
			`[text][def]`,
			``,
			`[def]: ./img.png`,
		));
	}));

	test('Should be triggerable on link text or title', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('test.md'), joinLines(
			`a [text](./img.png) b`
		));

		const expectedNewContent = joinLines(
			`a [text][def] b`,
			``,
			`[def]: ./img.png`
		);

		{
			// Before link
			const actions = await getActions(store, doc, { line: 0, character: 1 });
			assert.strictEqual(actions.length, 1);
			assert.strictEqual(actions[0].disabled?.reason, MdExtractLinkDefinitionCodeActionProvider.notOnLinkAction.disabled?.reason);
		}
		{
			// On opening `[`
			const actions = await getActions(store, doc, { line: 0, character: 2 });
			assertActiveActionCount(actions, 1);
			assert.strictEqual(applyActionEdit(doc, actions[0]), expectedNewContent);
		}
		{
			// On opening link text
			const actions = await getActions(store, doc, { line: 0, character: 5 });
			assertActiveActionCount(actions, 1);
			assert.strictEqual(applyActionEdit(doc, actions[0]), expectedNewContent);
		}
		{
			// On link target
			const actions = await getActions(store, doc, { line: 0, character: 14 });
			assertActiveActionCount(actions, 1);
			assert.strictEqual(applyActionEdit(doc, actions[0]), expectedNewContent);
		}
		{
			// On closing `)`
			const actions = await getActions(store, doc, { line: 0, character: 19 });
			assertActiveActionCount(actions, 1);
			assert.strictEqual(applyActionEdit(doc, actions[0]), expectedNewContent);
		}
		{
			// After link
			const actions = await getActions(store, doc, { line: 0, character: 20 });
			assert.strictEqual(actions.length, 1);
			assert.strictEqual(actions[0].disabled?.reason, MdExtractLinkDefinitionCodeActionProvider.notOnLinkAction.disabled?.reason);
		}
	}));

	test('Should add to existing link block', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('test.md'), joinLines(
			`[text](./img.png)`,
			``,
			`[abc]: http:://example.com`
		));
		const actions = await getActions(store, doc, { line: 0, character: 3 });
		assertActiveActionCount(actions, 1);

		const newContent = applyActionEdit(doc, actions[0]);
		assert.strictEqual(newContent, joinLines(
			`[text][def]`,
			``,
			`[abc]: http:://example.com`,
			`[def]: ./img.png`
		));
	}));

	test('Should use new placeholder if existing is already taken', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('test.md'), joinLines(
			`[text](http://example.com?3)`,
			``,
			`[def]: http:://example.com?1`,
			`[def2]: http:://example.com?2`,
			`[def4]: http:://example.com?4`,
		));
		const actions = await getActions(store, doc, { line: 0, character: 3 });
		assertActiveActionCount(actions, 1);

		const newContent = applyActionEdit(doc, actions[0]);
		assert.strictEqual(newContent, joinLines(
			`[text][def3]`,
			``,
			`[def]: http:://example.com?1`,
			`[def2]: http:://example.com?2`,
			`[def4]: http:://example.com?4`,
			`[def3]: http://example.com?3`
		));
	}));

	test('Should preserve title', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('test.md'), joinLines(
			`[text](http://example.com "some title")`,
			``,
			`[abc]: http:://example.com`
		));
		const actions = await getActions(store, doc, { line: 0, character: 3 });
		assertActiveActionCount(actions, 1);

		const newContent = applyActionEdit(doc, actions[0]);
		assert.strictEqual(newContent, joinLines(
			`[text][def]`,
			``,
			`[abc]: http:://example.com`,
			`[def]: http://example.com "some title"`,
		));
	}));

	test('Should work for link with leading and trailing whitespace', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('test.md'), joinLines(
			`[text](    http://example.com "some title"   )`,
			``,
			`[abc]: http:://example.com`
		));
		const actions = await getActions(store, doc, { line: 0, character: 3 });
		assertActiveActionCount(actions, 1);

		const newContent = applyActionEdit(doc, actions[0]);
		assert.strictEqual(newContent, joinLines(
			`[text][def]`,
			``,
			`[abc]: http:://example.com`,
			`[def]: http://example.com "some title"`,
		));
	}));

	test('Should work for bracketed link paths', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('test.md'), joinLines(
			`[text](<path to img.png> "title text")`,
			``,
			`[abc]: http:://example.com`
		));
		const actions = await getActions(store, doc, { line: 0, character: 3 });
		assertActiveActionCount(actions, 1);

		const newContent = applyActionEdit(doc, actions[0]);
		assert.strictEqual(newContent, joinLines(
			`[text][def]`,
			``,
			`[abc]: http:://example.com`,
			`[def]: <path to img.png> "title text"`,
		));
	}));

	test('Should preserve trailing newlines', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('test.md'), joinLines(
			`[text](/path/to/img.png)`,
			``,
			`[abc]: http:://example.com?abc`,
			`[xyz]: http:://example.com?xyz`,
			``,
		));
		const actions = await getActions(store, doc, { line: 0, character: 3 });
		assertActiveActionCount(actions, 1);

		const newContent = applyActionEdit(doc, actions[0]);
		assert.strictEqual(newContent, joinLines(
			`[text][def]`,
			``,
			`[abc]: http:://example.com?abc`,
			`[xyz]: http:://example.com?xyz`,
			`[def]: /path/to/img.png`,
			``,
		));
	}));

	test('Should replace all occurrences of link', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('test.md'), joinLines(
			`a [text](/img.png) b`,
			``,
			`# c [text](/img.png)`,
			``,
			`[abc]: http:://example.com?abc`,
		));
		const actions = await getActions(store, doc, { line: 0, character: 3 });
		assertActiveActionCount(actions, 1);

		const newContent = applyActionEdit(doc, actions[0]);
		assert.strictEqual(newContent, joinLines(
			`a [text][def] b`,
			``,
			`# c [text][def]`,
			``,
			`[abc]: http:://example.com?abc`,
			`[def]: /img.png`,
		));
	}));

	test('Should not extract occurrences where fragments differ', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('test.md'), joinLines(
			`a [text](http://example.com#a)`,
			`b [text](http://example.com#b)`,
			`a [text](http://example.com#a)`,
		));
		const actions = await getActions(store, doc, { line: 0, character: 3 });
		assertActiveActionCount(actions, 1);

		const newContent = applyActionEdit(doc, actions[0]);
		assert.strictEqual(newContent, joinLines(
			`a [text][def]`,
			`b [text](http://example.com#b)`,
			`a [text][def]`,
			``,
			`[def]: http://example.com#a`,
		));
	}));

	test('Extract should take inner link when dealing with nested links', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('test.md'), joinLines(
			`[![asset_name](http://example.com)](link)`,
		));
		const actions = await getActions(store, doc, { line: 0, character: 20 });
		assertActiveActionCount(actions, 1);

		const newContent = applyActionEdit(doc, actions[0]);
		assert.strictEqual(newContent, joinLines(
			`[![asset_name][def]](link)`,
			``,
			`[def]: http://example.com`,
		));
	}));

	test('Extract should be triggerable with cursor on ! for image links', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('test.md'), joinLines(
			`![alt](http://example.com)`,
		));
		const actions = await getActions(store, doc, { line: 0, character: 0 });
		assertActiveActionCount(actions, 1);

		const newContent = applyActionEdit(doc, actions[0]);
		assert.strictEqual(newContent, joinLines(
			`![alt][def]`,
			``,
			`[def]: http://example.com`,
		));
	}));

	test('Extract should extract entire autolink', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('test.md'), joinLines(
			`Lorem <https://daringfireball.net/projects/markdown> dolor`,
		));
		const actions = await getActions(store, doc, { line: 0, character: 20 });
		assertActiveActionCount(actions, 1);

		const newContent = applyActionEdit(doc, actions[0]);
		assert.strictEqual(newContent, joinLines(
			`Lorem [def] dolor`,
			``,
			`[def]: https://daringfireball.net/projects/markdown`,
		));
	}));
});
