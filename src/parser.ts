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

export interface IMdParser {
	readonly slugifier: ISlugifier;

	tokenize(document: ITextDocument): Promise<Token[]>;
}
