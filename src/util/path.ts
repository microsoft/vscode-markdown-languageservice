/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as lsp from 'vscode-languageserver-protocol';
import { LsConfiguration } from '../config.js';
import { Schemes } from './schemes.js';
import { URI, Utils } from './vscodeUri.js';

export function isSameResource(a: URI, b: URI): boolean {
	return a.toString() === b.toString();
}

export function isParentDir(parent: URI, maybeChild: URI): boolean {
	if (parent.scheme === maybeChild.scheme && parent.authority === maybeChild.authority) {
		const relative = path.relative(parent.path, maybeChild.path);
		return !relative.startsWith('..');
	}
	return false;
}

export function computeRelativePath(fromDoc: URI, toDoc: URI, preferDotSlash = false): string | undefined {
	if (fromDoc.scheme === toDoc.scheme && fromDoc.scheme !== Schemes.untitled) {
		const rootDir = Utils.dirname(fromDoc);
		let newLink = path.posix.relative(rootDir.path, toDoc.path);
		if (preferDotSlash && !(newLink.startsWith('../') || newLink.startsWith('..\\'))) {
			newLink = './' + newLink;
		}
		return newLink;
	}

	return undefined;
}

/**
 * Check if `path` looks like it points to `target`.
 *
 * Handles cases where `path` doesn't have a file extension but `target` does.
 */
export function looksLikePathToResource(configuration: LsConfiguration, path: URI, target: URI): boolean {
	if (path.fsPath === target.fsPath) {
		return true;
	}

	return configuration.markdownFileExtensions.some(ext => path.with({ path: path.path + '.' + ext }).fsPath === target.fsPath);
}

export function looksLikeMarkdownUri(config: LsConfiguration, resolvedHrefPath: URI): boolean {
	return looksLikeMarkdownExt(config, Utils.extname(resolvedHrefPath));
}

export function looksLikeMarkdownFilePath(config: LsConfiguration, fileName: string): boolean {
	return looksLikeMarkdownExt(config, path.extname(fileName));
}

function looksLikeMarkdownExt(config: LsConfiguration, rawExt: string): boolean {
	return config.markdownFileExtensions.includes(rawExt.toLowerCase().replace('.', ''));
}

/**
 * Extract position/range info from link fragments.
 *
 * Supported formats:
 * - `#73` / `#L73` — single line
 * - `#73,84` / `#L73,84` — line and column
 * - `#73-83` / `#L73-L83` — line range
 * - `#73,84-83,52` / `#L73,84-L83,52` — full range with columns
 */
export function parseLocationInfoFromFragment(fragment: string): lsp.Range | undefined {
	const match = fragment.match(/^L?(?<startLine>\d+)(?:,(?<startCol>\d+))?(?:-L?(?<endLine>\d+)(?:,(?<endCol>\d+))?)?$/i);
	if (!match?.groups) {
		return undefined;
	}

	const startLine = +match.groups['startLine'] - 1;
	if (isNaN(startLine)) {
		return undefined;
	}

	const startCol = +match.groups['startCol'] - 1;
	const start: lsp.Position = { line: startLine, character: isNaN(startCol) ? 0 : startCol };

	if (match.groups['endLine'] !== undefined) {
		const endLine = +match.groups['endLine'] - 1;
		if (isNaN(endLine)) {
			return undefined;
		}
		const endCol = +match.groups['endCol'] - 1;
		const end: lsp.Position = { line: endLine, character: isNaN(endCol) ? 0 : endCol };
		return { start, end };
	}

	return { start, end: start };
}
