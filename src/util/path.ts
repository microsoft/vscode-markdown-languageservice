/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as lsp from 'vscode-languageserver-protocol';
import { URI, Utils } from 'vscode-uri';
import { LsConfiguration } from '../config';
import { Schemes } from './schemes';

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
 * Extract position info from link fragments that look like `#L5,3`
 */
export function parseLocationInfoFromFragment(fragment: string): lsp.Position | undefined {
	const match = fragment.match(/^L(\d+)(?:,(\d+))?$/i);
	if (!match) {
		return undefined;
	}

	const line = +match[1] - 1;
	if (isNaN(line)) {
		return undefined;
	}

	const column = +match[2] - 1;
	return { line, character: isNaN(column) ? 0 : column };
}
