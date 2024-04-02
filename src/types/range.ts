/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Position, Range } from 'vscode-languageserver-protocol';
import { arePositionsEqual, isBefore } from './position';


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
	if (Range.is(other)) {
		return rangeContains(range, other.start) && rangeContains(range, other.end);
	}
	return !isBefore(other, range.start) && !isBefore(range.end, other);
}

export function rangeIntersects(a: Range, b: Range): boolean {
	if (rangeContains(a, b.start) || rangeContains(a, b.end)) {
		return true;
	}
	// Check case where `a` is entirely contained in `b`
	return rangeContains(b, a.start) || rangeContains(b, a.end);
}
