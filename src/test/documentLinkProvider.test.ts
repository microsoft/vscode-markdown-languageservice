/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import 'mocha';
import { MdLink, MdLinkComputer, MdLinkProvider } from '../languageFeatures/documentLinks';
import { noopToken } from '../util/cancellation';
import { createNewMarkdownEngine } from './engine';
import { nulLogger } from './nulLogging';
import { assertRangeEqual, joinLines, workspacePath } from './util';
import * as lsp from 'vscode-languageserver-types';
import { makeRange } from '../types/range';
import { InMemoryDocument } from '../inMemoryDocument';
import { InMemoryWorkspace } from './inMemoryWorkspace';
import { MdTableOfContentsProvider } from '../tableOfContents';


suite('Markdown: MdLinkComputer', () => {

	function getLinksForFile(fileContents: string): Promise<MdLink[]> {
		const doc = new InMemoryDocument(workspacePath('x.md'), fileContents);
		const workspace = new InMemoryWorkspace([doc]);
		const engine = createNewMarkdownEngine();
		const linkProvider = new MdLinkComputer(engine, workspace);
		return linkProvider.getAllLinks(doc, noopToken);
	}

	function assertLinksEqual(actualLinks: readonly MdLink[], expected: ReadonlyArray<lsp.Range | { readonly range: lsp.Range; readonly sourceText: string }>) {
		assert.strictEqual(actualLinks.length, expected.length);

		for (let i = 0; i < actualLinks.length; ++i) {
			const exp = expected[i];
			if ('range' in exp) {
				assertRangeEqual(actualLinks[i].source.hrefRange, exp.range, `Range ${i} to be equal`);
				assert.strictEqual(actualLinks[i].source.hrefText, exp.sourceText, `Source text ${i} to be equal`);
			} else {
				assertRangeEqual(actualLinks[i].source.hrefRange, exp, `Range ${i} to be equal`);
			}
		}
	}

	test('Should not return anything for empty document', async () => {
		const links = await getLinksForFile('');
		assertLinksEqual(links, []);
	});

	test('Should not return anything for simple document without links', async () => {
		const links = await getLinksForFile(joinLines(
			'# a',
			'fdasfdfsafsa',
		));
		assertLinksEqual(links, []);
	});

	test('Should detect basic http links', async () => {
		const links = await getLinksForFile('a [b](https://example.com) c');
		assertLinksEqual(links, [
			makeRange(0, 6, 0, 25)
		]);
	});

	test('Should detect basic workspace links', async () => {
		{
			const links = await getLinksForFile('a [b](./file) c');
			assertLinksEqual(links, [
				makeRange(0, 6, 0, 12)
			]);
		}
		{
			const links = await getLinksForFile('a [b](file.png) c');
			assertLinksEqual(links, [
				makeRange(0, 6, 0, 14)
			]);
		}
	});

	test('Should detect links with title', async () => {
		const links = await getLinksForFile('a [b](https://example.com "abc") c');
		assertLinksEqual(links, [
			makeRange(0, 6, 0, 25)
		]);
	});

	test('Should handle links with escaped characters in name (#35245)', async () => {
		const links = await getLinksForFile('a [b\\]](./file)');
		assertLinksEqual(links, [
			makeRange(0, 8, 0, 14)
		]);
	});

	test('Should handle links with balanced parens', async () => {
		{
			const links = await getLinksForFile('a [b](https://example.com/a()c) c');
			assertLinksEqual(links, [
				makeRange(0, 6, 0, 30)
			]);
		}
		{
			const links = await getLinksForFile('a [b](https://example.com/a(b)c) c');
			assertLinksEqual(links, [
				makeRange(0, 6, 0, 31)
			]);
		}
		{
			// #49011
			const links = await getLinksForFile('[A link](http://ThisUrlhasParens/A_link(in_parens))');
			assertLinksEqual(links, [
				makeRange(0, 9, 0, 50)
			]);
		}
	});

	test('Should ignore bracketed text inside link title (#150921)', async () => {
		{
			const links = await getLinksForFile('[some [inner] in title](link)');
			assertLinksEqual(links, [
				makeRange(0, 24, 0, 28),
			]);
		}
		{
			const links = await getLinksForFile('[some [inner] in title](<link>)');
			assertLinksEqual(links, [
				makeRange(0, 25, 0, 29),
			]);
		}
		{
			const links = await getLinksForFile('[some [inner with space] in title](link)');
			assertLinksEqual(links, [
				makeRange(0, 35, 0, 39),
			]);
		}
		{
			const links = await getLinksForFile(joinLines(
				`# h`,
				`[[a]](http://example.com)`,
			));
			assertLinksEqual(links, [
				makeRange(1, 6, 1, 24),
			]);
		}
	});

	test('Should handle two links without space', async () => {
		const links = await getLinksForFile('a ([test](test)[test2](test2)) c');
		assertLinksEqual(links, [
			makeRange(0, 10, 0, 14),
			makeRange(0, 23, 0, 28)
		]);
	});

	test('should handle hyperlinked images (#49238)', async () => {
		{
			const links = await getLinksForFile('[![alt text](image.jpg)](https://example.com)');
			assertLinksEqual(links, [
				makeRange(0, 25, 0, 44),
				makeRange(0, 13, 0, 22),
			]);
		}
		{
			const links = await getLinksForFile('[![a]( whitespace.jpg )]( https://whitespace.com )');
			assertLinksEqual(links, [
				makeRange(0, 26, 0, 48),
				makeRange(0, 7, 0, 21),
			]);
		}
		{
			const links = await getLinksForFile('[![a](img1.jpg)](file1.txt) text [![a](img2.jpg)](file2.txt)');
			assertLinksEqual(links, [
				makeRange(0, 17, 0, 26),
				makeRange(0, 6, 0, 14),
				makeRange(0, 50, 0, 59),
				makeRange(0, 39, 0, 47),
			]);
		}
	});

	test('Should not consider link references starting with ^ character valid (#107471)', async () => {
		const links = await getLinksForFile('[^reference]: https://example.com');
		assertLinksEqual(links, []);
	});

	test('Should find definitions links with spaces in angle brackets (#136073)', async () => {
		const links = await getLinksForFile(joinLines(
			'[a]: <b c>',
			'[b]: <cd>',
		));

		assertLinksEqual(links, [
			{ range: makeRange(0, 6, 0, 9), sourceText: 'b c' },
			{ range: makeRange(1, 6, 1, 8), sourceText: 'cd' },
		]);
	});

	test('Should only find one link for reference sources [a]: source (#141285)', async () => {
		const links = await getLinksForFile(joinLines(
			'[Works]: https://example.com',
		));

		assertLinksEqual(links, [
			{ range: makeRange(0, 9, 0, 28), sourceText: 'https://example.com' },
		]);
	});

	test('Should find reference link shorthand (#141285)', async () => {
		const links = await getLinksForFile(joinLines(
			'[ref]',
			'[ref]: https://example.com',
		));
		assertLinksEqual(links, [
			{ range: makeRange(0, 1, 0, 4), sourceText: 'ref' },
			{ range: makeRange(1, 7, 1, 26), sourceText: 'https://example.com' },
		]);
	});

	test('Should find reference link shorthand using empty closing brackets (#141285)', async () => {
		const links = await getLinksForFile(joinLines(
			'[ref][]',
		));
		assertLinksEqual(links, [
			makeRange(0, 1, 0, 4),
		]);
	});

	test.skip('Should find reference link shorthand for link with space in label (#141285)', async () => {
		const links = await getLinksForFile(joinLines(
			'[ref with space]',
		));
		assertLinksEqual(links, [
			makeRange(0, 7, 0, 26),
		]);
	});

	test('Should not include reference links with escaped leading brackets', async () => {
		const links = await getLinksForFile(joinLines(
			`\\[bad link][good]`,
			`\\[good]`,
			`[good]: http://example.com`,
		));
		assertLinksEqual(links, [
			makeRange(2, 8, 2, 26) // Should only find the definition
		]);
	});

	test('Should not consider links in code fenced with backticks', async () => {
		const links = await getLinksForFile(joinLines(
			'```',
			'[b](https://example.com)',
			'```'));
		assertLinksEqual(links, []);
	});

	test('Should not consider links in code fenced with tilde', async () => {
		const links = await getLinksForFile(joinLines(
			'~~~',
			'[b](https://example.com)',
			'~~~'));
		assertLinksEqual(links, []);
	});

	test('Should not consider links in indented code', async () => {
		const links = await getLinksForFile('    [b](https://example.com)');
		assertLinksEqual(links, []);
	});

	test('Should not consider links in inline code span', async () => {
		const links = await getLinksForFile('`[b](https://example.com)`');
		assertLinksEqual(links, []);
	});

	test('Should not consider links with code span inside', async () => {
		const links = await getLinksForFile('[li`nk](https://example.com`)');
		assertLinksEqual(links, []);
	});

	test('Should not consider links in multiline inline code span', async () => {
		const links = await getLinksForFile(joinLines(
			'`` ',
			'[b](https://example.com)',
			'``'));
		assertLinksEqual(links, []);
	});

	test('Should not consider link references in code fenced with backticks (#146714)', async () => {
		const links = await getLinksForFile(joinLines(
			'```',
			'[a] [bb]',
			'```'));
		assertLinksEqual(links, []);
	});

	test('Should not consider reference sources in code fenced with backticks (#146714)', async () => {
		const links = await getLinksForFile(joinLines(
			'```',
			'[a]: http://example.com;',
			'[b]: <http://example.com>;',
			'[c]: (http://example.com);',
			'```'));
		assertLinksEqual(links, []);
	});

	test('Should not consider links in multiline inline code span between between text', async () => {
		const links = await getLinksForFile(joinLines(
			'[b](https://1.com) `[b](https://2.com)',
			'[b](https://3.com) ` [b](https://4.com)'));

		assertLinksEqual(links, [
			makeRange(0, 4, 0, 17),
			makeRange(1, 25, 1, 38),
		]);
	});

	test('Should not consider links in multiline inline code span with new line after the first backtick', async () => {
		const links = await getLinksForFile(joinLines(
			'`',
			'[b](https://example.com)`'));
		assertLinksEqual(links, []);
	});

	test('Should not miss links in invalid multiline inline code span', async () => {
		const links = await getLinksForFile(joinLines(
			'`` ',
			'',
			'[b](https://example.com)',
			'',
			'``'));
		assertLinksEqual(links, [
			makeRange(2, 4, 2, 23)
		]);
	});

	test('Should find autolinks', async () => {
		const links = await getLinksForFile('pre <http://example.com> post');
		assertLinksEqual(links, [
			makeRange(0, 5, 0, 23)
		]);
	});

	test('Should not detect links inside html comment blocks', async () => {
		const links = await getLinksForFile(joinLines(
			`<!-- <http://example.com> -->`,
			`<!-- [text](./foo.md) -->`,
			`<!-- [text]: ./foo.md -->`,
			``,
			`<!--`,
			`<http://example.com>`,
			`-->`,
			``,
			`<!--`,
			`[text](./foo.md)`,
			`-->`,
			``,
			`<!--`,
			`[text]: ./foo.md`,
			`-->`,
		));
		assertLinksEqual(links, []);
	});

	test.skip('Should not detect links inside inline html comments', async () => {
		// See #149678
		const links = await getLinksForFile(joinLines(
			`text <!-- <http://example.com> --> text`,
			`text <!-- [text](./foo.md) --> text`,
			`text <!-- [text]: ./foo.md --> text`,
			``,
			`text <!--`,
			`<http://example.com>`,
			`--> text`,
			``,
			`text <!--`,
			`[text](./foo.md)`,
			`--> text`,
			``,
			`text <!--`,
			`[text]: ./foo.md`,
			`--> text`,
		));
		assertLinksEqual(links, []);
	});

	test('Should not mark checkboxes as links', async () => {
		const links = await getLinksForFile(joinLines(
			'- [x]',
			'- [X]',
			'- [ ]',
			'* [x]',
			'* [X]',
			'* [ ]',
			``,
			`[x]: http://example.com`
		));
		assertLinksEqual(links, [
			makeRange(7, 5, 7, 23)
		]);
	});

	test('Should still find links on line with checkbox', async () => {
		const links = await getLinksForFile(joinLines(
			'- [x] [x]',
			'- [X] [x]',
			'- [] [x]',
			``,
			`[x]: http://example.com`
		));

		assertLinksEqual(links, [
			makeRange(0, 7, 0, 8),
			makeRange(1, 7, 1, 8),
			makeRange(2, 6, 2, 7),
			makeRange(4, 5, 4, 23),
		]);
	});

	test('Should find link only within angle brackets.', async () => {
		const links = await getLinksForFile(joinLines(
			`[link](<path>)`
		));
		assertLinksEqual(links, [makeRange(0, 8, 0, 12)]);
	});

	test('Should find link within angle brackets even with link title.', async () => {
		const links = await getLinksForFile(joinLines(
			`[link](<path> "test title")`
		));
		assertLinksEqual(links, [makeRange(0, 8, 0, 12)]);
	});

	test('Should find link within angle brackets even with surrounding spaces.', async () => {
		const links = await getLinksForFile(joinLines(
			`[link]( <path> )`
		));
		assertLinksEqual(links, [makeRange(0, 9, 0, 13)]);
	});

	test('Should find link within angle brackets for image hyperlinks.', async () => {
		const links = await getLinksForFile(joinLines(
			`![link](<path>)`
		));
		assertLinksEqual(links, [makeRange(0, 9, 0, 13)]);
	});

	test('Should find link with spaces in angle brackets for image hyperlinks with titles.', async () => {
		const links = await getLinksForFile(joinLines(
			`![link](< path > "test")`
		));
		assertLinksEqual(links, [makeRange(0, 9, 0, 15)]);
	});


	test('Should not find link due to incorrect angle bracket notation or usage.', async () => {
		const links = await getLinksForFile(joinLines(
			`[link](<path )`,
			`[link](<> path>)`,
			`[link](> path)`,
		));
		assertLinksEqual(links, []);
	});

	test('Should find link within angle brackets even with space inside link.', async () => {

		const links = await getLinksForFile(joinLines(
			`[link](<pa th>)`
		));

		assertLinksEqual(links, [makeRange(0, 8, 0, 13)]);
	});

	test('Should find links with titles', async () => {
		const links = await getLinksForFile(joinLines(
			`[link](<no such.md> "text")`,
			`[link](<no such.md> 'text')`,
			`[link](<no such.md> (text))`,
			`[link](no-such.md "text")`,
			`[link](no-such.md 'text')`,
			`[link](no-such.md (text))`,
		));
		assertLinksEqual(links, [
			makeRange(0, 8, 0, 18),
			makeRange(1, 8, 1, 18),
			makeRange(2, 8, 2, 18),
			makeRange(3, 7, 3, 17),
			makeRange(4, 7, 4, 17),
			makeRange(5, 7, 5, 17),
		]);
	});

	test('Should not include link with empty angle bracket', async () => {
		const links = await getLinksForFile(joinLines(
			`[](<>)`,
			`[link](<>)`,
			`[link](<> "text")`,
			`[link](<> 'text')`,
			`[link](<> (text))`,
		));
		assertLinksEqual(links, []);
	});
});


