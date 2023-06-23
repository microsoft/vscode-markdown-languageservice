/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


export function escapeForAngleBracketLink(linkText: string) {
	return linkText.replace(/([<>])/g, '\\$1'); // CodeQL [SM02383] This escaping is done for text in an editor, not for rendered markdown.
}

export function needsAngleBracketLink(linkText: string) {
	// Links with whitespace or control characters must be enclosed in brackets
	// eslint-disable-next-line no-control-regex
	if (linkText.startsWith('<') || /\s|[\u007F\u0000-\u001f]/.test(linkText)) {
		return true;
	}

	return !hasBalancedParens(linkText);
}


export function hasBalancedParens(linkText: string): boolean {
	// Check if the link has balanced parens
	if (!/[\(\)]/.test(linkText)) {
		return true;
	}

	let previousChar = '';
	let nestingCount = 0;
	for (const char of linkText) {
		if (char === '(' && previousChar !== '\\') {
			nestingCount++;
		} else if (char === ')' && previousChar !== '\\') {
			nestingCount--;
		}

		if (nestingCount < 0) {
			return false;
		}

		previousChar = char;
	}

	return nestingCount === 0;
}


