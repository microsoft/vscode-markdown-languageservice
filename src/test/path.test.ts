/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { parseLocationInfoFromFragment } from '../util/path';

suite('parseLocationInfoFromFragment', () => {

	test('Should not parse empty fragment', () => {
		assert.strictEqual(parseLocationInfoFromFragment(''), undefined);
	});

	test('Should not parse non-location fragment', () => {
		assert.strictEqual(parseLocationInfoFromFragment('some-header'), undefined);
	});

	test('Should parse line number without L prefix', () => {
		const result = parseLocationInfoFromFragment('73');
		assert.deepStrictEqual(result, { start: { line: 72, character: 0 }, end: { line: 72, character: 0 } });
	});

	test('Should parse line number with L prefix', () => {
		const result = parseLocationInfoFromFragment('L73');
		assert.deepStrictEqual(result, { start: { line: 72, character: 0 }, end: { line: 72, character: 0 } });
	});

	test('Should parse line and column without L prefix', () => {
		const result = parseLocationInfoFromFragment('73,84');
		assert.deepStrictEqual(result, { start: { line: 72, character: 83 }, end: { line: 72, character: 83 } });
	});

	test('Should parse line and column with L prefix', () => {
		const result = parseLocationInfoFromFragment('L73,84');
		assert.deepStrictEqual(result, { start: { line: 72, character: 83 }, end: { line: 72, character: 83 } });
	});

	test('Should parse line range without L prefix', () => {
		const result = parseLocationInfoFromFragment('73-83');
		assert.deepStrictEqual(result, { start: { line: 72, character: 0 }, end: { line: 82, character: 0 } });
	});

	test('Should parse line range with L prefix', () => {
		const result = parseLocationInfoFromFragment('L73-L83');
		assert.deepStrictEqual(result, { start: { line: 72, character: 0 }, end: { line: 82, character: 0 } });
	});

	test('Should parse full range without L prefix', () => {
		const result = parseLocationInfoFromFragment('73,84-83,52');
		assert.deepStrictEqual(result, { start: { line: 72, character: 83 }, end: { line: 82, character: 51 } });
	});

	test('Should parse full range with L prefix', () => {
		const result = parseLocationInfoFromFragment('L73,84-L83,52');
		assert.deepStrictEqual(result, { start: { line: 72, character: 83 }, end: { line: 82, character: 51 } });
	});

	test('Should be case insensitive for L prefix', () => {
		const result = parseLocationInfoFromFragment('l73');
		assert.deepStrictEqual(result, { start: { line: 72, character: 0 }, end: { line: 72, character: 0 } });
	});
});
