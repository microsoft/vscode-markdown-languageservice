/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as lsp from 'vscode-languageserver-protocol';
import { URI } from 'vscode-uri';
import { maxLspUInt } from '../util/number';

/**
 * A document in the workspace.
 */
export interface ITextDocument {
	/**
	 * The uri of the document, as a string.
	 */
	readonly uri: string;

	/**
	 * The uri of the document, as a URI. 
	 */
	readonly $uri?: URI;
	
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
	getText(range?: lsp.Range): string;

	/**
	 * Converts an offset in the document into a {@link lsp.Position position}.
	 */
	positionAt(offset: number): lsp.Position;

	/**
	 * Converts a {@link lsp.Position position} to an offset in the document.
	 */
	offsetAt(position: lsp.Position): number;
}

export function getLine(doc: ITextDocument, line: number): string {
	return doc.getText(lsp.Range.create(line, 0, line, maxLspUInt)).replace(/\r?\n$/, '');
}

export function getDocUri(doc: ITextDocument): URI {
	return doc.$uri ?? URI.parse(doc.uri);
}
