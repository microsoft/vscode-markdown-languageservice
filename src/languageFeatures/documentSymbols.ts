/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from 'vscode-languageserver';
import * as lsp from 'vscode-languageserver-types';
import { ILogger, LogLevel } from '../logging';
import { MdTableOfContentsProvider, TableOfContents, TocEntry } from '../tableOfContents';
import { isBefore } from '../types/position';
import { makeRange } from '../types/range';
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

	constructor(
		private readonly _tocProvider: MdTableOfContentsProvider,
		private readonly _linkProvider: MdLinkProvider,
		private readonly _logger: ILogger,
	) { }

	public async provideDocumentSymbols(document: ITextDocument, options: ProvideDocumentSymbolOptions, token: CancellationToken): Promise<lsp.DocumentSymbol[]> {
		this._logger.log(LogLevel.Trace, 'DocumentSymbolProvider', `provideDocumentSymbols — ${document.uri} ${document.version}`);

		const linkSymbols = await (options.includeLinkDefinitions ? this._provideLinkDefinitionSymbols(document, token) : []);
		if (token.isCancellationRequested) {
			return [];
		}

		const toc = await this._tocProvider.getForDocument(document);
		if (token.isCancellationRequested) {
			return [];
		}

		return this._toSymbolTree(document, linkSymbols, toc);
	}

	private _toSymbolTree(document: ITextDocument, linkSymbols: readonly lsp.DocumentSymbol[], toc: TableOfContents): lsp.DocumentSymbol[] {
		const root: MarkdownSymbol = {
			level: -Infinity,
			children: [],
			parent: undefined,
			range: makeRange(0, 0, document.lineCount + 1, 0),
		};
		const additionalSymbols = [...linkSymbols];
		this._buildTocSymbolTree(root, toc.entries, additionalSymbols);
		// Put remaining link definitions into top level document instead of last header
		root.children.push(...additionalSymbols);
		return root.children;
	}

	private async _provideLinkDefinitionSymbols(document: ITextDocument, token: CancellationToken): Promise<lsp.DocumentSymbol[]> {
		const { links } = await this._linkProvider.getLinks(document);
		if (token.isCancellationRequested) {
			return [];
		}

		return links
			.filter(link => link.kind === MdLinkKind.Definition)
			.map((link): lsp.DocumentSymbol => this._definitionToDocumentSymbol(link as MdLinkDefinition));
	}

	private _definitionToDocumentSymbol(def: MdLinkDefinition): lsp.DocumentSymbol {
		return {
			kind: lsp.SymbolKind.Constant,
			name: `[${def.ref.text}]`,
			selectionRange: def.ref.range,
			range: def.source.range,
		};
	}

	private _buildTocSymbolTree(parent: MarkdownSymbol, entries: readonly TocEntry[], additionalSymbols: lsp.DocumentSymbol[]): void {
		if (entries.length) {
			while (additionalSymbols.length && isBefore(additionalSymbols[0].range.end, entries[0].sectionLocation.range.start)) {
				parent.children.push(additionalSymbols.shift()!);
			}
		}

		if (!entries.length) {
			return;
		}

		const entry = entries[0];
		const symbol = this._tocToDocumentSymbol(entry);
		symbol.children = [];

		while (entry.level <= parent.level) {
			parent = parent.parent!;
		}
		parent.children.push(symbol);

		this._buildTocSymbolTree({ level: entry.level, children: symbol.children, parent, range: entry.sectionLocation.range }, entries.slice(1), additionalSymbols);
	}

	private _tocToDocumentSymbol(entry: TocEntry): lsp.DocumentSymbol {
		return {
			name: this._getTocSymbolName(entry),
			kind: lsp.SymbolKind.String,
			range: entry.sectionLocation.range,
			selectionRange: entry.sectionLocation.range
		};
	}

	private _getTocSymbolName(entry: TocEntry): string {
		return '#'.repeat(entry.level) + ' ' + entry.text;
	}
}
