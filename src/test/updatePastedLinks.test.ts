/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as lsp from 'vscode-languageserver-protocol';
import { getLsConfiguration, LsConfiguration, PreferredMdPathExtensionStyle } from '../config';
import { MdLinkProvider } from '../languageFeatures/documentLinks';
import { MdUpdatePastedLinksProvider } from '../languageFeatures/updatePastedLinks';
import { MdTableOfContentsProvider } from '../tableOfContents';
import { InMemoryDocument } from '../types/inMemoryDocument';
import { noopToken } from '../util/cancellation';
import { IWorkspace } from '../workspace';
import { createNewMarkdownEngine } from './engine';
import { InMemoryWorkspace } from './inMemoryWorkspace';
import { nulLogger } from './nulLogging';
import { DisposableStore, joinLines, withStore, workspacePath } from './util';


async function applyUpdateLinksEdits(store: DisposableStore, docs: { copyFrom: InMemoryDocument, pasteTo: InMemoryDocument }, edits: readonly lsp.TextEdit[], workspace: IWorkspace, configOverrides: Partial<LsConfiguration> = {}): Promise<string | undefined> {
	const engine = createNewMarkdownEngine();
	const config = getLsConfiguration(configOverrides);

	const tocProvider = store.add(new MdTableOfContentsProvider(engine, workspace, nulLogger));
	const linkProvider = store.add(new MdLinkProvider(config, engine, workspace, tocProvider, nulLogger));

	const rewriteProvider = new MdUpdatePastedLinksProvider(config, linkProvider);
	const metadata = await rewriteProvider.prepareDocumentPaste(docs.copyFrom, [], noopToken);
	const rewriteEdits = await rewriteProvider.provideDocumentPasteEdits(docs.pasteTo, edits, metadata, noopToken);
	return rewriteEdits && docs.pasteTo.previewEdits(rewriteEdits);
}


