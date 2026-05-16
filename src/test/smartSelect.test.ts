/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as lsp from 'vscode-languageserver-protocol';
import { getLsConfiguration } from '../config.js';
import { MdLinkProvider } from '../languageFeatures/documentLinks.js';
import { MdSelectionRangeProvider } from '../languageFeatures/smartSelect.js';
import { MdTableOfContentsProvider } from '../tableOfContents.js';
import { InMemoryDocument } from '../types/inMemoryDocument.js';
import { URI } from 'vscode-uri';
import { createNewMarkdownEngine } from './engine.js';
import { InMemoryWorkspace } from './inMemoryWorkspace.js';
import { nulLogger } from './nulLogging.js';
import { CURSOR, getCursorPositions, joinLines } from './util.js';


const testFileName = URI.file('test.md');

suite('Smart select', () => {
	test('Smart select single word', async () => {
		const ranges = await getSelectionRangesForDocument(`Hel${CURSOR}lo`);
		assertNestedLineNumbersEqual(ranges![0], [0, 0]);
	});

	test('Smart select multi-line paragraph', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`Many of the core components and extensions to ${CURSOR}VS Code live in their own repositories on GitHub. `,
			`For example, the[node debug adapter](https://github.com/microsoft/vscode-node-debug) and the [mono debug adapter]`,
			`(https://github.com/microsoft/vscode-mono-debug) have their own repositories. For a complete list, please visit the [Related Projects](https://github.com/microsoft/vscode/wiki/Related-Projects) page on our [wiki](https://github.com/microsoft/vscode/wiki).`
		));
		assertNestedLineNumbersEqual(ranges![0], [0, 2]);
	});

	test('Smart select paragraph', async () => {
		const ranges = await getSelectionRangesForDocument(`Many of the core components and extensions to ${CURSOR}VS Code live in their own repositories on GitHub. For example, the [node debug adapter](https://github.com/microsoft/vscode-node-debug) and the [mono debug adapter](https://github.com/microsoft/vscode-mono-debug) have their own repositories. For a complete list, please visit the [Related Projects](https://github.com/microsoft/vscode/wiki/Related-Projects) page on our [wiki](https://github.com/microsoft/vscode/wiki).`);

		assertNestedLineNumbersEqual(ranges![0], [0, 0]);
	});

	test('Smart select html block', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`<p align="center">`,
			`${CURSOR}<img alt="VS Code in action" src="https://user-images.githubusercontent.com/1487073/58344409-70473b80-7e0a-11e9-8570-b2efc6f8fa44.png">`,
			`</p>`));

		assertNestedLineNumbersEqual(ranges![0], [0, 2]);
	});

	test('Smart select block quote', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`> b1`,
			`b1 ${CURSOR}`,
			``,
			`> b2`,
		));

		assertNestedLineNumbersEqual(ranges![0],
			[1, 1],
			[0, 1],
		);
	});

	test('Smart select table', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`a`,
			``,
			`| a | b |`,
			`|---|---|`,
			`| 1 | 2${CURSOR} |`,
			`| 3 | 4 |`,
			``,
			`b`,
		));

		assertNestedLineNumbersEqual(ranges![0],
			[4, 4], // cell content
			[4, 4], // cell
			[4, 4], // row
			[4, 5], // table body
			[2, 5], // entire table
		);
	});

	test('Smart select header on header line', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`# Header${CURSOR}`,
			`Hello`));

		assertNestedLineNumbersEqual(ranges![0], [0, 1]);
	});

	test('Smart select single word w grandparent header on text line', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`## ParentHeader`,
			`# Header`,
			`${CURSOR}Hello`
		));

		assertNestedLineNumbersEqual(ranges![0], [2, 2], [1, 2]);
	});

	test('Smart select html block w parent header', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`# Header`,
			`${CURSOR}<p align="center">`,
			`<img alt="VS Code in action" src="https://user-images.githubusercontent.com/1487073/58344409-70473b80-7e0a-11e9-8570-b2efc6f8fa44.png">`,
			`</p>`));

		assertNestedLineNumbersEqual(ranges![0], [1, 1], [1, 3], [0, 3]);
	});

	test('Smart select fenced code block', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`~~~`,
			`a${CURSOR}`,
			`~~~`));

		assertNestedLineNumbersEqual(ranges![0], [0, 2]);
	});

	test('Smart select list', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`- item 1`,
			`- ${CURSOR}item 2`,
			`- item 3`,
			`- item 4`));
		assertNestedLineNumbersEqual(ranges![0], [1, 1], [0, 3]);
	});

	test('Smart select list with fenced code block', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`- item 1`,
			`- ~~~`,
			`  ${CURSOR}a`,
			`  ~~~`,
			`- item 3`,
			`- item 4`));

		assertNestedLineNumbersEqual(ranges![0], [1, 3], [0, 5]);
	});

	test('Smart select multi cursor', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`- ${CURSOR}item 1`,
			`- ~~~`,
			`  a`,
			`  ~~~`,
			`- ${CURSOR}item 3`,
			`- item 4`));

		assertNestedLineNumbersEqual(ranges![0], [0, 0], [0, 5]);
		assertNestedLineNumbersEqual(ranges![1], [4, 4], [0, 5]);
	});

	test('Smart select nested block quotes', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`> item 1`,
			`> item 2`,
			`>> ${CURSOR}item 3`,
			`>> item 4`));
		assertNestedLineNumbersEqual(ranges![0], [2, 2], [2, 3], [0, 3]);
	});

	test('Smart select multi nested block quotes', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`> item 1`,
			`>> item 2`,
			`>>> ${CURSOR}item 3`,
			`>>>> item 4`));
		assertNestedLineNumbersEqual(ranges![0], [2, 2], [2, 3], [1, 3], [0, 3]);
	});

	test('Smart select subheader content', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`# main header 1`,
			`content 1`,
			`## sub header 1`,
			`${CURSOR}content 2`,
			`# main header 2`));

		assertNestedLineNumbersEqual(ranges![0], [3, 3], [2, 3], [1, 3], [0, 3]);
	});

	test('Smart select subheader line', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`# main header 1`,
			`content 1`,
			`## sub header 1${CURSOR}`,
			`content 2`,
			`# main header 2`));

		assertNestedLineNumbersEqual(ranges![0], [2, 3], [1, 3], [0, 3]);
	});

	test('Smart select blank line', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`# main header 1`,
			`content 1`,
			`${CURSOR}             `,
			`content 2`,
			`# main header 2`));

		assertNestedLineNumbersEqual(ranges![0], [1, 3], [0, 3]);
	});

	test('Smart select line between paragraphs', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`paragraph 1`,
			`${CURSOR}`,
			`paragraph 2`));

		assertNestedLineNumbersEqual(ranges![0], [0, 2]);
	});

	test('Smart select empty document', async () => {
		const ranges = await getSelectionRangesForDocument(``, [{ line: 0, character: 0 }]);
		assert.strictEqual(ranges!.length, 0);
	});

	test('Smart select fenced code block then list then subheader content then subheader then header content then header', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			/* 00 */ `# main header 1`,
			/* 01 */ `content 1`,
			/* 02 */ `## sub header 1`,
			/* 03 */ `- item 1`,
			/* 04 */ `- ~~~`,
			/* 05 */ `  ${CURSOR}a`,
			/* 06 */ `  ~~~`,
			/* 07 */ `- item 3`,
			/* 08 */ `- item 4`,
			/* 09 */ ``,
			/* 10 */ `more content`,
			/* 11 */ `# main header 2`));

		assertNestedLineNumbersEqual(ranges![0], [4, 6], [3, 8], [3, 10], [2, 10], [1, 10], [0, 10]);
	});

	test('Smart select list with one element without selecting child subheader', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			/* 00 */ `# main header 1`,
			/* 01 */ ``,
			/* 02 */ `- list ${CURSOR}`,
			/* 03 */ ``,
			/* 04 */ `## sub header`,
			/* 05 */ ``,
			/* 06 */ `content 2`,
			/* 07 */ `# main header 2`));

		assertNestedLineNumbersEqual(ranges![0], [2, 2], [1, 3], [1, 6], [0, 6]);
	});

	test('Smart select content under header then subheaders and their content', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`# main ${CURSOR}header 1`,
			``,
			`- list`,
			`paragraph`,
			`## sub header`,
			``,
			`content 2`,
			`# main header 2`));

		assertNestedLineNumbersEqual(ranges![0], [0, 3], [0, 6]);
	});

	test('Smart select last blockquote element under header then subheaders and their content', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`# main header 1`,
			``,
			`> block`,
			`> block`,
			`>> block`,
			`>> ${CURSOR}block`,
			``,
			`paragraph`,
			`## sub header`,
			``,
			`content 2`,
			`# main header 2`));

		assertNestedLineNumbersEqual(ranges![0], [5, 5], [4, 5], [2, 5], [1, 7], [1, 10], [0, 10]);
	});

	test('Smart select content of subheader then subheader then content of main header then main header', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`# main header 1`,
			``,
			`> block`,
			`> block`,
			`>> block`,
			`>> block`,
			``,
			`paragraph`,
			`## sub header`,
			``,
			``,
			`${CURSOR}`,
			``,
			`### main header 2`,
			`- content 2`,
			`- content 2`,
			`- content 2`,
			`content 2`));

		assertNestedLineNumbersEqual(ranges![0], [11, 11], [9, 12], [9, 17], [8, 17], [1, 17], [0, 17]);
	});

	test('Smart select last line content of subheader then subheader then content of main header then main header', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`# main header 1`,
			``,
			`> block`,
			`> block`,
			`>> block`,
			`>> block`,
			``,
			`paragraph`,
			`## sub header`,
			``,
			``,
			``,
			``,
			`### main header 2`,
			`- content 2`,
			`- content 2`,
			`- content 2`,
			`- ${CURSOR}content 2`));

		assertNestedLineNumbersEqual(ranges![0], [17, 17], [14, 17], [13, 17], [9, 17], [8, 17], [1, 17], [0, 17]);
	});

	test('Smart select last line content after content of subheader then subheader then content of main header then main header', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`# main header 1`,
			``,
			`> block`,
			`> block`,
			`>> block`,
			`>> block`,
			``,
			`paragraph`,
			`## sub header`,
			``,
			``,
			``,
			``,
			`### main header 2`,
			`- content 2`,
			`- content 2`,
			`- content 2`,
			`- content 2${CURSOR}`));

		assertNestedLineNumbersEqual(ranges![0], [17, 17], [14, 17], [13, 17], [9, 17], [8, 17], [1, 17], [0, 17]);
	});

	test('Smart select fenced code block then list then rest of content', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`# main header 1`,
			``,
			`> block`,
			`> block`,
			`>> block`,
			`>> block`,
			``,
			`- paragraph`,
			`- ~~~`,
			`  my`,
			`  ${CURSOR}code`,
			`  goes here`,
			`  ~~~`,
			`- content`,
			`- content 2`,
			`- content 2`,
			`- content 2`,
			`- content 2`));

		assertNestedLineNumbersEqual(ranges![0], [9, 11], [8, 12], [7, 17], [1, 17], [0, 17]);
	});

	test('Smart select fenced code block then list then rest of content on fenced line', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`# main header 1`,
			``,
			`> block`,
			`> block`,
			`>> block`,
			`>> block`,
			``,
			`- paragraph`,
			`- ~~~${CURSOR}`,
			`  my`,
			`  code`,
			`  goes here`,
			`  ~~~`,
			`- content`,
			`- content 2`,
			`- content 2`,
			`- content 2`,
			`- content 2`));

		assertNestedLineNumbersEqual(ranges![0], [8, 12], [7, 17], [1, 17], [0, 17]);
	});

	test('Smart select without multiple ranges', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`# main header 1`,
			``,
			``,
			`- ${CURSOR}paragraph`,
			`- content`));

		assertNestedLineNumbersEqual(ranges![0], [3, 3], [3, 4], [1, 4], [0, 4]);
	});

	test('Smart select on second level of a list', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`* level 0`,
			`   * level 1`,
			`   * level 1`,
			`       * level 2`,
			`   * level 1`,
			`   * level ${CURSOR}1`,
			`* level 0`));

		assertNestedLineNumbersEqual(ranges![0], [5, 5], [1, 5], [0, 5], [0, 6]);
	});

	test('Smart select on third level of a list', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`* level 0`,
			`   * level 1`,
			`   * level 1`,
			`       * level ${CURSOR}2`,
			`       * level 2`,
			`   * level 1`,
			`   * level 1`,
			`* level 0`));
		assertNestedLineNumbersEqual(ranges![0], [3, 3], [3, 4], [2, 4], [1, 6], [0, 6], [0, 7]);
	});

	test('Smart select level 2 then level 1', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`* level 1`,
			`   * level ${CURSOR}2`,
			`   * level 2`,
			`* level 1`));
		assertNestedLineNumbersEqual(ranges![0], [1, 1], [1, 2], [0, 2], [0, 3]);
	});

	test('Smart select last list item', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`- level 1`,
			`- level 2`,
			`- level 2`,
			`- level ${CURSOR}1`));
		assertNestedLineNumbersEqual(ranges![0], [3, 3], [0, 3]);
	});

	test('Smart select without multiple ranges', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`# main header 1`,
			``,
			``,
			`- ${CURSOR}paragraph`,
			`- content`));

		assertNestedLineNumbersEqual(ranges![0], [3, 3], [3, 4], [1, 4], [0, 4]);
	});

	test('Smart select on second level of a list', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`* level 0`,
			`	* level 1`,
			`	* level 1`,
			`		* level 2`,
			`	* level 1`,
			`	* level ${CURSOR}1`,
			`* level 0`));

		assertNestedLineNumbersEqual(ranges![0], [5, 5], [1, 5], [0, 5], [0, 6]);
	});

	test('Smart select on third level of a list', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`* level 0`,
			`	* level 1`,
			`	* level 1`,
			`		* level ${CURSOR}2`,
			`		* level 2`,
			`	* level 1`,
			`	* level 1`,
			`* level 0`));
		assertNestedLineNumbersEqual(ranges![0], [3, 3], [3, 4], [2, 4], [1, 6], [0, 6], [0, 7]);
	});

	test('Smart select level 2 then level 1', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`* level 1`,
			`	* level ${CURSOR}2`,
			`	* level 2`,
			`* level 1`));
		assertNestedLineNumbersEqual(ranges![0], [1, 1], [1, 2], [0, 2], [0, 3]);
	});

	test('Smart select bold', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`stuff here **new${CURSOR}item** and here`
		));
		assertNestedRangesEqual(ranges![0], [0, 13, 0, 30], [0, 11, 0, 32], [0, 0, 0, 41]);
	});

	test('Smart select link inside href', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`stuff here [text](https${CURSOR}://google.com) and here`
		));
		assertNestedRangesEqual(ranges![0], [0, 18, 0, 46], [0, 17, 0, 47], [0, 11, 0, 47], [0, 0, 0, 56]);
	});

	test('Smart select link inside text', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`stuff here [te${CURSOR}xt](https://google.com) and here`
		));
		assertNestedRangesEqual(ranges![0], [0, 12, 0, 26], [0, 11, 0, 47], [0, 0, 0, 56]);
	});

	test('Smart select link in text under header in list', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`# main header 1`,
			``,
			`- list`,
			`paragraph`,
			`## sub header`,
			`- list`,
			`- stuff here [te${CURSOR}xt](https://google.com) and here`,
			`- list`
		));
		assertNestedRangesEqual(ranges![0], [6, 14, 6, 28], [6, 13, 6, 49], [6, 0, 6, 58], [5, 0, 7, 6], [4, 0, 7, 6], [1, 0, 7, 6], [0, 0, 7, 6]);
	});

	test('Smart select link in href under header in list', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`# main header 1`,
			``,
			`- list`,
			`paragraph`,
			`## sub header`,
			`- list`,
			`- stuff here [text](${CURSOR}https://google.com) and here`,
			`- list`
		));
		assertNestedRangesEqual(ranges![0], [6, 20, 6, 48], [6, 19, 6, 49], [6, 13, 6, 49], [6, 0, 6, 58], [5, 0, 7, 6], [4, 0, 7, 6], [1, 0, 7, 6], [0, 0, 7, 6]);
	});

	test('Smart select bold within list where multiple bold elements exists', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`# main header 1`,
			``,
			`- list`,
			`paragraph`,
			`## sub header`,
			`- list`,
			`- stuff here [text] **${CURSOR}items in here** and **here**`,
			`- list`
		));
		assertNestedRangesEqual(ranges![0], [6, 22, 6, 45], [6, 20, 6, 47], [6, 0, 6, 60], [5, 0, 7, 6], [4, 0, 7, 6], [1, 0, 7, 6], [0, 0, 7, 6]);
	});

	test('Smart select link in paragraph with multiple links', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`This[extension](https://marketplace.visualstudio.com/items?itemName=meganrogge.template-string-converter)  addresses this [requ${CURSOR}est](https://github.com/microsoft/vscode/issues/56704) to convert Javascript/Typescript quotes to backticks when has been entered within a string.`
		));
		assertNestedRangesEqual(ranges![0], [0, 123, 0, 140], [0, 122, 0, 191], [0, 0, 0, 283]);
	});

	test('Smart select bold link', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`**[extens${CURSOR}ion](https://google.com)**`
		));
		assertNestedRangesEqual(ranges![0], [0, 3, 0, 22], [0, 2, 0, 43], [0, 0, 0, 45]);
	});

	test('Smart select inline code block', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`[\`code ${CURSOR} link\`]`
		));
		assertNestedRangesEqual(ranges![0], [0, 2, 0, 22], [0, 1, 0, 23], [0, 0, 0, 24]);
	});

	test('Smart select link with inline code block text', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`[\`code ${CURSOR} link\`](http://example.com)`
		));
		assertNestedRangesEqual(ranges![0], [0, 2, 0, 22], [0, 1, 0, 23], [0, 0, 0, 44]);
	});

	test('Smart select link in checkbox list', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`- [ ] [text${CURSOR}](https://example.com)`
		));
		assertNestedRangesEqual(ranges![0], [0, 7, 0, 21], [0, 6, 0, 43], [0, 0, 0, 43]);
	});

	test('Smart select of link title', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`a [text](https://example.com "a${CURSOR}title") b`
		));
		assertNestedRangesEqual(ranges![0], [0, 29, 0, 47], [0, 9, 0, 47], [0, 8, 0, 48], [0, 2, 0, 48], [0, 0, 0, 50]);
	});

	test('Smart select of link with title should have extra stop with just href', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`a [text](https${CURSOR}://example.com "atitle") b`
		));
		assertNestedRangesEqual(ranges![0], [0, 9, 0, 38], [0, 9, 0, 47], [0, 8, 0, 48], [0, 2, 0, 48], [0, 0, 0, 50]);
	});

	test('Smart select of angle bracket link should create stops within angle bracket', async () => {
		{
			const ranges = await getSelectionRangesForDocument(joinLines(
				`a [text](<file ${CURSOR}path>) b`
			));
			assertNestedRangesEqual(ranges![0], [0, 10, 0, 29], [0, 9, 0, 30], [0, 8, 0, 31], [0, 2, 0, 31], [0, 0, 0, 33]);
		}
		{
			// Cursor outside of angle brackets
			const ranges = await getSelectionRangesForDocument(joinLines(
				`a [text](<file path>) b`
			), [{ line: 0, character: 9 }]);
			assertNestedRangesEqual(ranges![0], [0, 9, 0, 20], [0, 8, 0, 21], [0, 2, 0, 21], [0, 0, 0, 23]);
		}
		{
			// With title
			const ranges = await getSelectionRangesForDocument(joinLines(
				`a [text](<file ${CURSOR}path> "title") b`
			));
			assertNestedRangesEqual(ranges![0], [0, 10, 0, 29], [0, 9, 0, 30], [0, 9, 0, 38], [0, 8, 0, 39], [0, 2, 0, 39], [0, 0, 0, 41]);
		}
	});

	test('Smart select italic', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`*some nice ${CURSOR}text*`
		));
		assertNestedRangesEqual(ranges![0], [0, 1, 0, 25], [0, 0, 0, 26]);
	});

	test('Smart select italic link', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`*[extens${CURSOR}ion](https://google.com)*`
		));
		assertNestedRangesEqual(ranges![0], [0, 2, 0, 21], [0, 1, 0, 42], [0, 0, 0, 43]);
	});

	test('Smart select italic on end', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`*word1 word2 word3${CURSOR}*`
		));
		assertNestedRangesEqual(ranges![0], [0, 1, 0, 28], [0, 0, 0, 29]);
	});

	test('Smart select italic then bold', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`outer text **bold words *italic ${CURSOR} words* bold words** outer text`
		));
		assertNestedRangesEqual(ranges![0], [0, 25, 0, 48], [0, 24, 0, 49], [0, 13, 0, 60], [0, 11, 0, 62], [0, 0, 0, 73]);
	});

	test('Smart select bold then italic', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`outer text *italic words **bold ${CURSOR} words** italic words* outer text`
		));
		assertNestedRangesEqual(ranges![0], [0, 27, 0, 48], [0, 25, 0, 50], [0, 12, 0, 63], [0, 11, 0, 64], [0, 0, 0, 75]);
	});

	test('Third level header from release notes', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`---`,
			`Order: 60`,
			`TOCTitle: October 2020`,
			`PageTitle: Visual Studio Code October 2020`,
			`MetaDescription: Learn what is new in the Visual Studio Code October 2020 Release (1.51)`,
			`MetaSocialImage: 1_51/release-highlights.png`,
			`Date: 2020-11-6`,
			`DownloadVersion: 1.51.1`,
			`---`,
			`# October 2020 (version 1.51)`,
			``,
			`**Update 1.51.1**: The update addresses these [issues](https://github.com/microsoft/vscode/issues?q=is%3Aissue+milestone%3A%22October+2020+Recovery%22+is%3Aclosed+).`,
			``,
			`<!-- DOWNLOAD_LINKS_PLACEHOLDER -->`,
			``,
			`---`,
			``,
			`Welcome to the October 2020 release of Visual Studio Code. As announced in the [October iteration plan](https://github.com/microsoft/vscode/issues/108473), we focused on housekeeping GitHub issues and pull requests as documented in our issue grooming guide.`,
			``,
			`We also worked with our partners at GitHub on GitHub Codespaces, which ended up being more involved than originally anticipated. To that end, we'll continue working on housekeeping for part of the November iteration.`,
			``,
			`During this housekeeping milestone, we also addressed several feature requests and community [pull requests](#thank-you). Read on to learn about new features and settings.`,
			``,
			`## Workbench`,
			``,
			`### More prominent pinned tabs`,
			``,
			`${CURSOR}Pinned tabs will now always show their pin icon, even while inactive, to make them easier to identify. If an editor is both pinned and contains unsaved changes, the icon reflects both states.`,
			``,
			`![Inactive pinned tabs showing pin icons](images/1_51/pinned-tabs.png)`
		)
		);
		assertNestedRangesEqual(ranges![0], [27, 0, 27, 201], [26, 0, 29, 70], [25, 0, 29, 70], [24, 0, 29, 70], [23, 0, 29, 70], [10, 0, 29, 70], [9, 0, 29, 70]);
	});

	test('Smart select of link definition in ref name', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`[a${CURSOR}]: http://example.com`
		));
		assertNestedRangesEqual(ranges![0], [0, 1, 0, 12], [0, 0, 0, 33]);
	});

	test('Smart select of link definition in target', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`[a]: http${CURSOR}://example.com`
		));
		assertNestedRangesEqual(ranges![0], [0, 5, 0, 33], [0, 0, 0, 33]);
	});

	test('Smart select of autolinks ', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`a <http://${CURSOR}example.com> b`
		));
		assertNestedRangesEqual(ranges![0], [0, 3, 0, 31], [0, 2, 0, 32], [0, 0, 0, 34]);
	});

	test('Smart select for image link', async () => {
		{
			const ranges = await getSelectionRangesForDocument(joinLines(
				`[![alt](http://example.com)](http://example.com${CURSOR})`
			));
			assertNestedRangesEqual(ranges![0], [0, 29, 0, 57], [0, 28, 0, 58], [0, 0, 0, 58]);
		}
		{
			const ranges = await getSelectionRangesForDocument(joinLines(
				`[![alt](http://example.com/inner${CURSOR})](http://example.com/outer)`
			));
			assertNestedRangesEqual(ranges![0],
				[0, 8, 0, 42], // http://example.com/inner
				[0, 7, 0, 43], // (http://example.com/inner)
				[0, 1, 0, 43], // ![alt](http://example.com/inner)
				[0, 0, 0, 70], // Whole link
			);
		}
	});

	test('Smart select table cell then row', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`| a | b | c |`,
			`|---|---|---|`,
			`| 1 | 2${CURSOR} | 3 |`,
		));
		// Cell "| 2$$CURSOR$$ " is at chars 4-19, row is full line (0-23), table body same as row, then full table
		assertNestedRangesEqual(ranges![0],
			[2, 5, 2, 18], // cell content (between pipes)
			[2, 4, 2, 19], // cell containing "2" with cursor marker
			[2, 0, 2, 23], // entire row
			[0, 0, 2, 23], // entire table
		);
	});

	test('Smart select table cell in first column', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`| a | b | c |`,
			`|---|---|---|`,
			`| ${CURSOR}1 | 2 | 3 |`,
		));
		// Cell "| $$CURSOR$$1 " is at chars 0-15, row at 0-23, table at 0-13 on lines 0-2
		assertNestedRangesEqual(ranges![0],
			[2, 1, 2, 14], // cell content (between pipes)
			[2, 0, 2, 15], // first cell with cursor marker
			[2, 0, 2, 23], // entire row
			[0, 0, 2, 23], // entire table
		);
	});

	test('Smart select table cell in last column', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`| a | b | c |`,
			`|---|---|---|`,
			`| 1 | 2 | 3${CURSOR} |`,
		));
		// Cell "| 3$$CURSOR$$ |" is at chars 8-23, row is 0-23, then table
		assertNestedRangesEqual(ranges![0],
			[2, 9, 2, 22], // cell content (between pipes)
			[2, 8, 2, 23], // last cell with cursor marker
			[2, 0, 2, 23], // entire row
			[0, 0, 2, 23], // entire table
		);
	});

	test('Smart select table header cell', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`| a${CURSOR} | b | c |`,
			`|---|---|---|`,
			`| 1 | 2 | 3 |`,
		));
		// First cell in header: "| a$$CURSOR$$ " at 0-15, header row at 0-23, then table
		assertNestedRangesEqual(ranges![0],
			[0, 1, 0, 14], // cell content (between pipes)
			[0, 0, 0, 15], // first cell with cursor marker
			[0, 0, 0, 23], // header row
			[0, 0, 2, 13], // entire table
		);
	});

	test('Smart select table with multiple body rows', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`| a | b |`,
			`|---|---|`,
			`| 1 | 2 |`,
			`| 3 | 4${CURSOR} |`,
		));
		// Cell "| 4$$CURSOR$$ |" at chars 4-19, row at 0-19, body rows 2-3, table lines 0-3
		assertNestedRangesEqual(ranges![0],
			[3, 5, 3, 18], // cell content (between pipes)
			[3, 4, 3, 19], // cell with cursor marker
			[3, 0, 3, 19], // row
			[2, 0, 3, 19], // table body (lines 2-3)
			[0, 0, 3, 19], // entire table
		);
	});

	test('Smart select table row then body then entire table', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`# Header`,
			``,
			`| col1 | col2 |`,
			`|------|------|`,
			`| a    | b    |`,
			`| c${CURSOR}    | d    |`,
			`| e    | f    |`,
			``,
			`More text`,
		));
		// Cell at chars 0-18 (with cursor), row at 0-25, body rows 4-6, table lines 2-6
		assertNestedRangesEqual(ranges![0],
			[5, 1, 5, 17], // cell content (between pipes)
			[5, 0, 5, 18], // cell "| c$$CURSOR$$    "
			[5, 0, 5, 25], // row
			[4, 0, 6, 15], // table body
			[2, 0, 6, 15], // entire table
			[1, 0, 8, 9], // header content
			[0, 0, 8, 9], // entire header section
		);
	});

	test('Smart select indented table cell', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`- list item`,
			``,
			`    | a | b |`,
			`    |---|---|`,
			`    | 1${CURSOR} | 2 |`,
		));
		// Cell "| 1$$CURSOR$$ " at chars 4-19 (after 4-space indent), row at 4-23
		assertNestedRangesEqual(ranges![0],
			[4, 5, 4, 18], // cell content (between pipes)
			[4, 4, 4, 19], // cell with cursor marker (starting at pipe after indent)
			[4, 4, 4, 23], // entire row (starting after indent)
			[2, 0, 4, 23], // table block
			[0, 0, 4, 23], // list
		);
	});

	test('Smart select table cell with bold content', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`| a | **bold${CURSOR}** |`,
			`|---|---|`,
			`| 1 | 2 |`,
		));
		// Bold "**bold$$CURSOR$$**" within cell
		// Line: | a | **bold$$CURSOR$$** |
		// Positions: 0=|, 4=|, 5= , 6=*, 7=*, 8=b, ... $$CURSOR$$ is 10 chars
		// bold content (inside **): chars 8 to 22
		// bold with **: chars 6 to 24
		// cell: | **...** | at 4-26 (ends at closing pipe + 1)
		assertNestedRangesEqual(ranges![0],
			[0, 8, 0, 22], // bold content (inside **)
			[0, 6, 0, 24], // bold with **
			[0, 5, 0, 25], // cell content (between pipes)
			[0, 4, 0, 26], // cell
			[0, 0, 0, 26], // header row
			[0, 0, 2, 9], // entire table
		);
	});

	test('Smart select table cell with inline code', async () => {
		const ranges = await getSelectionRangesForDocument(joinLines(
			`| a | \`code${CURSOR}\` |`,
			`|---|---|`,
			`| 1 | 2 |`,
		));
		// Inline code "`code$$CURSOR$$`" within cell
		// Line: | a | `code$$CURSOR$$` |
		// Positions: 0=|, 4=|, 5= , 6=`, 7=c, ... $$CURSOR$$ is 10 chars
		// code content (inside `): chars 7 to 21
		// code with backticks: chars 6 to 22
		// cell at 4-24 (ends at closing pipe + 1)
		assertNestedRangesEqual(ranges![0],
			[0, 7, 0, 21], // code content (inside backticks)
			[0, 6, 0, 22], // code with backticks
			[0, 5, 0, 23], // cell content (between pipes)
			[0, 4, 0, 24], // cell
			[0, 0, 0, 24], // header row
			[0, 0, 2, 9], // entire table
		);
	});
});


