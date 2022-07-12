/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Position } from 'vscode-languageserver-types';

export function arePositionsEqual(a: Position, b: Position): boolean {
	return a.line === b.line && a.character === b.character;
}

export function isPosition(other: any): other is Position {
	if (!other) {
		return false;
	}

	const { line, character } = <Position>other;
	return typeof line === 'number' && typeof character === 'number';
}

export function translatePosition(pos: Position, change: { lineDelta?: number; characterDelta?: number }): Position {
	return {
		line: pos.line + (change.lineDelta ?? 0),
		character: pos.character + (change.characterDelta ?? 0),
	};
}

export function isBefore(pos: Position, other: Position): boolean {
	if (pos.line < other.line) {
		return true;
	}
	if (other.line < pos.line) {
		return false;
	}
	return pos.character < other.character;
}

export function isBeforeOrEqual(pos: Position, other: Position): boolean {
	if (pos.line < other.line) {
		return true;
	}
	if (other.line < pos.line) {
		return false;
	}
	return pos.character <= other.character;
}

export function isAfter(pos: Position, other: Position): boolean {
	return !isBeforeOrEqual(pos, other);
}