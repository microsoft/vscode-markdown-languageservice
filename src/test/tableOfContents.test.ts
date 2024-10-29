/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from 'vscode-uri';
import { TableOfContents } from '../tableOfContents';
import { InMemoryDocument } from '../types/inMemoryDocument';
import { ITextDocument } from '../types/textDocument';
import { noopToken } from '../util/cancellation';
import { createNewMarkdownEngine } from './engine';
import { joinLines } from './util';


const testFileName = URI.file('test.md');

function createToc(doc: ITextDocument): Promise<TableOfContents> {
	const engine = createNewMarkdownEngine();
	return TableOfContents.create(engine, doc, noopToken);
}

suite('Table of contents', () => {
	test('Lookup should not return anything for empty document', async () => {
		const doc = new InMemoryDocument(testFileName, '');
		const provider = await createToc(doc);

		assert.strictEqual(provider.lookupByFragment(''), undefined);
		assert.strictEqual(provider.lookupByFragment('foo'), undefined);
	});

	test('Lookup should not return anything for document with no headers', async () => {
		const doc = new InMemoryDocument(testFileName, joinLines(
			`a *b*`,
			`c`,
		));
		const provider = await createToc(doc);

		assert.strictEqual(provider.lookupByFragment(''), undefined);
		assert.strictEqual(provider.lookupByFragment('foo'), undefined);
		assert.strictEqual(provider.lookupByFragment('a'), undefined);
		assert.strictEqual(provider.lookupByFragment('b'), undefined);
	});

	test('Lookup should return basic #header', async () => {
		const doc = new InMemoryDocument(testFileName, joinLines(
			`# a`,
			`x`,
			`# c`,
		));
		const provider = await createToc(doc);

		{
			const entry = provider.lookupByFragment('a');
			assert.ok(entry);
			assert.strictEqual(entry!.line, 0);
		}
		{
			assert.strictEqual(provider.lookupByFragment('x'), undefined);
		}
		{
			const entry = provider.lookupByFragment('c');
			assert.ok(entry);
			assert.strictEqual(entry!.line, 2);
		}
	});

	test('Lookups should be case in-sensitive', async () => {
		const doc = new InMemoryDocument(testFileName, joinLines(
			`# fOo`,
			``,
		));
		const provider = await createToc(doc);

		assert.strictEqual((provider.lookupByFragment('fOo'))!.line, 0);
		assert.strictEqual((provider.lookupByFragment('foo'))!.line, 0);
		assert.strictEqual((provider.lookupByFragment('FOO'))!.line, 0);
	});

	test('should handle special characters #44779', async () => {
		const doc = new InMemoryDocument(testFileName, joinLines(
			`# Indentação`,
			``,
		));
		const provider = await createToc(doc);

		assert.strictEqual((provider.lookupByFragment('indentação'))!.line, 0);
	});

	test('should handle special characters 2, #48482', async () => {
		const doc = new InMemoryDocument(testFileName, joinLines(
			`# Инструкция - Делай Раз, Делай Два`,
			``,
		));
		const provider = await createToc(doc);

		assert.strictEqual((provider.lookupByFragment('инструкция---делай-раз-делай-два'))!.line, 0);
	});

	test('should handle special characters 3, #37079', async () => {
		const doc = new InMemoryDocument(testFileName, joinLines(
			`## Header 2`,
			`### Header 3`,
			`## Заголовок 2`,
			`### Заголовок 3`,
			`### Заголовок Header 3`,
			`## Заголовок`,
		));

		const provider = await createToc(doc);

		assert.strictEqual((provider.lookupByFragment('header-2'))!.line, 0);
		assert.strictEqual((provider.lookupByFragment('header-3'))!.line, 1);
		assert.strictEqual((provider.lookupByFragment('Заголовок-2'))!.line, 2);
		assert.strictEqual((provider.lookupByFragment('Заголовок-3'))!.line, 3);
		assert.strictEqual((provider.lookupByFragment('Заголовок-header-3'))!.line, 4);
		assert.strictEqual((provider.lookupByFragment('Заголовок'))!.line, 5);
	});

	test('Lookup should support suffixes for repeated headers', async () => {
		const doc = new InMemoryDocument(testFileName, joinLines(
			`# a`,
			`# a`,
			`## a`,
		));
		const provider = await createToc(doc);

		{
			const entry = provider.lookupByFragment('a');
			assert.ok(entry);
			assert.strictEqual(entry!.line, 0);
		}
		{
			const entry = provider.lookupByFragment('a-1');
			assert.ok(entry);
			assert.strictEqual(entry!.line, 1);
		}
		{
			const entry = provider.lookupByFragment('a-2');
			assert.ok(entry);
			assert.strictEqual(entry!.line, 2);
		}
	});

	test('Should preserve underscores in headers', async () => {
		const doc = new InMemoryDocument(testFileName, joinLines(
			`# A_B c`,
		));
		const provider = await createToc(doc);

		assert.strictEqual(provider.entries.length, 1);
		assert.strictEqual(provider.entries[0].slug.value, 'a_b-c');
	});

	test('Should ignore italics when creating slug', async () => {
		const doc = new InMemoryDocument(testFileName, joinLines(
			`# _A_B c_`,
		));
		const provider = await createToc(doc);

		assert.strictEqual(provider.entries.length, 1);
		assert.strictEqual(provider.entries[0].slug.value, 'a_b-c');
	});

	test('Should ignore inline code when creating slug', async () => {
		const doc = new InMemoryDocument(testFileName, joinLines(
			`# a \`b\` c`,
		));
		const provider = await createToc(doc);

		assert.strictEqual(provider.entries.length, 1);
		assert.strictEqual(provider.entries[0].slug.value, 'a-b-c');
	});
});
