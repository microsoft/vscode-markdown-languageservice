/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISlugifier } from './slugify';
import { ITextDocument } from './types/textDocument';

export interface Token {
	readonly type: string;
	readonly markup: string;
	readonly content: string;
	readonly map: number[] | null;
	readonly children: readonly Token[] | null;
}

export interface TokenWithMap extends Token {
	readonly map: [number, number];
}

/**
 * Parses Markdown text into a stream of tokens.
 */
export interface IMdParser {

	/**
	 * The {@link ISlugifier slugifier} used for generating unique ids for headers in the Markdown.
	 */
	readonly slugifier: ISlugifier;
	
	/**
	 * Parse `document` into a stream of tokens.
	 */
	tokenize(document: ITextDocument): Promise<Token[]>;
}
