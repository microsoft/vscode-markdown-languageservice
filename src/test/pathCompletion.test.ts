/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as ls from 'vscode-languageserver';
import * as lsp from 'vscode-languageserver-types';
import { URI } from 'vscode-uri';
import { getLsConfiguration, LsConfiguration } from '../config';
import { MdLinkProvider } from '../languageFeatures/documentLinks';
import { MdPathCompletionProvider } from '../languageFeatures/pathCompletions';
import { MdTableOfContentsProvider } from '../tableOfContents';
import { noopToken } from '../util/cancellation';
import { DisposableStore } from '../util/dispose';
import { IWorkspace } from '../workspace';
import { createNewMarkdownEngine } from './engine';
import { InMemoryDocument } from './inMemoryDocument';
import { InMemoryWorkspace } from './inMemoryWorkspace';
import { nulLogger } from './nulLogging';
import { CURSOR, getCursorPositions, joinLines, withStore, workspacePath } from './util';


async function getCompletionsAtCursor(store: DisposableStore, resource: URI, fileContents: string, workspace?: IWorkspace, configOverrides: Partial<LsConfiguration> = {}) {
	const doc = new InMemoryDocument(resource, fileContents);
	const config = getLsConfiguration(configOverrides);

	const engine = createNewMarkdownEngine();
	const ws = workspace ?? store.add(new InMemoryWorkspace([doc]));
	const tocProvider = store.add(new MdTableOfContentsProvider(engine, ws, nulLogger));
	const linkProvider = store.add(new MdLinkProvider(config, engine, ws, tocProvider, nulLogger));
	const provider = new MdPathCompletionProvider(config, ws, engine, linkProvider);
	const cursorPositions = getCursorPositions(fileContents, doc);
	const completions = await provider.provideCompletionItems(doc, cursorPositions[0], {
		triggerCharacter: undefined,
		triggerKind: ls.CompletionTriggerKind.Invoked,
	}, noopToken);

	return completions.sort((a, b) => (a.label as string).localeCompare(b.label as string));
}

function assertCompletionsEqual(actual: readonly lsp.CompletionItem[], expected: readonly { label: string; insertText?: string }[]) {
	assert.strictEqual(actual.length, expected.length, 'Completion counts should be equal');

	for (let i = 0; i < actual.length; ++i) {
		const act = actual[i];
		const exp = expected[i];

		assert.strictEqual(act.label, exp.label, `Completion labels ${i} should be equal`);
		assert.strictEqual((act.textEdit as lsp.InsertReplaceEdit).newText, exp.insertText ?? exp.label, `New text ${i} should be equal`);
	}
}

