/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as lsp from 'vscode-languageserver-protocol';
import { ILogger, LogLevel } from '../logging';
import { MdTableOfContentsProvider, TableOfContents, TocEntry } from '../tableOfContents';
import { isBefore } from '../types/position';
import { ITextDocument } from '../types/textDocument';
import { MdLinkDefinition, MdLinkKind, MdLinkProvider } from './documentLinks';

interface MarkdownSymbol {
	readonly level: number;
	readonly parent: MarkdownSymbol | undefined;
	readonly children: lsp.DocumentSymbol[];
	readonly range: lsp.Range;
}

export interface ProvideDocumentSymbolOptions {
	readonly includeLinkDefinitions?: boolean;
}

export class MdDocumentSymbolProvider {

	readonly #tocProvider: MdTableOfContentsProvider;
	readonly #linkProvider: MdLinkProvider;
	readonly #logger: ILogger;

	constructor(
		tocProvider: MdTableOfContentsProvider,
		linkProvider: MdLinkProvider,
		logger: ILogger,
	) {
		this.#tocProvider = tocProvider;
		this.#linkProvider = linkProvider;
		this.#logger = logger;
	}

	public async provideDocumentSymbols(document: ITextDocument, options: ProvideDocumentSymbolOptions, token: lsp.CancellationToken): Promise<lsp.DocumentSymbol[]> {
		this.#logger.log(LogLevel.Debug, 'DocumentSymbolProvider.provideDocumentSymbols', { document: document.uri, version: document.version });

		const linkSymbols = await (options.includeLinkDefinitions ? this.#provideLinkDefinitionSymbols(document, token) : []);
		if (token.isCancellationRequested) {
			return [];
		}

		const toc = await this.#tocProvider.getForDocument(document);
		if (token.isCancellationRequested) {
			return [];
		}

		return this.#toSymbolTree(document, linkSymbols, toc);
	}

	#toSymbolTree(document: ITextDocument, linkSymbols: readonly lsp.DocumentSymbol[], toc: TableOfContents): lsp.DocumentSymbol[] {
		const root: MarkdownSymbol = {
			level: -Infinity,
			children: [],
			parent: undefined,
			range: lsp.Range.create(0, 0, document.lineCount + 1, 0),
		};
		const additionalSymbols = [...linkSymbols];
		this.#buildTocSymbolTree(root, toc.entries, additionalSymbols);
		// Put remaining link definitions into top level document instead of last header
		root.children.push(...additionalSymbols);
		return root.children;
	}

	async #provideLinkDefinitionSymbols(document: ITextDocument, token: lsp.CancellationToken): Promise<lsp.DocumentSymbol[]> {
		const { links } = await this.#linkProvider.getLinks(document);
		if (token.isCancellationRequested) {
			return [];
		}

		return links
			.filter(link => link.kind === MdLinkKind.Definition)
			.map((link): lsp.DocumentSymbol => this.#definitionToDocumentSymbol(link as MdLinkDefinition));
	}

	#definitionToDocumentSymbol(def: MdLinkDefinition): lsp.DocumentSymbol {
		return {
			kind: lsp.SymbolKind.Constant,
			name: `[${def.ref.text}]`,
			selectionRange: def.ref.range,
			range: def.source.range,
		};
	}

	#buildTocSymbolTree(parent: MarkdownSymbol, entries: readonly TocEntry[], additionalSymbols: lsp.DocumentSymbol[]): void {
		if (entries.length) {
			while (additionalSymbols.length && isBefore(additionalSymbols[0].range.end, entries[0].sectionLocation.range.start)) {
				parent.children.push(additionalSymbols.shift()!);
			}
		}

		if (!entries.length) {
			return;
		}

		const entry = entries[0];
		const symbol = this.#tocToDocumentSymbol(entry);
		symbol.children = [];

		while (entry.level <= parent.level) {
			parent = parent.parent!;
		}
		parent.children.push(symbol);

		this.#buildTocSymbolTree({ level: entry.level, children: symbol.children, parent, range: entry.sectionLocation.range }, entries.slice(1), additionalSymbols);
	}

	#tocToDocumentSymbol(entry: TocEntry): lsp.DocumentSymbol {
		return {
			name: this.#getTocSymbolName(entry),
			kind: lsp.SymbolKind.String,
			range: entry.sectionLocation.range,
			selectionRange: entry.sectionLocation.range
		};
	}

	#getTocSymbolName(entry: TocEntry): string {
		return '#'.repeat(entry.level) + ' ' + entry.text;
	}
}
