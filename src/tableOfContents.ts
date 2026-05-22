/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as lsp from 'vscode-languageserver-protocol';
import { HTMLElement, parse as parseHtml } from 'node-html-parser';
import { URI } from 'vscode-uri';
import { ILogger, LogLevel } from './logging.js';
import { IMdParser, Token } from './parser.js';
import { ISlug, ISlugifier } from './slugify.js';
import { getDocUri, getLine, ITextDocument } from './types/textDocument.js';
import { Disposable } from './util/dispose.js';
import { NoLinkRanges } from './util/noLinkRanges.js';
import { ResourceMap } from './util/resourceMap.js';
import { IWorkspace } from './workspace.js';
import { MdDocumentInfoCache } from './workspaceCache.js';

export type TocEntry = TocHeaderEntry | TocHtmlIdEntry;

export interface TocHeaderEntry {
	readonly kind: 'header';

	readonly slug: ISlug;

	/**
	 * The display text of the entry.
	 */
	readonly text: string;

	readonly level: number;

	/**
	 * The range of the header declaration.
	 *
	 * For the doc:
	 *
	 * ```md
	 * # Head #
	 * text
	 * ```
	 *
	 * This is the range of `# Head #`
	 */
	readonly declarationLocation: lsp.Location;

	/**
	 * The range of the header text.
	 *
	 * For the doc:
	 *
	 * ```md
	 * # Head #
	 * text
	 * ```
	 *
	 * This is the range of `Head`
	 */
	readonly idDeclarationLocation: lsp.Location;

	/**
	 * The entire range of the header section.
	 *
	* For the doc:
	 *
	 * ```md
	 * # Head #
	 * text
	 * # Next head #
	 * ```
	 *
	 * This is the range from `# Head #` to `# Next head #`
	 */
	readonly sectionLocation: lsp.Location;
}

export interface TocHtmlIdEntry {
	readonly kind: 'html-id';

	readonly slug: ISlug;

	/**
	 * The raw id attribute value.
	 */
	readonly text: string;

	/**
	 * Location of the id attribute value in the document.
	 */
	readonly declarationLocation: lsp.Location;
}

export interface TocCreateOptions {
	readonly includeHtmlIds?: boolean;
}

export class TableOfContents {

	public static async create(parser: IMdParser, document: ITextDocument, token: lsp.CancellationToken, options?: TocCreateOptions): Promise<TableOfContents> {
		const tokens = await parser.tokenize(document);
		if (token.isCancellationRequested) {
			return new TableOfContents([], parser.slugifier);
		}

		const headerEntries = await this.#buildTocFromTokens(parser, document, tokens, token);
		if (token.isCancellationRequested) {
			return new TableOfContents([], parser.slugifier);
		}

		if (options?.includeHtmlIds) {
			const htmlIdEntries = this.#getHtmlIdEntries(parser, document, tokens);

			// Filter out html id entries that duplicate existing header slugs
			const headerSlugs = new Set(headerEntries.map(e => e.slug.value));
			const uniqueHtmlIds = htmlIdEntries.filter(e => !headerSlugs.has(e.slug.value));

			return new TableOfContents([...headerEntries, ...uniqueHtmlIds], parser.slugifier);
		}

		return new TableOfContents(headerEntries, parser.slugifier);
	}

	public static async createForContainingDoc(parser: IMdParser, workspace: IWorkspace, document: ITextDocument, token: lsp.CancellationToken, options?: TocCreateOptions): Promise<TableOfContents> {
		const context = workspace.getContainingDocument?.(getDocUri(document));
		if (context) {
			const entries = (await Promise.all(Array.from(context.children, async cell => {
				const doc = await workspace.openMarkdownDocument(cell.uri);
				if (!doc || token.isCancellationRequested) {
					return [];
				}
				return this.#buildToc(parser, doc, token, options);
			}))).flat();
			return new TableOfContents(entries, parser.slugifier);
		}

		return this.create(parser, document, token, options);
	}

	static async #buildToc(parser: IMdParser, document: ITextDocument, token: lsp.CancellationToken, options?: TocCreateOptions): Promise<TocEntry[]> {
		const tokens = await parser.tokenize(document);
		if (token.isCancellationRequested) {
			return [];
		}

		const headerEntries = await this.#buildTocFromTokens(parser, document, tokens, token);

