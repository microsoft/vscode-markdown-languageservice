/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as lsp from 'vscode-languageserver-protocol';
import { Token } from '../parser';
import { rangeContains } from '../types/range';
import { ITextDocument } from '../types/textDocument';

const inlineCodePattern = /(?<!`)(`+)((?:.+?|.*?(?:(?:\r?\n).+?)*?)(?:\r?\n)?\1)(?!`)/gm;

class InlineRanges {

	public static create() {
		return new InlineRanges();
	}

	readonly #map: Map</* line number */ number, lsp.Range[]>;

	private constructor(data?: ReadonlyMap<number, lsp.Range[]>) {
		this.#map = new Map(data);
	}

	public get(line: number): lsp.Range[] {
		return this.#map.get(line) || [];
	}

	public add(range: lsp.Range): void {
		// Register the range for all lines that it covers
		for (let line = range.start.line; line <= range.end.line; line++) {
			let ranges = this.#map.get(line);
			if (!ranges) {
				ranges = [];
				this.#map.set(line, ranges);
			}
			ranges.push(range);
		}
	}

	public concat(newRanges: Iterable<lsp.Range>): InlineRanges {
		const result = new InlineRanges(this.#map);
		for (const range of newRanges) {
			result.add(range);
		}
		return result;
	}
}

export class NoLinkRanges {
	public static compute(tokens: readonly Token[], document: ITextDocument): NoLinkRanges {
		const multiline = tokens
			.filter(t => (t.type === 'code_block' || t.type === 'fence' || t.type === 'html_block') && !!t.map)
			.map(t => ({ type: t.type, range: t.map as [number, number] }));

		const inlineRanges = InlineRanges.create();
		const text = document.getText();
		for (const match of text.matchAll(inlineCodePattern)) {
			const startOffset = match.index ?? 0;
			const startPosition = document.positionAt(startOffset);
			inlineRanges.add(lsp.Range.create(startPosition, document.positionAt(startOffset + match[0].length)));
		}

		return new NoLinkRanges(multiline, inlineRanges);
	}

	private constructor(
		/**
		 * Block element ranges, such as code blocks. Represented by [line_start, line_end).
		 */
		public readonly multiline: ReadonlyArray<{ type: string, range: [number, number] }>,

		/**
		 * Inline code spans where links should not be detected
		 */
		public readonly inline: InlineRanges,
	) { }

	contains(position: lsp.Position, excludeType = ''): boolean {
		return this.multiline.some(({ type, range }) => type !== excludeType && position.line >= range[0] && position.line < range[1]) ||
			!!this.inline.get(position.line)?.some(inlineRange => rangeContains(inlineRange, position));
	}

	concatInline(inlineRanges: Iterable<lsp.Range>): NoLinkRanges {
		return new NoLinkRanges(this.multiline, this.inline.concat(inlineRanges));
	}
}
