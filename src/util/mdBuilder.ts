/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vscode-uri';
import { escapeForAngleBracketLink, needsAngleBracketLink } from './mdLinks';

export function inlineCode(text: string): string {
    text = text.replace(/\n/, '');
    const longestBacktickSequence = Math.max(0, ...Array.from(text.matchAll(/`+/g), ([match]) => match.length));
    const backticks = '`'.repeat(longestBacktickSequence + 1);
    return `${backticks}${text}${backticks}`;
}

export function link(text: string, uri: URI): string {
    const path = uri.toString();
    return `[${escapeMarkdownSyntaxTokens(text.replace(/\n/, ''))}](${bracketPathIfNeeded(path)})`;
}

export function codeLink(text: string, uri: URI): string {
    const path = uri.toString();
    return `[${inlineCode(text)}](${bracketPathIfNeeded(path)})`;
}

export function image(uri: URI, alt: string, width?: number): string {
    const path = uri.toString();
    return `![${alt}](${bracketPathIfNeeded(path + (width ? `|width=${width}` : ''))})`;
}

export function imageLink(uri: URI, alt: string, width?: number): string {
    const path = uri.toString();
    return `[${image(uri, alt, width)}](${bracketPathIfNeeded(path)})`;
}

export function video(uri: URI, width?: number): string {
    const path = uri.toString();
    return `<video width="${width ?? ''}" src="${escapeHtmlAttribute(path)}" autoplay loop controls muted></video>`;
}

function escapeHtmlAttribute(value: string): string {
    return value.replace(/"/g, '&quot;');
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
