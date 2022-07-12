/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from 'vscode-languageserver';
import * as lsp from 'vscode-languageserver-types';
import { ILogger } from '../logging';
import { IMdParser, Token, TokenWithMap } from '../parser';
import { MdTableOfContentsProvider } from '../tableOfContents';
import { getLine, ITextDocument } from '../types/textDocument';
import { isEmptyOrWhitespace } from '../util/string';

const rangeLimit = 5000;

export class MdFoldingProvider {

	constructor(
		private readonly parser: IMdParser,
		private readonly tocProvider: MdTableOfContentsProvider,
		private readonly logger: ILogger,
	) { }

	public async provideFoldingRanges(
		document: ITextDocument,
		_token: CancellationToken
	): Promise<lsp.FoldingRange[]> {
		this.logger.verbose('MdFoldingProvider', `provideFoldingRanges - ${document.uri}`);

		const foldables = await Promise.all([
			this.getRegions(document),
			this.getHeaderFoldingRanges(document),
			this.getBlockFoldingRanges(document)
		]);
		return foldables.flat().slice(0, rangeLimit);
	}

	private async getRegions(document: ITextDocument): Promise<lsp.FoldingRange[]> {
		const tokens = await this.parser.tokenize(document);
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

	private async getHeaderFoldingRanges(document: ITextDocument): Promise<lsp.FoldingRange[]> {
		const toc = await this.tocProvider.getForDocument(document);
		return toc.entries.map((entry): lsp.FoldingRange => {
			let endLine = entry.sectionLocation.range.end.line;
			if (isEmptyOrWhitespace(getLine(document, endLine)) && endLine >= entry.line + 1) {
				endLine = endLine - 1;
			}
			return { startLine: entry.line, endLine };
		});
	}

	private async getBlockFoldingRanges(document: ITextDocument): Promise<lsp.FoldingRange[]> {
		const tokens = await this.parser.tokenize(document);
		const multiLineListItems = tokens.filter(isFoldableToken);
		return multiLineListItems.map(listItem => {
			const start = listItem.map[0];
			let end = listItem.map[1] - 1;
			if (isEmptyOrWhitespace(getLine(document, end)) && end >= start + 1) {
				end = end - 1;
			}
			return { startLine: start, endLine: end, kind: this.getFoldingRangeKind(listItem) };
		});
	}

	private getFoldingRangeKind(listItem: Token): lsp.FoldingRangeKind | undefined {
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
