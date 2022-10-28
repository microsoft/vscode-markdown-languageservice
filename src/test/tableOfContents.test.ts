/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from 'vscode-uri';
import { TableOfContents } from '../tableOfContents';
import { ITextDocument } from '../types/textDocument';
import { noopToken } from '../util/cancellation';
import { createNewMarkdownEngine } from './engine';
import { InMemoryDocument } from './inMemoryDocument';
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

		assert.strictEqual(provider.lookup(''), undefined);
		assert.strictEqual(provider.lookup('foo'), undefined);
	});

	test('Lookup should not return anything for document with no headers', async () => {
		const doc = new InMemoryDocument(testFileName, joinLines(
			`a *b*`,
			`c`,
		));
		const provider = await createToc(doc);

		assert.strictEqual(provider.lookup(''), undefined);
		assert.strictEqual(provider.lookup('foo'), undefined);
		assert.strictEqual(provider.lookup('a'), undefined);
		assert.strictEqual(provider.lookup('b'), undefined);
	});

	test('Lookup should return basic #header', async () => {
		const doc = new InMemoryDocument(testFileName, joinLines(
			`# a`,
			`x`,
			`# c`,
		));
		const provider = await createToc(doc);

		{
			const entry = provider.lookup('a');
			assert.ok(entry);
			assert.strictEqual(entry!.line, 0);
		}
		{
			assert.strictEqual(provider.lookup('x'), undefined);
		}
		{
			const entry = provider.lookup('c');
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

		assert.strictEqual((provider.lookup('fOo'))!.line, 0);
		assert.strictEqual((provider.lookup('foo'))!.line, 0);
		assert.strictEqual((provider.lookup('FOO'))!.line, 0);
	});

	test('Lookups should ignore leading and trailing white-space, and collapse internal whitespace', async () => {
		const doc = new InMemoryDocument(testFileName, joinLines(
			`#      f o  o    `,
			``,
		));
		const provider = await createToc(doc);

		assert.strictEqual((provider.lookup('f o  o'))!.line, 0);
		assert.strictEqual((provider.lookup('  f o  o'))!.line, 0);
		assert.strictEqual((provider.lookup('  f o  o  '))!.line, 0);
		assert.strictEqual((provider.lookup('f o o'))!.line, 0);
		assert.strictEqual((provider.lookup('f o       o'))!.line, 0);

		assert.strictEqual(provider.lookup('f'), undefined);
		assert.strictEqual(provider.lookup('foo'), undefined);
		assert.strictEqual(provider.lookup('fo o'), undefined);
	});

	test('should handle special characters #44779', async () => {
		const doc = new InMemoryDocument(testFileName, joinLines(
			`# Indentação`,
			``,
		));
		const provider = await createToc(doc);

		assert.strictEqual((provider.lookup('indentação'))!.line, 0);
	});

	test('should handle special characters 2, #48482', async () => {
		const doc = new InMemoryDocument(testFileName, joinLines(
			`# Инструкция - Делай Раз, Делай Два`,
			``,
		));
		const provider = await createToc(doc);

		assert.strictEqual((provider.lookup('инструкция---делай-раз-делай-два'))!.line, 0);
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

		assert.strictEqual((provider.lookup('header-2'))!.line, 0);
		assert.strictEqual((provider.lookup('header-3'))!.line, 1);
		assert.strictEqual((provider.lookup('Заголовок-2'))!.line, 2);
		assert.strictEqual((provider.lookup('Заголовок-3'))!.line, 3);
		assert.strictEqual((provider.lookup('Заголовок-header-3'))!.line, 4);
		assert.strictEqual((provider.lookup('Заголовок'))!.line, 5);
	});

	test('Lookup should support suffixes for repeated headers', async () => {
		const doc = new InMemoryDocument(testFileName, joinLines(
			`# a`,
			`# a`,
			`## a`,
		));
		const provider = await createToc(doc);

		{
			const entry = provider.lookup('a');
			assert.ok(entry);
			assert.strictEqual(entry!.line, 0);
		}
		{
			const entry = provider.lookup('a-1');
			assert.ok(entry);
			assert.strictEqual(entry!.line, 1);
		}
		{
			const entry = provider.lookup('a-2');
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
