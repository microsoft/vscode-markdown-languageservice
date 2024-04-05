/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI, Utils } from 'vscode-uri';
import { LsConfiguration, PreferredMdPathExtensionStyle } from '../config';
import { InternalHref } from '../types/documentLink';
import { IWorkspace, getWorkspaceFolder } from '../workspace';
import { looksLikeMarkdownUri } from './path';
import { Schemes } from './schemes';

/**
 * Escapes special characters so that {@linkcode linkText} can be used in an angle bracket link.
 */
export function escapeForAngleBracketLink(linkText: string) {
	return linkText.replace(/([<>])/g, '\\$1'); // CodeQL [SM02383] This escaping is done for text in an editor, not for rendered markdown.
}

/**
 * Checks if {@linkcode linkText} needs to be enclosed in angle brackets.
 */
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

/**
 * Removes the file extension from {@link newUri} based on {@link LsConfiguration} preference.
 */
export function removeNewUriExtIfNeeded(config: LsConfiguration, originalHref: InternalHref, newUri: URI) {
	if (shouldRemoveNewUriExt(config, originalHref, newUri)) {
		const editExt = Utils.extname(newUri);
		return newUri.with({
			path: newUri.path.slice(0, newUri.path.length - editExt.length)
		});
	}
	return newUri;
}

function shouldRemoveNewUriExt(config: LsConfiguration, originalHref: InternalHref, newUri: URI): boolean {
	if (!looksLikeMarkdownUri(config, newUri)) {
		return false;
	}

	switch (config.preferredMdPathExtensionStyle) {
		case PreferredMdPathExtensionStyle.removeExtension:
			return true;

		case PreferredMdPathExtensionStyle.includeExtension:
			return false;

		case PreferredMdPathExtensionStyle.auto:
		case undefined:
			// If the original markdown link did not use a file extension, remove ours too
			return !Utils.extname(originalHref.path);
	}
}

export function resolveInternalDocumentLink(
    sourceDocUri: URI,
    linkText: string,
    workspace: IWorkspace
): { resource: URI; linkFragment: string; } | undefined {
    // Assume it must be an relative or absolute file path
    // Use a fake scheme to avoid parse warnings
    const tempUri = URI.parse(`vscode-resource:${linkText}`);

    const docUri = workspace.getContainingDocument?.(sourceDocUri)?.uri ?? sourceDocUri;

    let resourceUri: URI | undefined;
    if (!tempUri.path) {
        // Looks like a fragment only link
        if (typeof tempUri.fragment !== 'string') {
            return undefined;
        }

        resourceUri = sourceDocUri;
    } else if (tempUri.path[0] === '/') {
        const root = getWorkspaceFolder(workspace, docUri);
        if (root) {
            resourceUri = Utils.joinPath(root, tempUri.path);
        }
    } else {
        if (docUri.scheme === Schemes.untitled) {
            const root = getWorkspaceFolder(workspace, docUri);
            if (root) {
                resourceUri = Utils.joinPath(root, tempUri.path);
            }
        } else {
            const base = Utils.dirname(docUri);
            resourceUri = Utils.joinPath(base, tempUri.path);
        }
    }

    if (!resourceUri) {
        return undefined;
    }

    return {
        resource: resourceUri,
        linkFragment: tempUri.fragment,
    };
}