		if (options?.includeHtmlIds) {
			const htmlIdEntries = this.#getHtmlIdEntries(parser, document, tokens);
			const headerSlugs = new Set(headerEntries.map(e => e.slug.value));
			const uniqueHtmlIds = htmlIdEntries.filter(e => !headerSlugs.has(e.slug.value));
			return [...headerEntries, ...uniqueHtmlIds];
		}

		return headerEntries;
	}

	static async #buildTocFromTokens(parser: IMdParser, document: ITextDocument, tokens: readonly Token[], _token: lsp.CancellationToken): Promise<TocEntry[]> {
		const docUri = getDocUri(document);

		const toc: TocHeaderEntry[] = [];
		const slugBuilder = parser.slugifier.createBuilder();

		type HeaderInfo = { open: Token; body: Token[] };

		const headers: HeaderInfo[] = [];
		let currentHeader: HeaderInfo | undefined;

		for (const token of tokens) {
			switch (token.type) {
				case 'heading_open': {
					currentHeader = { open: token, body: [] };
					headers.push(currentHeader);
					break;
				}
				case 'heading_close': {
					currentHeader = undefined;
					break;
				}
				default: {
					currentHeader?.body.push(token);
					break;
				}
			}
		}

		for (const { open, body } of headers) {
			if (!open.map) {
				continue;
			}

			const lineNumber = open.map[0];
			const line = getLine(document, lineNumber);
			const bodyText = TableOfContents.#getHeaderTitleAsPlainText(body);
			const slug = slugBuilder.add(bodyText);

			const headerLocation: lsp.Location = {
				uri: docUri.toString(),
				range: lsp.Range.create(lineNumber, 0, lineNumber, line.length)
			};

			const headerTextLocation: lsp.Location = {
				uri: docUri.toString(),
				range: lsp.Range.create(lineNumber, line.match(/^#+\s*/)?.[0].length ?? 0, lineNumber, line.length - (line.match(/\s*#*$/)?.[0].length ?? 0))
			};

			toc.push({
				kind: 'header',
				slug,
				text: bodyText.trim(),
				level: TableOfContents.#getHeaderLevel(open.markup),
				sectionLocation: headerLocation, // Populated in next steps
				declarationLocation: headerLocation,
				idDeclarationLocation: headerTextLocation
			});
		}

		// Get full range of section
		return toc.map((entry, startIndex): TocEntry => {
			if (entry.kind !== 'header') {
				return entry;
			};

			let end: number | undefined = undefined;
			for (let i = startIndex + 1; i < toc.length; ++i) {
				const targetToc = toc[i];
				if (targetToc.kind === 'header' && targetToc.level <= entry.level) {
					end = targetToc.declarationLocation.range.start.line - 1;
					break;
				}
			}
			const endLine = end ?? document.lineCount - 1;
			return {
				...entry,
				sectionLocation: {
					uri: docUri.toString(),
					range: lsp.Range.create(
						entry.sectionLocation.range.start,
						{ line: endLine, character: getLine(document, endLine).length })
				}
			};
		});
	}

	static #getHeaderLevel(markup: string): number {
		if (markup === '=') {
			return 1;
		} else if (markup === '-') {
			return 2;
		} else { // '#', '##', ...
			return markup.length;
		}
	}

	static #tokenToPlainText(token: Token): string {
		if (token.children) {
			return token.children.map(TableOfContents.#tokenToPlainText).join('');
		}

		switch (token.type) {
			case 'text':
			case 'emoji':
			case 'code_inline':
				return token.content;
			default:
				return '';
		}
	}

	static #getHeaderTitleAsPlainText(headerTitleParts: readonly Token[]): string {
		return headerTitleParts
			.map(TableOfContents.#tokenToPlainText)
			.join('')
			.trim();
	}

	static readonly #htmlIdAttrPattern = /\bid\s*=\s*["']/i;

	static #getHtmlIdEntries(parser: IMdParser, document: ITextDocument, tokens: readonly Token[]): TocHtmlIdEntry[] {
		const text = document.getText();
		if (!/<\w/.test(text)) {
			return [];
		}

		let tree: ReturnType<typeof parseHtml>;
		try {
			tree = parseHtml(text);
		} catch {
			return [];
		}

		const docUri = getDocUri(document);
		const noLinkRanges = NoLinkRanges.compute(tokens, document);

		const entries: TocHtmlIdEntry[] = [];
		const existingSlugs = new Set<string>();

		this.#collectHtmlIdEntries(tree, document, parser, docUri, noLinkRanges, existingSlugs, entries);

		return entries;
	}

	static #collectHtmlIdEntries(node: HTMLElement, document: ITextDocument, parser: IMdParser, docUri: URI, noLinkRanges: NoLinkRanges, existingSlugs: Set<string>, entries: TocHtmlIdEntry[]): void {
		const idValue = node.attributes?.['id'];
		if (idValue) {
			const attrMatch = node.outerHTML.match(this.#htmlIdAttrPattern);
			if (attrMatch) {
				const offset = node.range[0] + attrMatch.index! + attrMatch[0].length;
				const position = document.positionAt(offset);

				// Exclude code blocks and inline code, but allow html_block since ids inside HTML are valid
				if (!noLinkRanges.contains(position, 'html_block')) {
					const slug = parser.slugifier.fromFragment(idValue);
					if (!existingSlugs.has(slug.value)) {
						existingSlugs.add(slug.value);

						const endPosition = document.positionAt(offset + idValue.length);
						entries.push({
							kind: 'html-id',
							slug,
							text: idValue,
							declarationLocation: {
								uri: docUri.toString(),
								range: lsp.Range.create(position, endPosition),
							},
						});
					}
				}
			}
		}

		for (const child of node.childNodes) {
			if (child instanceof HTMLElement) {
				this.#collectHtmlIdEntries(child, document, parser, docUri, noLinkRanges, existingSlugs, entries);
			}
		}
	}

	readonly #slugifier: ISlugifier;

	private constructor(
		public readonly entries: readonly TocEntry[],
		slugifier: ISlugifier,
	) {
		this.#slugifier = slugifier;
	}

	public lookupByFragment(fragmentText: string): TocEntry | undefined {
		const slug = this.#slugifier.fromFragment(fragmentText);
		return this.entries.find(entry => entry.slug.equals(slug));
	}

	public lookupByHeading(text: string): TocEntry | undefined {
		const slug = this.#slugifier.fromHeading(text);
		return this.entries.find(entry => entry.slug.equals(slug));
	}

	public lookByLink(link: { readonly isAngleBracketLink: boolean; readonly fragment: string; }): TocEntry | undefined {
		return link.isAngleBracketLink ? this.lookupByHeading(link.fragment) : this.lookupByFragment(link.fragment);
	}
}

