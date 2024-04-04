/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as lsp from 'vscode-languageserver-protocol';
import { getLsConfiguration } from '../config';
import { MdLinkProvider } from '../languageFeatures/documentLinks';
import { MdHoverProvider } from '../languageFeatures/hover';
import { MdTableOfContentsProvider } from '../tableOfContents';
import { InMemoryDocument } from '../types/inMemoryDocument';
import { noopToken } from '../util/cancellation';
import { IWorkspace } from '../workspace';
import { createNewMarkdownEngine } from './engine';
import { InMemoryWorkspace } from './inMemoryWorkspace';
import { nulLogger } from './nulLogging';
import { assertRangeEqual, DisposableStore, joinLines, withStore, workspacePath } from './util';
import Token = require('markdown-it/lib/token');
import { URI } from 'vscode-uri';


function getHover(store: DisposableStore, doc: InMemoryDocument, pos: lsp.Position, workspace: IWorkspace) {
	const engine = createNewMarkdownEngine();
	const tocProvider = store.add(new MdTableOfContentsProvider(engine, workspace, nulLogger));
	const linkProvider = store.add(new MdLinkProvider(getLsConfiguration({}), engine, workspace, tocProvider, nulLogger));
	const provider = new MdHoverProvider(linkProvider);
	return provider.provideHover(doc, pos, noopToken);
}

async function flatTokenizeContents(contents: lsp.MarkupContent) {
	const engine = createNewMarkdownEngine();
	const tokens = await engine.tokenize(new InMemoryDocument(workspacePath('fake'), contents.value));

	function flatten(tokens: readonly Token[]): Token[] {
		const out: Token[] = [];
		for (const token of tokens) {
			out.push(token);
			if (token.children) {
				out.push(...flatten(flatten(token.children)));
			}
		}
		return out;
	}
	return flatten(tokens as Token[]);
}

async function findMdImageSrc(hover: lsp.Hover): Promise<URI | undefined> {
	assert.ok(lsp.MarkupContent.is(hover.contents));
	const tokens = await flatTokenizeContents(hover.contents);
	const img = tokens.find(t => t.type === 'image')!;
	const src = img!.attrs?.find(x => x[0] === 'src')?.[1];
	if (!src) {
		return;
	}
	const parsed = URI.parse(src);

	// Remove `|width=...` from path
	return parsed.with({
		path: parsed.path.split('|')[0]
	});
}

suite('Hover', () => {
	test('Should return nothing if not on path', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('doc.md'), joinLines(
			`![img](./cat.png "title")`,
		));
		const workspace = store.add(new InMemoryWorkspace([doc]));

		assert.ok(!await getHover(store, doc, { line: 0, character: 0 }, workspace));
		assert.ok(!await getHover(store, doc, { line: 0, character: 3 }, workspace));
		assert.ok(!await getHover(store, doc, { line: 0, character: 19 }, workspace));
	}));

	test('Should return image hover on MD image path', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('doc.md'), joinLines(
			`![img](./cat.png)`,
		));
		const workspace = store.add(new InMemoryWorkspace([doc]));

		const hover = await getHover(store, doc, { line: 0, character: 10 }, workspace);
		assert.ok(hover);
		
		const src = await findMdImageSrc(hover);
		assert.strictEqual(src?.toString(), workspacePath('cat.png').toString());

		assertRangeEqual(lsp.Range.create(0, 7, 0, 16), hover.range!);
	}));

	test('Should handle MD images with spaces', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('doc.md'), joinLines(
			`![img](<./s p a c e.png>)`,
		));
		const workspace = store.add(new InMemoryWorkspace([doc]));

		const hover = await getHover(store, doc, { line: 0, character: 10 }, workspace);
		assert.ok(hover);
		
		const src = await findMdImageSrc(hover);
		assert.strictEqual(src?.toString(), workspacePath('s p a c e.png').toString());

		assertRangeEqual(lsp.Range.create(0, 8, 0, 23), hover.range!);
	}));

	test('Should provide hover on <img> src', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('doc.md'), joinLines(
			`<img src="cat.png">`,
		));
		const workspace = store.add(new InMemoryWorkspace([doc]));

		const hover = await getHover(store, doc, { line: 0, character: 12 }, workspace);
		assert.ok(hover);
		
		const src = await findMdImageSrc(hover);
		assert.strictEqual(src?.toString(), workspacePath('cat.png').toString());

		assertRangeEqual(lsp.Range.create(0, 10, 0, 17), hover.range!);
	}));
});
