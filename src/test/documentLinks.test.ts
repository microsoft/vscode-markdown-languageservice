/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as lsp from 'vscode-languageserver-types';
import { URI } from 'vscode-uri';
import { getLsConfiguration } from '../config';
import { InternalHref, MdLink, MdLinkComputer, MdLinkProvider } from '../languageFeatures/documentLinks';
import { MdTableOfContentsProvider } from '../tableOfContents';
import { makeRange } from '../types/range';
import { noopToken } from '../util/cancellation';
import { ContainingDocumentContext, IWorkspace } from '../workspace';
import { createNewMarkdownEngine } from './engine';
import { InMemoryDocument } from './inMemoryDocument';
import { InMemoryWorkspace } from './inMemoryWorkspace';
import { nulLogger } from './nulLogging';
import { assertRangeEqual, joinLines, workspacePath } from './util';


suite('Link computer', () => {

	function getLinksForText(fileContents: string): Promise<MdLink[]> {
		const doc = new InMemoryDocument(workspacePath('test.md'), fileContents);
		const workspace = new InMemoryWorkspace([doc]);
		return getLinks(doc, workspace);
	}

	function getLinks(doc: InMemoryDocument, workspace: IWorkspace): Promise<MdLink[]> {
		const engine = createNewMarkdownEngine();
		const linkProvider = new MdLinkComputer(engine, workspace);
		return linkProvider.getAllLinks(doc, noopToken);
	}

	function assertLinksEqual(actualLinks: readonly MdLink[], expected: ReadonlyArray<lsp.Range | { readonly range: lsp.Range; readonly sourceText: string }>) {
		assert.strictEqual(actualLinks.length, expected.length, 'Link counts should match');

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
		const links = await getLinksForText('');
		assertLinksEqual(links, []);
	});

	test('Should not return anything for simple document without links', async () => {
		const links = await getLinksForText(joinLines(
			'# a',
			'fdasfdfsafsa',
		));
		assertLinksEqual(links, []);
	});

	test('Should detect basic http links', async () => {
		const links = await getLinksForText('a [b](https://example.com) c');
		assertLinksEqual(links, [
			makeRange(0, 6, 0, 25)
		]);
	});

	test('Should detect basic workspace links', async () => {
		{
			const links = await getLinksForText('a [b](./file) c');
			assertLinksEqual(links, [
				makeRange(0, 6, 0, 12)
			]);
		}
		{
			const links = await getLinksForText('a [b](file.png) c');
			assertLinksEqual(links, [
				makeRange(0, 6, 0, 14)
			]);
		}
	});

	test('Should detect links with title', async () => {
		const links = await getLinksForText('a [b](https://example.com "abc") c');
		assertLinksEqual(links, [
			makeRange(0, 6, 0, 25)
		]);
	});

	test('Should handle links with escaped characters in name (#35245)', async () => {
		const links = await getLinksForText('a [b\\]](./file)');
		assertLinksEqual(links, [
			makeRange(0, 8, 0, 14)
		]);
	});

	test('Should handle links with balanced parens', async () => {
		{
			const links = await getLinksForText('a [b](https://example.com/a()c) c');
			assertLinksEqual(links, [
				makeRange(0, 6, 0, 30)
			]);
		}
		{
			const links = await getLinksForText('a [b](https://example.com/a(b)c) c');
			assertLinksEqual(links, [
				makeRange(0, 6, 0, 31)
			]);
		}
		{
			// #49011
			const links = await getLinksForText('[A link](http://ThisUrlhasParens/A_link(in_parens))');
			assertLinksEqual(links, [
				makeRange(0, 9, 0, 50)
			]);
		}
	});

	test('Should ignore bracketed text inside link title (#150921)', async () => {
		{
			const links = await getLinksForText('[some [inner] in title](link)');
			assertLinksEqual(links, [
				makeRange(0, 24, 0, 28),
			]);
		}
		{
			const links = await getLinksForText('[some [inner] in title](<link>)');
			assertLinksEqual(links, [
				makeRange(0, 25, 0, 29),
			]);
		}
		{
			const links = await getLinksForText('[some [inner with space] in title](link)');
			assertLinksEqual(links, [
				makeRange(0, 35, 0, 39),
			]);
		}
		{
			const links = await getLinksForText(joinLines(
				`# h`,
				`[[a]](http://example.com)`,
			));
			assertLinksEqual(links, [
				makeRange(1, 6, 1, 24),
			]);
		}
	});

	test('Should handle two links without space', async () => {
		const links = await getLinksForText('a ([test](test)[test2](test2)) c');
		assertLinksEqual(links, [
			makeRange(0, 10, 0, 14),
			makeRange(0, 23, 0, 28)
		]);
	});

	test('should handle hyperlinked images (#49238)', async () => {
		{
			const links = await getLinksForText('[![alt text](image.jpg)](https://example.com)');
			assertLinksEqual(links, [
				makeRange(0, 25, 0, 44),
				makeRange(0, 13, 0, 22),
			]);
		}
		{
			const links = await getLinksForText('[![a]( whitespace.jpg )]( https://whitespace.com )');
			assertLinksEqual(links, [
				makeRange(0, 26, 0, 48),
				makeRange(0, 7, 0, 21),
			]);
		}
		{
			const links = await getLinksForText('[![a](img1.jpg)](file1.txt) text [![a](img2.jpg)](file2.txt)');
			assertLinksEqual(links, [
				makeRange(0, 17, 0, 26),
				makeRange(0, 6, 0, 14),
				makeRange(0, 50, 0, 59),
				makeRange(0, 39, 0, 47),
			]);
		}
	});

	test('Should not find empty reference link', async () => {
		{
			const links = await getLinksForText('[][]');
			assertLinksEqual(links, []);
		}
		{
			const links = await getLinksForText('[][cat]');
			assertLinksEqual(links, []);
		}
	});

	test('Should find image reference links', async () => {
		const links = await getLinksForText('![][cat]');
		assertLinksEqual(links, [
			makeRange(0, 4, 0, 7),
		]);
	});

	test('Should not consider link references starting with ^ character valid (#107471)', async () => {
		const links = await getLinksForText('[^reference]: https://example.com');
		assertLinksEqual(links, []);
	});

	test('Should find definitions links with spaces in angle brackets (#136073)', async () => {
		const links = await getLinksForText(joinLines(
			'[a]: <b c>',
			'[b]: <cd>',
		));

		assertLinksEqual(links, [
			{ range: makeRange(0, 6, 0, 9), sourceText: 'b c' },
			{ range: makeRange(1, 6, 1, 8), sourceText: 'cd' },
		]);
	});

	test('Should only find one link for definition (#141285)', async () => {
		const links = await getLinksForText(joinLines(
			'[Works]: https://example.com',
		));

		assertLinksEqual(links, [
			{ range: makeRange(0, 9, 0, 28), sourceText: 'https://example.com' },
		]);
	});

	test('Should find link with space in definition name', async () => {
		const links = await getLinksForText(joinLines(
			'[my ref]: https://example.com',
		));

		assertLinksEqual(links, [
			{ range: makeRange(0, 10, 0, 29), sourceText: 'https://example.com' },
		]);
	});

	test('Should find reference link shorthand (#141285)', async () => {
		const links = await getLinksForText(joinLines(
			'[ref]',
			'[ref]: https://example.com',
		));
		assertLinksEqual(links, [
			{ range: makeRange(0, 1, 0, 4), sourceText: 'ref' },
			{ range: makeRange(1, 7, 1, 26), sourceText: 'https://example.com' },
		]);
	});

	test('Should find reference link with space in reference name', async () => {
		const links = await getLinksForText(joinLines(
			'[text][my ref]',
		));
		assertLinksEqual(links, [
			makeRange(0, 7, 0, 13),
		]);
	});

	test('Should find reference link shorthand using empty closing brackets (#141285)', async () => {
		const links = await getLinksForText(joinLines(
			'[ref][]',
		));
		assertLinksEqual(links, [
			makeRange(0, 1, 0, 4),
		]);
	});

	test('Should find reference link shorthand using space in reference name', async () => {
		const links = await getLinksForText(joinLines(
			'[my ref][]',
		));
		assertLinksEqual(links, [
			makeRange(0, 1, 0, 7),
		]);
	});

	test('Should find reference link shorthand for link with space in label (#141285)', async () => {
		const links = await getLinksForText(joinLines(
			'[ref with space]',
		));
		assertLinksEqual(links, [
			makeRange(0, 1, 0, 15),
		]);
	});

	test('Should not include reference links with escaped leading brackets', async () => {
		const links = await getLinksForText(joinLines(
			`\\[bad link][good]`,
			`\\[good]`,
			`[good]: http://example.com`,
		));
		assertLinksEqual(links, [
			makeRange(2, 8, 2, 26) // Should only find the definition
		]);
	});

	test('Should not consider links in code fenced with backticks', async () => {
		const links = await getLinksForText(joinLines(
			'```',
			'[b](https://example.com)',
			'```'));
		assertLinksEqual(links, []);
	});

	test('Should not consider links in code fenced with tilde', async () => {
		const links = await getLinksForText(joinLines(
			'~~~',
			'[b](https://example.com)',
			'~~~'));
		assertLinksEqual(links, []);
	});

	test('Should not consider links in indented code', async () => {
		const links = await getLinksForText('    [b](https://example.com)');
		assertLinksEqual(links, []);
	});

	test('Should not consider links in inline code span', async () => {
		const links = await getLinksForText('`[b](https://example.com)`');
		assertLinksEqual(links, []);
	});

	test('Should not consider links with code span inside', async () => {
		const links = await getLinksForText('[li`nk](https://example.com`)');
		assertLinksEqual(links, []);
	});

	test('Should not consider links in multiline inline code span', async () => {
		const links = await getLinksForText(joinLines(
			'`` ',
			'[b](https://example.com)',
			'``'));
		assertLinksEqual(links, []);
	});

	test('Should not consider link references in code fenced with backticks (#146714)', async () => {
		const links = await getLinksForText(joinLines(
			'```',
			'[a] [bb]',
			'```'));
		assertLinksEqual(links, []);
	});

	test('Should not consider reference sources in code fenced with backticks (#146714)', async () => {
		const links = await getLinksForText(joinLines(
			'```',
			'[a]: http://example.com;',
			'[b]: <http://example.com>;',
			'[c]: (http://example.com);',
			'```'));
		assertLinksEqual(links, []);
	});

	test('Should not consider links in multiline inline code span between between text', async () => {
		const links = await getLinksForText(joinLines(
			'[b](https://1.com) `[b](https://2.com)',
			'[b](https://3.com) ` [b](https://4.com)'));

		assertLinksEqual(links, [
			makeRange(0, 4, 0, 17),
			makeRange(1, 25, 1, 38),
		]);
	});

	test('Should not consider links in multiline inline code span with new line after the first backtick', async () => {
		const links = await getLinksForText(joinLines(
			'`',
			'[b](https://example.com)`'));
		assertLinksEqual(links, []);
	});

	test('Should not miss links in invalid multiline inline code span', async () => {
		const links = await getLinksForText(joinLines(
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
		const links = await getLinksForText('pre <http://example.com> post');
		assertLinksEqual(links, [
			makeRange(0, 5, 0, 23)
		]);
	});

	test('Should not detect links inside html comment blocks', async () => {
		const links = await getLinksForText(joinLines(
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
		const links = await getLinksForText(joinLines(
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
		const links = await getLinksForText(joinLines(
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
		const links = await getLinksForText(joinLines(
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
		const links = await getLinksForText(joinLines(
			`[link](<path>)`
		));
		assertLinksEqual(links, [makeRange(0, 8, 0, 12)]);
	});

	test('Should find link within angle brackets even with link title.', async () => {
		const links = await getLinksForText(joinLines(
			`[link](<path> "test title")`
		));
		assertLinksEqual(links, [makeRange(0, 8, 0, 12)]);
	});

	test('Should find link within angle brackets even with surrounding spaces.', async () => {
		const links = await getLinksForText(joinLines(
			`[link]( <path> )`
		));
		assertLinksEqual(links, [makeRange(0, 9, 0, 13)]);
	});

	test('Should find link within angle brackets for image hyperlinks.', async () => {
		const links = await getLinksForText(joinLines(
			`![link](<path>)`
		));
		assertLinksEqual(links, [makeRange(0, 9, 0, 13)]);
	});

	test('Should find link with spaces in angle brackets for image hyperlinks with titles.', async () => {
		const links = await getLinksForText(joinLines(
			`![link](< path > "test")`
		));
		assertLinksEqual(links, [makeRange(0, 9, 0, 15)]);
	});


	test('Should not find link due to incorrect angle bracket notation or usage.', async () => {
		const links = await getLinksForText(joinLines(
			`[link](<path )`,
			`[link](<> path>)`,
			`[link](> path)`,
		));
		assertLinksEqual(links, []);
	});

	test('Should find link within angle brackets even with space inside link.', async () => {
		const links = await getLinksForText(joinLines(
			`[link](<pa th>)`
		));

		assertLinksEqual(links, [makeRange(0, 8, 0, 13)]);
	});

	test('Should find links with titles', async () => {
		const links = await getLinksForText(joinLines(
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
		const links = await getLinksForText(joinLines(
			`[](<>)`,
			`[link](<>)`,
			`[link](<> "text")`,
			`[link](<> 'text')`,
			`[link](<> (text))`,
		));
		assertLinksEqual(links, []);
	});

	test('Should return uri of inner document', async () => {
		const subScheme = 'sub-doc';
		const parentUri = workspacePath('test.md');
		const docUri = parentUri.with({
			scheme: subScheme,
			fragment: 'abc',
		});

		const doc = new InMemoryDocument(docUri, joinLines(
			`# Header`,
			`[abc](#header)`,
		));

		const workspace = new class extends InMemoryWorkspace {
			constructor() {
				super([doc]);
			}

			getContainingDocument(resource: URI): ContainingDocumentContext | undefined {
				if (resource.scheme === 'sub-doc') {
					return {
						uri: resource.with({ scheme: parentUri.scheme }),
						children: [],
					};
				}
				return undefined;
			}
		};

		const links = await getLinks(doc, workspace);
		assert.strictEqual(links.length, 1);

		const link = links[0];
		assert.strictEqual((link.href as InternalHref).path.toString(), docUri.toString());
	});

	test(`Should allow links to end with ':' if they are not link defs (https://github.com/microsoft/vscode/issues/162691)`, async () => {
		const links = await getLinksForText(joinLines(
			`- [@just-web/contributions]: abc`,
			`- [@just-web/contributions]:`,
			`- [@just-web/contributions][]:`,
			`- [@just-web/contributions][ref]:`,
		));

		assertLinksEqual(links, [
			makeRange(0, 3, 0, 26),
			makeRange(1, 3, 1, 26),
			makeRange(2, 3, 2, 26),
			makeRange(3, 28, 3, 31),
		]);
	});

	test(`Should handle reference links with backticks`, async () => {
		const links = await getLinksForText(joinLines(
			'[`github`][github]',
			``,
			`[github]: https://github.com`,
		));

		assertLinksEqual(links, [
			makeRange(0, 11, 0, 17),
			makeRange(2, 10, 2, 28),
		]);
	});

	test('Should find reference links to images', async () => {
		const links = await getLinksForText(joinLines(
			`[![alt](img)][def]`,
			``,
			`[def]: http://example.com`,
		));

		assertLinksEqual(links, [
			makeRange(0, 8, 0, 11),
			makeRange(0, 14, 0, 17),
			makeRange(2, 7, 2, 25),
		]);
	});

	test('Should find links to images references', async () => {
		const links = await getLinksForText(joinLines(
			`[![alt][def]](img)`,
			``,
			`[def]: http://example.com`,
		));

		assertLinksEqual(links, [
			makeRange(0, 14, 0, 17),
			makeRange(0, 8, 0, 11),
			makeRange(2, 7, 2, 25),
		]);
	});

	test('Should find reference links to image references', async () => {
		const links = await getLinksForText(joinLines(
			`[![alt][img]][def]`,
			``,
			`[def]: http://example.com`,
		));

		assertLinksEqual(links, [
			makeRange(0, 8, 0, 11),
			makeRange(0, 14, 0, 17),
			makeRange(2, 7, 2, 25),
		]);
	});
});


suite('Link provider', () => {

	const testFile = workspacePath('x.md');

	function getLinksForFile(fileContents: string) {
		const doc = new InMemoryDocument(testFile, fileContents);
		const workspace = new InMemoryWorkspace([doc]);

		const engine = createNewMarkdownEngine();
		const tocProvider = new MdTableOfContentsProvider(engine, workspace, nulLogger);
		const provider = new MdLinkProvider(getLsConfiguration({}), engine, workspace, tocProvider, nulLogger);
		return provider.provideDocumentLinks(doc, noopToken);
	}

	function assertLinksEqual(actualLinks: readonly lsp.DocumentLink[], expectedRanges: readonly lsp.Range[]) {
		assert.strictEqual(actualLinks.length, expectedRanges.length);

		for (let i = 0; i < actualLinks.length; ++i) {
			assertRangeEqual(actualLinks[i].range, expectedRanges[i], `Range ${ i } to be equal`);
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

	test('Should find reference links case insensitively', async () => {
		const links = await getLinksForFile(joinLines(
			'[ref]',
			'[rEf][]',
			'[ref][ReF]',
			'',
			'[REF]: http://example.com'
		));
		assertLinksEqual(links, [
			makeRange(0, 1, 0, 4),
			makeRange(1, 1, 1, 4),
			makeRange(2, 6, 2, 9),
			makeRange(4, 7, 4, 25),
		]);
	});

	test('Should use first link reference found in document', async () => {
		const links = await getLinksForFile(joinLines(
			`[abc]`,
			``,
			`[abc]: http://example.com/1`,
			`[abc]: http://example.com/2`,
		));

		assertLinksEqual(links, [
			makeRange(0, 1, 0, 4),
			makeRange(2, 7, 2, 27),
			makeRange(3, 7, 3, 27),
		]);

		assert.strictEqual(links[0].target, testFile.with({ fragment: 'L3,8' }).toString(true));
	});

	test('Should not encode link', async () => {
		const exampleUrl = 'http://example/%A5%C8';
		const links = await getLinksForFile(joinLines(
			`[link](${exampleUrl})`
		));
		assert.strictEqual(links[0].target, exampleUrl);
	});
});