export class MdTableOfContentsProvider extends Disposable {

	readonly #cache: MdDocumentInfoCache<TableOfContents>;
	readonly #htmlIdResources = new ResourceMap<true>();

	readonly #parser: IMdParser;
	readonly #workspace: IWorkspace;
	readonly #logger: ILogger;

	constructor(
		parser: IMdParser,
		workspace: IWorkspace,
		logger: ILogger,
	) {
		super();

		this.#parser = parser;
		this.#workspace = workspace;
		this.#logger = logger;

		this.#cache = this._register(new MdDocumentInfoCache<TableOfContents>(workspace, (doc, token) => {
			const includeHtmlIds = this.#htmlIdResources.has(getDocUri(doc));
			this.#logger.log(LogLevel.Debug, 'TableOfContentsProvider.create', { document: doc.uri, version: doc.version, includeHtmlIds });
			return TableOfContents.create(parser, doc, token, { includeHtmlIds });
		}));
	}

	public get(resource: URI, options?: TocCreateOptions): Promise<TableOfContents | undefined> {
		if (options?.includeHtmlIds && !this.#htmlIdResources.has(resource)) {
			this.#htmlIdResources.set(resource, true);
			this.#cache.invalidate(resource);
		}
		return this.#cache.get(resource);
	}

	public getForDocument(doc: ITextDocument, options?: TocCreateOptions): Promise<TableOfContents> {
		const uri = getDocUri(doc);
		if (options?.includeHtmlIds && !this.#htmlIdResources.has(uri)) {
			this.#htmlIdResources.set(uri, true);
			this.#cache.invalidate(uri);
		}
		return this.#cache.getForDocument(doc);
	}

	public getForContainingDoc(doc: ITextDocument, token: lsp.CancellationToken, options?: TocCreateOptions): Promise<TableOfContents> {
		return TableOfContents.createForContainingDoc(this.#parser, this.#workspace, doc, token, options);
	}
}