suite('Markdown: VS Code DocumentLinkProvider', () => {

	function getLinksForFile(fileContents: string) {
		const doc = new InMemoryDocument(workspacePath('x.md'), fileContents);
		const workspace = new InMemoryWorkspace([doc]);

		const engine = createNewMarkdownEngine();
		const tocProvider = new MdTableOfContentsProvider(engine, workspace, nulLogger);
		const provider = new MdLinkProvider(engine, workspace, tocProvider, nulLogger);
		return provider.provideDocumentLinks(doc, noopToken);
	}

	function assertLinksEqual(actualLinks: readonly lsp.DocumentLink[], expectedRanges: readonly lsp.Range[]) {
		assert.strictEqual(actualLinks.length, expectedRanges.length);

		for (let i = 0; i < actualLinks.length; ++i) {
			assertRangeEqual(actualLinks[i].range, expectedRanges[i], `Range ${i} to be equal`);
		}
	}

	test('Should include defined reference links (#141285)', async () => {
		const links = await getLinksForFile(joinLines(
			'[ref]',
			'[ref][]',
			'[ref][ref]',
			'',
			'[ref]: http://example.com'
		));
		assertLinksEqual(links, [
			makeRange(0, 1, 0, 4),
			makeRange(1, 1, 1, 4),
			makeRange(2, 6, 2, 9),
			makeRange(4, 7, 4, 25),
		]);
	});

	test('Should not include reference link shorthand when definition does not exist (#141285)', async () => {
		const links = await getLinksForFile('[ref]');
		assertLinksEqual(links, []);
	});
});