suite('Update pasted links', () => {

	test('Should noop for empty edit', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('doc.md'), joinLines());
		const workspace = store.add(new InMemoryWorkspace([doc]));

		const resultDocText = await applyUpdateLinksEdits(store,
			{ copyFrom: new InMemoryDocument(workspacePath('other.md'), ''), pasteTo: doc },
			[], workspace);
		assert.strictEqual(resultDocText, undefined);
	}));

	test('Should noop for non link paste', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('doc.md'), joinLines());
		const workspace = store.add(new InMemoryWorkspace([doc]));

		const resultDocText = await applyUpdateLinksEdits(store,
			{ copyFrom: new InMemoryDocument(workspacePath('other.md'), ''), pasteTo: doc },
			[
				lsp.TextEdit.replace(lsp.Range.create(0, 0, 0, 0), 'file.md')
			], workspace);
		assert.strictEqual(resultDocText, undefined);
	}));

	test('Should noop for http link', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('doc.md'), joinLines());
		const workspace = store.add(new InMemoryWorkspace([doc]));

		const resultDocText = await applyUpdateLinksEdits(store,
			{ copyFrom: new InMemoryDocument(workspacePath('other.md'), ''), pasteTo: doc },
			[
				lsp.TextEdit.replace(lsp.Range.create(0, 0, 0, 0), '[link](http://example.com)')
			], workspace);
		assert.strictEqual(resultDocText, undefined);
	}));

	test('Should noop for absolute links', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('doc.md'), joinLines());
		const workspace = store.add(new InMemoryWorkspace([doc]));

		const resultDocText = await applyUpdateLinksEdits(store,
			{ copyFrom: new InMemoryDocument(workspacePath('other.md'), ''), pasteTo: doc },
			[
				lsp.TextEdit.replace(lsp.Range.create(0, 0, 0, 0), '[link](/other.md)')
			], workspace);
		assert.strictEqual(resultDocText, undefined);
	}));

	test('Should rewrite basic link', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('doc.md'), joinLines());
		const workspace = store.add(new InMemoryWorkspace([doc]));

		const resultDocText = await applyUpdateLinksEdits(store,
			{ copyFrom: new InMemoryDocument(workspacePath('sub/other.md'), ''), pasteTo: doc },
			[
				lsp.TextEdit.replace(lsp.Range.create(0, 0, 0, 0), '![](img.png "title")'),
			], workspace);

		assert.strictEqual(resultDocText, joinLines('![](sub/img.png "title")'));
	}));

	test(`Should noop if relative link isn't actually rewritten`, withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('doc.md'), joinLines());
		const workspace = store.add(new InMemoryWorkspace([doc]));

		const resultDocText = await applyUpdateLinksEdits(store,
			{ copyFrom: new InMemoryDocument(workspacePath('other.md'), ''), pasteTo: doc },
			[
				// Pasted relative link can be used both in original and pasted locations
				lsp.TextEdit.replace(lsp.Range.create(0, 0, 0, 0), '![](img.png "title")'),
			], workspace);

		assert.strictEqual(resultDocText, undefined);
	}));

	test('Should noop when pasting into code block', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('doc.md'), joinLines(
			'```',
			'xxx',
			'```',
		));
		const workspace = store.add(new InMemoryWorkspace([doc]));

		const resultDocText = await applyUpdateLinksEdits(store,
			{ copyFrom: new InMemoryDocument(workspacePath('sub/other.md'), ''), pasteTo: doc },
			[
				lsp.TextEdit.replace(lsp.Range.create(1, 0, 1, 3), '![](img.png "title")'),
			], workspace);

		assert.strictEqual(resultDocText, undefined);
	}));

	test('Should rewrite multiple pasted links', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('doc.md'), joinLines(
			'abc',
			'efg'
		));
		const workspace = store.add(new InMemoryWorkspace([doc]));

		const resultDocText = await applyUpdateLinksEdits(store,
			{ copyFrom: new InMemoryDocument(workspacePath('sub/other.md'), ''), pasteTo: doc },
			[
				lsp.TextEdit.replace(lsp.Range.create(0, 0, 0, 3), '![](img.png "title") ![alt](../img2.png)'),
				lsp.TextEdit.replace(lsp.Range.create(1, 0, 1, 3), '![](img3.png "title") ![alt](../img4.png)'),
			], workspace);

		assert.strictEqual(resultDocText, joinLines(
			'![](sub/img.png "title") ![alt](img2.png)',
			'![](sub/img3.png "title") ![alt](img4.png)',
		));
	}));

	test('Should handle mix of link and non-link pastes', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('doc.md'), joinLines(
			'abc',
			'efg',
			'hij',
		));
		const workspace = store.add(new InMemoryWorkspace([doc]));

		const resultDocText = await applyUpdateLinksEdits(store,
			{ copyFrom: new InMemoryDocument(workspacePath('sub/other.md'), ''), pasteTo: doc },
			[
				lsp.TextEdit.replace(lsp.Range.create(0, 0, 0, 3), '![](img.png "title") ![alt](../img2.png)'),
				lsp.TextEdit.replace(lsp.Range.create(1, 0, 1, 3), 'some text'),
				lsp.TextEdit.replace(lsp.Range.create(2, 0, 2, 3), '![](img3.png "title") ![alt](../img4.png)'),
			], workspace);

		assert.strictEqual(resultDocText, joinLines(
			'![](sub/img.png "title") ![alt](img2.png)',
			'some text',
			'![](sub/img3.png "title") ![alt](img4.png)',
		));
	}));

	test('Should rewrite basic link inline', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('doc.md'), joinLines(
			'abc xxx def',
			'123 xxx 456',
		));
		const workspace = store.add(new InMemoryWorkspace([doc]));

		const resultDocText = await applyUpdateLinksEdits(store,
			{ copyFrom: new InMemoryDocument(workspacePath('sub/other.md'), ''), pasteTo: doc },
			[
				lsp.TextEdit.replace(lsp.Range.create(0, 4, 0, 7), '![](img.png "title")'),
				lsp.TextEdit.replace(lsp.Range.create(1, 4, 1, 7), '![](img.png "title")'),
			], workspace);

		assert.strictEqual(resultDocText, joinLines(
			'abc ![](sub/img.png "title") def',
			'123 ![](sub/img.png "title") 456',
		));
	}));

	test('Should rewrite with multiple pastes on same line', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('doc.md'), joinLines(
			'123456789',
		));
		const workspace = store.add(new InMemoryWorkspace([doc]));

		const resultDocText = await applyUpdateLinksEdits(store,
			{ copyFrom: new InMemoryDocument(workspacePath('sub/other.md'), ''), pasteTo: doc },
			[
				lsp.TextEdit.replace(lsp.Range.create(0, 1, 0, 1), '[text1](x.md "title")'),
				lsp.TextEdit.replace(lsp.Range.create(0, 5, 0, 8), '[text2](y.md "title")'),
			], workspace);

		assert.strictEqual(resultDocText, joinLines(
			'1[text1](sub/x.md "title")2345[text2](sub/y.md "title")9',
		));
	}));

	test('Should rewrite definitions', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('doc.md'), joinLines(
			'abcdef',
		));
		const workspace = store.add(new InMemoryWorkspace([doc]));

		const resultDocText = await applyUpdateLinksEdits(store,
			{ copyFrom: new InMemoryDocument(workspacePath('sub/other.md'), ''), pasteTo: doc },
			[
				lsp.TextEdit.replace(lsp.Range.create(0, 0, 0, 10), '[ref]: ./file.md'),
			], workspace);

		assert.strictEqual(resultDocText, joinLines(
			'[ref]: sub/file.md',
		));
	}));

	test('Should rewrite <img> src', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('doc.md'), joinLines(
			'abcdef',
		));
		const workspace = store.add(new InMemoryWorkspace([doc]));

		const resultDocText = await applyUpdateLinksEdits(store,
			{ copyFrom: new InMemoryDocument(workspacePath('sub/other.md'), ''), pasteTo: doc },
			[
				lsp.TextEdit.replace(lsp.Range.create(0, 1, 0, 3), '<img src="./cat.png">'),
			], workspace);

		assert.strictEqual(resultDocText, joinLines(
			'a<img src="sub/cat.png">def',
		));
	}));

	test('Should not apply when paste creates a new link from incomplete text', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('doc.md'), joinLines(
			'a [text',
		));
		const workspace = store.add(new InMemoryWorkspace([doc]));

		const resultDocText = await applyUpdateLinksEdits(store,
			{ copyFrom: new InMemoryDocument(workspacePath('sub/other.md'), ''), pasteTo: doc },
			[
				lsp.TextEdit.replace(lsp.Range.create(0, 7, 0, 7), '](./file.md)'),
			], workspace);

		assert.strictEqual(resultDocText, undefined);
	}));

	test('Should rewrite definitions', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('doc.md'), joinLines(
			'abcdef',
		));
		const workspace = store.add(new InMemoryWorkspace([doc]));

		const resultDocText = await applyUpdateLinksEdits(store,
			{ copyFrom: new InMemoryDocument(workspacePath('sub/other.md'), ''), pasteTo: doc },
			[
				lsp.TextEdit.replace(lsp.Range.create(0, 0, 0, 10), '[ref]: ./file.md'),
			], workspace);

		assert.strictEqual(resultDocText, joinLines(
			'[ref]: sub/file.md',
		));
	}));

	test('Should rewrite fragment link', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('doc.md'), joinLines(
			'abcdef',
		));
		const workspace = store.add(new InMemoryWorkspace([doc]));

		const resultDocText = await applyUpdateLinksEdits(store,
			{ copyFrom: new InMemoryDocument(workspacePath('sub/other.md'), ''), pasteTo: doc },
			[
				lsp.TextEdit.replace(lsp.Range.create(0, 1, 0, 3), '[text](#header)'),
			], workspace);

		assert.strictEqual(resultDocText, joinLines(
			'a[text](sub/other.md#header)def',
		));
	}));

	test('Should remove file name when copying fragment link back to own file', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('doc.md'), joinLines(
			'# header',
			'abcdef',
		));
		const workspace = store.add(new InMemoryWorkspace([doc]));

		const resultDocText = await applyUpdateLinksEdits(store,
			{ copyFrom: new InMemoryDocument(workspacePath('other.md'), ''), pasteTo: doc },
			[
				lsp.TextEdit.replace(lsp.Range.create(1, 1, 1, 3), '[text](./doc.md#header)'),
			], workspace);

		assert.strictEqual(resultDocText, joinLines(
			`# header`,
			'a[text](#header)def',
		));
	}));

	test('Should respect file ending config', withStore(async (store) => {
		const doc = new InMemoryDocument(workspacePath('doc.md'), joinLines(
			'abcdef',
		));
		const workspace = store.add(new InMemoryWorkspace([doc]));

		const resultDocText = await applyUpdateLinksEdits(store,
			{ copyFrom: new InMemoryDocument(workspacePath('sub/other.md'), ''), pasteTo: doc },
			[
				lsp.TextEdit.replace(lsp.Range.create(0, 0, 0, 10), '[ref]: ./file.md'),
			], workspace,
			{
				preferredMdPathExtensionStyle: PreferredMdPathExtensionStyle.removeExtension
			});

		assert.strictEqual(resultDocText, joinLines(
			'[ref]: sub/file',
		));
	}));

	suite('Rewrite reference links', () => {
		test('Should add definition when pasting reference link', withStore(async (store) => {
			const doc1 = new InMemoryDocument(workspacePath('doc1.md'), joinLines(
				'abcdef',
			));
			const doc2 = new InMemoryDocument(workspacePath('doc2.md'), joinLines(
				`[ref]`,
				``,
				`[ref]: http://example.com`,
			));
			const workspace = store.add(new InMemoryWorkspace([doc1, doc2]));

			const resultDocText = await applyUpdateLinksEdits(store,
				{ copyFrom: doc2, pasteTo: doc1 },
				[
					lsp.TextEdit.replace(lsp.Range.create(0, 3, 0, 3), `[ref]`),
				], workspace);

			assert.strictEqual(resultDocText, joinLines(
				'abc[ref]def',
				``,
				`[ref]: http://example.com`,
			));
		}));

		test('Should not remove existing link definition', withStore(async (store) => {
			const doc1 = new InMemoryDocument(workspacePath('doc1.md'), joinLines(
				'[ref]',
				'abc',
				``,
				`[ref]: http://example.com/1`,
			));
			const doc2 = new InMemoryDocument(workspacePath('doc2.md'), joinLines(
				`[ref2]`,
				``,
				`[ref2]: http://example.com/2`,
			));
			const workspace = store.add(new InMemoryWorkspace([doc1, doc2]));

			const resultDocText = await applyUpdateLinksEdits(store,
				{ copyFrom: doc2, pasteTo: doc1 },
				[
					lsp.TextEdit.replace(lsp.Range.create(1, 0, 1, 3), `[ref2]`),
				], workspace);

			assert.strictEqual(resultDocText, joinLines(
				'[ref]',
				'[ref2]',
				``,
				`[ref]: http://example.com/1`,
				`[ref2]: http://example.com/2`,
			));
		}));

		test('Should skip adding definition if ref exactly matches one is existing doc', withStore(async (store) => {
			const doc1 = new InMemoryDocument(workspacePath('doc1.md'), joinLines(
				'[ref]',
				'abc',
				``,
				`[ref]: http://example.com`,
			));
			const doc2 = new InMemoryDocument(workspacePath('doc2.md'), joinLines(
				`[ref]: http://example.com`,
			));
			const workspace = store.add(new InMemoryWorkspace([doc1, doc2]));

			const resultDocText = await applyUpdateLinksEdits(store,
				{ copyFrom: doc2, pasteTo: doc1 },
				[
					lsp.TextEdit.replace(lsp.Range.create(1, 0, 1, 3), `[ref]`),
				], workspace);

			assert.strictEqual(resultDocText, undefined);
		}));

		test('Should add one definition per ref', withStore(async (store) => {
			const doc1 = new InMemoryDocument(workspacePath('doc1.md'), joinLines(
				'abcdef',
				'123456',
			));
			const doc2 = new InMemoryDocument(workspacePath('doc2.md'), joinLines(
				`[ref1]: http://example.com/1`,
				`[ref2]: http://example.com/2`,
			));
			const workspace = store.add(new InMemoryWorkspace([doc1, doc2]));

			const resultDocText = await applyUpdateLinksEdits(store,
				{ copyFrom: doc2, pasteTo: doc1 },
				[
					lsp.TextEdit.replace(lsp.Range.create(0, 3, 0, 3), `[ref1] [ref2] [ref1]`),
					lsp.TextEdit.replace(lsp.Range.create(1, 3, 1, 3), `[ref1] [ref2] [ref1]`),
				], workspace);

			assert.strictEqual(resultDocText, joinLines(
				'abc[ref1] [ref2] [ref1]def',
				'123[ref1] [ref2] [ref1]456',
				``,
				`[ref1]: http://example.com/1`,
				`[ref2]: http://example.com/2`,
			));
		}));
	});
});