suite('Path completions', () => {

	test('Should not return anything when triggered in empty doc', withStore(async (store) => {
		const completions = await getCompletionsAtCursor(store, workspacePath('new.md'), `${CURSOR}`);
		assertCompletionsEqual(completions, []);
	}));

	test('Should return anchor completions', withStore(async (store) => {
		const completions = await getCompletionsAtCursor(store, workspacePath('new.md'), joinLines(
			`[](#${CURSOR}`,
			``,
			`# A b C`,
			`# x y Z`,
		));

		assertCompletionsEqual(completions, [
			{ label: '#a-b-c' },
			{ label: '#x-y-z' },
		]);
	}));

	test('Should not return suggestions for http links', withStore(async (store) => {
		const completions = await getCompletionsAtCursor(store, workspacePath('new.md'), joinLines(
			`[](http:${CURSOR}`,
			``,
			`# http`,
			`# http:`,
			`# https:`,
		));

		assertCompletionsEqual(completions, []);
	}));

	test('Should return relative path suggestions', withStore(async (store) => {
		const workspace = new InMemoryWorkspace([
			new InMemoryDocument(workspacePath('a.md'), ''),
			new InMemoryDocument(workspacePath('b.md'), ''),
			new InMemoryDocument(workspacePath('sub', 'foo.md'), ''),
		]);
		const completions = await getCompletionsAtCursor(store, workspacePath('new.md'), joinLines(
			`[](${CURSOR}`,
			``,
			`# A b C`,
		), workspace);

		assertCompletionsEqual(completions, [
			{ label: '#a-b-c' },
			{ label: 'a.md' },
			{ label: 'b.md' },
			{ label: 'sub/' },
		]);
	}));

	test('Should return relative path suggestions using ./', withStore(async (store) => {
		const workspace = new InMemoryWorkspace([
			new InMemoryDocument(workspacePath('a.md'), ''),
			new InMemoryDocument(workspacePath('b.md'), ''),
			new InMemoryDocument(workspacePath('sub', 'foo.md'), ''),
		]);

		const completions = await getCompletionsAtCursor(store, workspacePath('new.md'), joinLines(
			`[](./${CURSOR}`,
			``,
			`# A b C`,
		), workspace);

		assertCompletionsEqual(completions, [
			{ label: 'a.md' },
			{ label: 'b.md' },
			{ label: 'sub/' },
		]);
	}));

	test('Should return absolute path suggestions using /', withStore(async (store) => {
		const workspace = new InMemoryWorkspace([
			new InMemoryDocument(workspacePath('a.md'), ''),
			new InMemoryDocument(workspacePath('b.md'), ''),
			new InMemoryDocument(workspacePath('sub', 'c.md'), ''),
		]);

		const completions = await getCompletionsAtCursor(store, workspacePath('sub', 'new.md'), joinLines(
			`[](/${CURSOR}`,
			``,
			`# A b C`,
		), workspace);

		assertCompletionsEqual(completions, [
			{ label: 'a.md' },
			{ label: 'b.md' },
			{ label: 'sub/' },
		]);
	}));

	test('Should return anchor suggestions in other file', withStore(async (store) => {
		const workspace = new InMemoryWorkspace([
			new InMemoryDocument(workspacePath('b.md'), joinLines(
				`# b`,
				``,
				`[./a](./a)`,
				``,
				`# header1`,
			)),
		]);
		const completions = await getCompletionsAtCursor(store, workspacePath('sub', 'new.md'), joinLines(
			`[](/b.md#${CURSOR}`,
		), workspace);

		assertCompletionsEqual(completions, [
			{ label: '#b' },
			{ label: '#header1' },
		]);
	}));

	test('Should reference links for current file', withStore(async (store) => {
		const completions = await getCompletionsAtCursor(store, workspacePath('sub', 'new.md'), joinLines(
			`[][${CURSOR}`,
			``,
			`[ref-1]: bla`,
			`[ref-2]: bla`,
		));

		assertCompletionsEqual(completions, [
			{ label: 'ref-1' },
			{ label: 'ref-2' },
		]);
	}));

	test('Should complete headers in link definitions', withStore(async (store) => {
		const completions = await getCompletionsAtCursor(store, workspacePath('sub', 'new.md'), joinLines(
			`# a B c`,
			`# x y    Z`,
			`[ref-1]: ${CURSOR}`,
		));

		assertCompletionsEqual(completions, [
			{ label: '#a-b-c' },
			{ label: '#x-y-z' },
			{ label: 'new.md' },
		]);
	}));

	test('Should complete relative paths in link definitions', withStore(async (store) => {
		const workspace = new InMemoryWorkspace([
			new InMemoryDocument(workspacePath('a.md'), ''),
			new InMemoryDocument(workspacePath('b.md'), ''),
			new InMemoryDocument(workspacePath('sub', 'c.md'), ''),
		]);

		const completions = await getCompletionsAtCursor(store, workspacePath('new.md'), joinLines(
			`# a B c`,
			`[ref-1]: ${CURSOR}`,
		), workspace);

		assertCompletionsEqual(completions, [
			{ label: '#a-b-c' },
			{ label: 'a.md' },
			{ label: 'b.md' },
			{ label: 'sub/' },
		]);
	}));

	test('Should escape spaces in path names', withStore(async (store) => {
		const workspace = new InMemoryWorkspace([
			new InMemoryDocument(workspacePath('a.md'), ''),
			new InMemoryDocument(workspacePath('b.md'), ''),
			new InMemoryDocument(workspacePath('sub', 'file with space.md'), ''),
		]);

		const completions = await getCompletionsAtCursor(store, workspacePath('new.md'), joinLines(
			`[](./sub/${CURSOR})`
		), workspace);

		assertCompletionsEqual(completions, [
			{ label: 'file with space.md', insertText: 'file%20with%20space.md' },
		]);
	}));

	test('Should support completions on angle bracket path with spaces', withStore(async (store) => {
		const workspace = new InMemoryWorkspace([
			new InMemoryDocument(workspacePath('sub with space', 'a.md'), ''),
			new InMemoryDocument(workspacePath('b.md'), ''),
		]);

		const completions = await getCompletionsAtCursor(store, workspacePath('new.md'), joinLines(
			`[](</sub with space/${CURSOR}`
		), workspace);

		assertCompletionsEqual(completions, [
			{ label: 'a.md', insertText: 'a.md' },
		]);
	}));

	test('Should not escape spaces in path names that use angle brackets', withStore(async (store) => {
		const workspace = new InMemoryWorkspace([
			new InMemoryDocument(workspacePath('sub', 'file with space.md'), ''),
		]);

		{
			const completions = await getCompletionsAtCursor(store, workspacePath('new.md'), joinLines(
				`[](<./sub/${CURSOR}`
			), workspace);

			assertCompletionsEqual(completions, [
				{ label: 'file with space.md', insertText: 'file with space.md' },
			]);
		}
		{
			const completions = await getCompletionsAtCursor(store, workspacePath('new.md'), joinLines(
				`[](<./sub/${CURSOR}>`
			), workspace);

			assertCompletionsEqual(completions, [
				{ label: 'file with space.md', insertText: 'file with space.md' },
			]);
		}
	}));

	test('Should complete paths for path with encoded spaces', withStore(async (store) => {
		const workspace = new InMemoryWorkspace([
			new InMemoryDocument(workspacePath('a.md'), ''),
			new InMemoryDocument(workspacePath('b.md'), ''),
			new InMemoryDocument(workspacePath('sub with space', 'file.md'), ''),
		]);

		const completions = await getCompletionsAtCursor(store, workspacePath('new.md'), joinLines(
			`[](./sub%20with%20space/${CURSOR})`
		), workspace);

		assertCompletionsEqual(completions, [
			{ label: 'file.md', insertText: 'file.md' },
		]);
	}));

	test('Should complete definition path for path with encoded spaces', withStore(async (store) => {
		const workspace = new InMemoryWorkspace([
			new InMemoryDocument(workspacePath('a.md'), ''),
			new InMemoryDocument(workspacePath('b.md'), ''),
			new InMemoryDocument(workspacePath('sub with space', 'file.md'), ''),
		]);

		const completions = await getCompletionsAtCursor(store, workspacePath('new.md'), joinLines(
			`[def]: ./sub%20with%20space/${CURSOR}`
		), workspace);

		assertCompletionsEqual(completions, [
			{ label: 'file.md', insertText: 'file.md' },
		]);
	}));

	test('Should support definition path with angle brackets', withStore(async (store) => {
		const workspace = new InMemoryWorkspace([
			new InMemoryDocument(workspacePath('a.md'), ''),
			new InMemoryDocument(workspacePath('b.md'), ''),
			new InMemoryDocument(workspacePath('sub with space', 'file.md'), ''),
		]);

		const completions = await getCompletionsAtCursor(store, workspacePath('new.md'), joinLines(
			`[def]: <./${CURSOR}>`
		), workspace);

		assertCompletionsEqual(completions, [
			{ label: 'a.md', insertText: 'a.md' },
			{ label: 'b.md', insertText: 'b.md' },
			{ label: 'sub with space/', insertText: 'sub with space/' },
		]);
	}));

	test('Should return completions for links with square brackets', withStore(async (store) => {
		const completions = await getCompletionsAtCursor(store, workspacePath('new.md'), joinLines(
			`[x [y] z](#${CURSOR}`,
			``,
			`# A b C`,
		));

		assertCompletionsEqual(completions, [
			{ label: '#a-b-c' },
		]);
	}));

	test('Should exclude completions for excluded paths', withStore(async (store) => {
		const workspace = new InMemoryWorkspace([
			new InMemoryDocument(workspacePath('a.md'), ''),
			new InMemoryDocument(workspacePath('.other.md'), ''),
			new InMemoryDocument(workspacePath('sub', 'file.md'), ''),
			new InMemoryDocument(workspacePath('b.md'), ''),
		]);

		const completions = await getCompletionsAtCursor(store, workspacePath('new.md'), joinLines(
			`[def]: ./${CURSOR}`
		), workspace, {
			excludePaths: [
				'**/sub/**',
				'**/.*',
			]
		});

		assertCompletionsEqual(completions, [
			{ label: 'a.md', insertText: 'a.md' },
			{ label: 'b.md', insertText: 'b.md' },
		]);
	}));
});
