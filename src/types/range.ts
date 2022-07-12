/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Position, Range } from 'vscode-languageserver-types';
import { arePositionsEqual, isBefore, isPosition } from './position';

export function isRange(thing: any): thing is Range {
	if (!thing) {
		return false;
	}
	return isPosition((<Range>thing).start)
		&& isPosition((<Range>thing.end));
}

export function makeRange(startLine: number, startCharacter: number, endLine: number, endCharacter: number): Range;
export function makeRange(start: Position, end: Position): Range;
export function makeRange(startOrStartLine: Position | number, endOrStartCharacter: Position | number, endLine?: number, endCharacter?: number): Range {
	if (typeof startOrStartLine === 'number') {
		return {
			start: { line: startOrStartLine, character: endOrStartCharacter as number },
			end: { line: endLine as number, character: endCharacter as number },
		};
	}
	return { start: startOrStartLine, end: endOrStartCharacter as Position };
}

export function areRangesEqual(a: Range, b: Range): boolean {
	return arePositionsEqual(a.start, b.start) && arePositionsEqual(a.end, b.end);
}

export function modifyRange(range: Range, start?: Position, end?: Position): Range {
	return {
		start: start ?? range.start,
		end: end ?? range.end,
	};
}

export function rangeContains(range: Range, other: Position | Range): boolean {
	if (isRange(other)) {
		return rangeContains(range, other.start) && rangeContains(range, other.end);
	}
	return !isBefore(other, range.start) && !isBefore(range.end, other);
}