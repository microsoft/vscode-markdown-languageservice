/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { getLsConfiguration } from '../config.js';
import { createWorkspaceLinkCache } from '../languageFeatures/documentLinks.js';
import { MdReference, MdReferencesProvider } from '../languageFeatures/references.js';
import { MdTableOfContentsProvider } from '../tableOfContents.js';
import { InMemoryDocument } from '../types/inMemoryDocument.js';
import { noopToken } from '../util/cancellation.js';
import { URI } from 'vscode-uri';
import { IWorkspace } from '../workspace.js';
import { createNewMarkdownEngine } from './engine.js';
import { InMemoryWorkspace } from './inMemoryWorkspace.js';
import { nulLogger } from './nulLogging.js';
import { DisposableStore, joinLines, withStore, workspacePath } from './util.js';


function getFileReferences(store: DisposableStore, resource: URI, workspace: IWorkspace) {
	const engine = createNewMarkdownEngine();
	const tocProvider = store.add(new MdTableOfContentsProvider(engine, workspace, nulLogger));
	const linkCache = store.add(createWorkspaceLinkCache(engine, workspace));
	const computer = store.add(new MdReferencesProvider(getLsConfiguration({}), engine, workspace, tocProvider, linkCache, nulLogger));
	return computer.getReferencesToFileInWorkspace(resource, noopToken);
}

function assertReferencesEqual(actualRefs: readonly MdReference[], ...expectedRefs: { uri: URI; line: number }[]) {
	assert.strictEqual(actualRefs.length, expectedRefs.length, `Reference counts should match`);

	for (let i = 0; i < actualRefs.length; ++i) {
		const actual = actualRefs[i].location;
		const expected = expectedRefs[i];
		assert.strictEqual(actual.uri.toString(), expected.uri.toString(), `Ref '${i}' has expected document`);
		assert.strictEqual(actual.range.start.line, expected.line, `Ref '${i}' has expected start line`);
		assert.strictEqual(actual.range.end.line, expected.line, `Ref '${i}' has expected end line`);
	}
}

suite('File references', () => {

	test('Should find basic references', withStore(async (store) => {
		const docUri = workspacePath('doc.md');
		const otherUri = workspacePath('other.md');
		const workspace = store.add(new InMemoryWorkspace([
			new InMemoryDocument(docUri, joinLines(
				`# header`,
				`[link 1](./other.md)`,
				`[link 2](./other.md)`
			)),
			new InMemoryDocument(otherUri, joinLines(
				`# header`,
				`pre`,
				`[link 3](./other.md)`,
				`post`
			)),
		]));

		const refs = await getFileReferences(store, otherUri, workspace);
		assertReferencesEqual(refs,
			{ uri: docUri, line: 1 },
			{ uri: docUri, line: 2 },
			{ uri: otherUri, line: 2 },
		);
	}));

	test('Should find references with and without file extensions', withStore(async (store) => {
		const docUri = workspacePath('doc.md');
		const otherUri = workspacePath('other.md');
		const workspace = store.add(new InMemoryWorkspace([
			new InMemoryDocument(docUri, joinLines(
				`# header`,
				`[link 1](./other.md)`,
				`[link 2](./other)`
			)),
			new InMemoryDocument(otherUri, joinLines(
				`# header`,
				`pre`,
				`[link 3](./other.md)`,
				`[link 4](./other)`,
				`post`
			)),
		]));

		const refs = await getFileReferences(store, otherUri, workspace);
		assertReferencesEqual(refs,
			{ uri: docUri, line: 1 },
			{ uri: docUri, line: 2 },
			{ uri: otherUri, line: 2 },
			{ uri: otherUri, line: 3 },
		);
	}));

	test('Should find references with headers on links', withStore(async (store) => {
		const docUri = workspacePath('doc.md');
		const otherUri = workspacePath('other.md');
		const workspace = store.add(new InMemoryWorkspace([
			new InMemoryDocument(docUri, joinLines(
				`# header`,
				`[link 1](./other.md#sub-bla)`,
				`[link 2](./other#sub-bla)`
			)),
			new InMemoryDocument(otherUri, joinLines(
				`# header`,
				`pre`,
				`[link 3](./other.md#sub-bla)`,
				`[link 4](./other#sub-bla)`,
				`post`
			)),
		]));

		const refs = await getFileReferences(store, otherUri, workspace);
		assertReferencesEqual(refs,
			{ uri: docUri, line: 1 },
			{ uri: docUri, line: 2 },
			{ uri: otherUri, line: 2 },
			{ uri: otherUri, line: 3 },
		);
	}));
});
