/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from 'vscode-languageserver';
import * as lsp from 'vscode-languageserver-types';
import { ILogger, LogLevel } from '../logging';
import { IMdParser, Token, TokenWithMap } from '../parser';
import { MdTableOfContentsProvider } from '../tableOfContents';
import { getLine, ITextDocument } from '../types/textDocument';
import { isEmptyOrWhitespace } from '../util/string';

const rangeLimit = 5000;

export class MdFoldingProvider {

	constructor(
		private readonly _parser: IMdParser,
		private readonly _tocProvider: MdTableOfContentsProvider,
		private readonly _logger: ILogger,
	) { }

	public async provideFoldingRanges(document: ITextDocument, token: CancellationToken): Promise<lsp.FoldingRange[]> {
		this._logger.log(LogLevel.Debug, 'MdFoldingProvider', `provideFoldingRanges — ${document.uri} ${document.version}`);

		const foldables = await Promise.all([
			this._getRegions(document, token),
			this._getHeaderFoldingRanges(document, token),
			this._getBlockFoldingRanges(document, token)
		]);
		return foldables.flat().slice(0, rangeLimit);
	}

	private async _getRegions(document: ITextDocument, token: CancellationToken): Promise<lsp.FoldingRange[]> {
		const tokens = await this._parser.tokenize(document);
		if (token.isCancellationRequested) {
			return [];
		}
		
		const regionMarkers = tokens.filter(isRegionMarker)
			.map(token => ({ line: token.map[0], isStart: isStartRegion(token.content) }));

		const nestingStack: { line: number; isStart: boolean }[] = [];
		return regionMarkers
			.map((marker): lsp.FoldingRange | null => {
				if (marker.isStart) {
					nestingStack.push(marker);
				} else if (nestingStack.length && nestingStack[nestingStack.length - 1].isStart) {
					return { startLine: nestingStack.pop()!.line, endLine: marker.line, kind: lsp.FoldingRangeKind.Region };
				} else {
					// noop: invalid nesting (i.e. [end, start] or [start, end, end])
				}
				return null;
			})
			.filter((region: lsp.FoldingRange | null): region is lsp.FoldingRange => !!region);
	}

	private async _getHeaderFoldingRanges(document: ITextDocument, token: CancellationToken): Promise<lsp.FoldingRange[]> {
		const toc = await this._tocProvider.getForDocument(document);
		if (token.isCancellationRequested) {
			return [];
		}

		return toc.entries.map((entry): lsp.FoldingRange => {
			let endLine = entry.sectionLocation.range.end.line;
			if (isEmptyOrWhitespace(getLine(document, endLine)) && endLine >= entry.line + 1) {
				endLine = endLine - 1;
			}
			return { startLine: entry.line, endLine };
		});
	}

	private async _getBlockFoldingRanges(document: ITextDocument, token: CancellationToken): Promise<lsp.FoldingRange[]> {
		const tokens = await this._parser.tokenize(document);
		if (token.isCancellationRequested) {
			return [];
		}

		const multiLineListItems = tokens.filter(isFoldableToken);
		return multiLineListItems.map(listItem => {
			const start = listItem.map[0];
			let end = listItem.map[1] - 1;
			if (isEmptyOrWhitespace(getLine(document, end)) && end >= start + 1) {
				end = end - 1;
			}
			return { startLine: start, endLine: end, kind: this._getFoldingRangeKind(listItem) };
		});
	}

	private _getFoldingRangeKind(listItem: Token): lsp.FoldingRangeKind | undefined {
		return listItem.type === 'html_block' && listItem.content.startsWith('<!--')
			? lsp.FoldingRangeKind.Comment
			: undefined;
	}
}

const isStartRegion = (t: string) => /^\s*<!--\s*#?region\b.*-->/.test(t);
const isEndRegion = (t: string) => /^\s*<!--\s*#?endregion\b.*-->/.test(t);

const isRegionMarker = (token: Token): token is TokenWithMap =>
	!!token.map && token.type === 'html_block' && (isStartRegion(token.content) || isEndRegion(token.content));

const isFoldableToken = (token: Token): token is TokenWithMap => {
	if (!token.map) {
		return false;
	}

	switch (token.type) {
		case 'fence':
		case 'list_item_open':
			return token.map[1] > token.map[0];

		case 'html_block':
			if (isRegionMarker(token)) {
				return false;
			}
			return token.map[1] > token.map[0] + 1;

		default:
			return false;
	}
};