function assertNestedLineNumbersEqual(range: lsp.SelectionRange, ...expectedRanges: [number, number][]) {
	const lineage = getLineage(range);
	assert.strictEqual(lineage.length, expectedRanges.length, `expected length: ${expectedRanges.length}, but was length: ${lineage.length}. Values: ${getValues(lineage)}`);
	for (let i = 0; i < lineage.length; i++) {
		assertLineNumbersEqual(lineage[i], expectedRanges[i][0], expectedRanges[i][1], `parent at a depth of ${i}. Expected: ${expectedRanges[i][0]} but was ${lineage[i].range.start.line}`);
	}
}

function assertNestedRangesEqual(range: lsp.SelectionRange, ...expectedRanges: [number, number, number, number][]) {
	const lineage = getLineage(range);
	assert.strictEqual(lineage.length, expectedRanges.length, `expected depth: ${expectedRanges.length}, but was length: ${lineage.length}. Values: ${getValues(lineage)}`);
	for (let i = 0; i < lineage.length; i++) {
		assertLineNumbersEqual(lineage[i], expectedRanges[i][0], expectedRanges[i][2], `parent at a depth of ${i}. Expected: ${expectedRanges[i][0]} but was ${lineage[i].range.start.line}`);
		assert.ok(lineage[i].range.start.character === expectedRanges[i][1], `parent at a depth of ${i} on start char. Expected: ${expectedRanges[i][1]} but was ${lineage[i].range.start.character}`);
		assert.ok(lineage[i].range.end.character === expectedRanges[i][3], `parent at a depth of ${i} on end char. Expected: ${expectedRanges[i][3]} but was ${lineage[i].range.end.character}`);
	}
}

