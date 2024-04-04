/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { escapeForAngleBracketLink, needsAngleBracketLink } from './mdLinks';

export function inlineCode(text: string): string {
    text = text.replace(/\n/, '');
    const longestBacktickSequence = Math.max(0, ...Array.from(text.matchAll(/`+/g), ([match]) => match.length));
    const backticks = '`'.repeat(longestBacktickSequence + 1);
    return `${backticks}${text}${backticks}`;
}

export function link(text: string, path: string): string {
    text = escapeMarkdownSyntaxTokens(text.replace(/\n/, ''));
    return `[${text}](${bracketPathIfNeeded(path)})`;
}

export function codeLink(text: string, path: string): string {
    return `[${inlineCode(text)}](${bracketPathIfNeeded(path)})`;
}

export function image(path: string, alt: string): string {
    return `![${alt}](${bracketPathIfNeeded(path)})`;
}

function bracketPathIfNeeded(path: string) {
    return needsAngleBracketLink(path) ? escapeForAngleBracketLink(path) : path;
}

/**
 * Escape markdown syntax tokens: http://daringfireball.net/projects/markdown/syntax#backslash
 */
function escapeMarkdownSyntaxTokens(text: string): string {
    return text.replace(/[\\`*_{}[\]()#+\-!~]/g, '\\$&'); // CodeQL [SM02383] Backslash is escaped in the character class
}