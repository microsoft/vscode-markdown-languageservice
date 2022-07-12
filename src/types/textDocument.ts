/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Position, Range } from 'vscode-languageserver-types';
import { makeRange } from './range';

/**
 * Minimal version of `vscode.TextDocument`.
 */
export interface ITextDocument {
	readonly uri: string;
	readonly version: number;
	readonly lineCount: number;

	getText(range?: Range): string;
	positionAt(offset: number): Position;
}

export function getLine(doc: ITextDocument, line: number): string {
	return doc.getText(makeRange(line, 0, line, Number.MAX_VALUE)).replace(/\r?\n$/, '');
}