function getLineage(range: lsp.SelectionRange): lsp.SelectionRange[] {
	const result: lsp.SelectionRange[] = [];
	let currentRange: lsp.SelectionRange | undefined = range;
	while (currentRange) {
		result.push(currentRange);
		currentRange = currentRange.parent;
	}
	return result;
}

function getValues(ranges: lsp.SelectionRange[]): string {
	return ranges
		.map(range => {
			return `(${range.range.start.line}, ${range.range.start.character})-(${range.range.end.line}, ${range.range.end.character})`;
		})
		.join(' -> ');
}

function assertLineNumbersEqual(selectionRange: lsp.SelectionRange, startLine: number, endLine: number, message: string) {
	assert.strictEqual(selectionRange.range.start.line, startLine, `failed on start line ${message}`);
	assert.strictEqual(selectionRange.range.end.line, endLine, `failed on end line ${message}`);
}

function getSelectionRangesForDocument(contents: string, pos?: lsp.Position[]): Promise<lsp.SelectionRange[] | undefined> {
	const config = getLsConfiguration({});

	const doc = new InMemoryDocument(testFileName, contents);
	const workspace = new InMemoryWorkspace([doc]);
	const engine = createNewMarkdownEngine();
	const tocProvider = new MdTableOfContentsProvider(engine, workspace, nulLogger);
	const linkProvider = new MdLinkProvider(config, engine, workspace, tocProvider, nulLogger);

	const provider = new MdSelectionRangeProvider(engine, tocProvider, linkProvider, nulLogger);
	const positions = pos ? pos : getCursorPositions(contents, doc);
	return provider.provideSelectionRanges(doc, positions, new lsp.CancellationTokenSource().token);
}
