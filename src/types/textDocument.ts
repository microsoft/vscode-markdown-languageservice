/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Position, Range } from 'vscode-languageserver-types';
import { makeRange } from './range';

/**
 * A document in the workspace.
 */
export interface ITextDocument {
	/**
	 * The uri of the document, as a string.
	 */
	readonly uri: string;
	
	/**
	 * Version number of the document's content. 
	 */
	readonly version: number;

	/**
	 * The total number of lines in the document.
	 */
	readonly lineCount: number;

	/**
	 * Get text contents of the document.
	 * 
	 * @param range Optional range to get the text of. If not specified, the entire document content is returned.
	 */
	getText(range?: Range): string;

	/**
	 * Converts an offset in the document into a {@link Position position}.
	 */
	positionAt(offset: number): Position;
}

export function getLine(doc: ITextDocument, line: number): string {
	return doc.getText(makeRange(line, 0, line, Number.MAX_VALUE)).replace(/\r?\n$/, '');
}
