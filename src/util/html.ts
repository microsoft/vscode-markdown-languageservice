/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Map of html tags to attributes that contain links.
 */
export const htmlTagPathAttrs = new Map([
	['IMG', ['src']],
	['VIDEO', ['src', 'placeholder']],
	['SOURCE', ['src']],
	['A', ['href']],
]);
