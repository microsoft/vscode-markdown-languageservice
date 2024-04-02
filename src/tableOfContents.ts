/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as lsp from 'vscode-languageserver-protocol';
import { URI } from 'vscode-uri';
import { ILogger, LogLevel } from './logging';
import { IMdParser, Token } from './parser';
import { ISlug, ISlugifier } from './slugify';
import { getDocUri, getLine, ITextDocument } from './types/textDocument';
import { Disposable } from './util/dispose';
import { IWorkspace } from './workspace';
import { MdDocumentInfoCache } from './workspaceCache';

export interface TocEntry {
	readonly slug: ISlug;
	readonly text: string;
	readonly level: number;
	readonly line: number;

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
	readonly headerLocation: lsp.Location;

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
	readonly headerTextLocation: lsp.Location;
}

export class TableOfContents {

	public static async create(parser: IMdParser, document: ITextDocument, token: lsp.CancellationToken): Promise<TableOfContents> {
		const entries = await this.#buildToc(parser, document, token);
		return new TableOfContents(entries, parser.slugifier);
	}

	public static async createForContainingDoc(parser: IMdParser, workspace: IWorkspace, document: ITextDocument, token: lsp.CancellationToken): Promise<TableOfContents> {
		const context = workspace.getContainingDocument?.(getDocUri(document));
		if (context) {
			const entries = (await Promise.all(Array.from(context.children, async cell => {
				const doc = await workspace.openMarkdownDocument(cell.uri);
				if (!doc || token.isCancellationRequested) {
					return [];
				}
				return this.#buildToc(parser, doc, token);
			}))).flat();
			return new TableOfContents(entries, parser.slugifier);
		}

		return this.create(parser, document, token);
	}

	static async #buildToc(parser: IMdParser, document: ITextDocument, token: lsp.CancellationToken): Promise<TocEntry[]> {
		const docUri = getDocUri(document);

		const toc: TocEntry[] = [];
		const tokens = await parser.tokenize(document);
		if (token.isCancellationRequested) {
			return [];
		}

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
				slug,
				text: line.replace(/^\s*#+\s*(.*?)(\s+#+)?$/, (_, word) => word.trim()),
				level: TableOfContents.#getHeaderLevel(open.markup),
				line: lineNumber,
				sectionLocation: headerLocation, // Populated in next steps
				headerLocation,
				headerTextLocation
			});
		}

		// Get full range of section
		return toc.map((entry, startIndex): TocEntry => {
			let end: number | undefined = undefined;
			for (let i = startIndex + 1; i < toc.length; ++i) {
				if (toc[i].level <= entry.level) {
					end = toc[i].line - 1;
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

	readonly #slugifier: ISlugifier;

	private constructor(
		public readonly entries: readonly TocEntry[],
		slugifier: ISlugifier,
	) {
		this.#slugifier = slugifier;
	}

	public lookup(fragment: string): TocEntry | undefined {
		const slug = this.#slugifier.fromHeading(fragment);
		return this.entries.find(entry => entry.slug.equals(slug));
	}
}


export class MdTableOfContentsProvider extends Disposable {

	readonly #cache: MdDocumentInfoCache<TableOfContents>;

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
			this.#logger.log(LogLevel.Debug, 'TableOfContentsProvider.create', { document: doc.uri, version: doc.version });
			return TableOfContents.create(parser, doc, token);
		}));
	}

	public get(resource: URI): Promise<TableOfContents | undefined> {
		return this.#cache.get(resource);
	}

	public getForDocument(doc: ITextDocument): Promise<TableOfContents> {
		return this.#cache.getForDocument(doc);
	}

	public getForContainingDoc(doc: ITextDocument, token: lsp.CancellationToken): Promise<TableOfContents> {
		return TableOfContents.createForContainingDoc(this.#parser, this.#workspace, doc, token);
	}
}
