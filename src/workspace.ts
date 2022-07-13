/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vscode-languageserver';
import { URI, Utils } from 'vscode-uri';
import { ITextDocument } from './types/textDocument';

export interface FileStat {
	readonly isDirectory?: boolean;
}

/**
 * Provide information about the contents of a workspace.
 */
export interface IWorkspace {

	/**
	 * Get the root folders for this workspace.
	 */
	get workspaceFolders(): readonly URI[];

	/**
	 * Get complete list of markdown documents.
	 *
	 * This may include documents that have not been opened yet (for example, getAllMarkdownDocuments should
	 * return documents from disk even if they have not been opened yet in the editor)
	 */
	getAllMarkdownDocuments(): Promise<Iterable<ITextDocument>>;

	/**
	 * Check if a document already exists in the workspace contents.
	 */
	hasMarkdownDocument(resource: URI): boolean;

	/**
	 * Try to open a markdown document.
	 *
	 * This may either get the document from a cache or open it and add it to the cache.
	 *
	 * @return The document, or `undefined` if the file could not be opened or was not a markdown file.
	 */
	openMarkdownDocument(resource: URI): Promise<ITextDocument | undefined>;

	/**
	 * Get metadata about a file.
	 *
	 * @param resource URI to check. Does not have to be to a markdown file.
	 *
	 * @return Metadata or `undefined` if the resource does not exist.
	 */
	stat(resource: URI): Promise<FileStat | undefined>;

	/**
	 * List all files in a directory.
	 *
	 * @param resource URI of the directory to check. Does not have to be to a markdown file.
	 *
	 * @return List of `[fileName, metadata]` tuples.
	 */
	readDirectory(resource: URI): Promise<Iterable<readonly [string, FileStat]>>;

	/**
	 * Fired when the content of a markdown document changes.
	 */
	readonly onDidChangeMarkdownDocument: Event<ITextDocument>;

	/**
	 * Fired when a markdown document is first created.
	 */
	readonly onDidCreateMarkdownDocument: Event<ITextDocument>;

	/**
	 * Fired when a markdown document is deleted.
	 */
	readonly onDidDeleteMarkdownDocument: Event<URI>;
}

export function getWorkspaceFolder(workspace: IWorkspace, docUri: URI): URI | undefined {
	for (const folder of workspace.workspaceFolders) {
		if (folder.scheme === docUri.scheme
			&& folder.authority === docUri.authority
			&& docUri.path.startsWith(folder.path + '/')
		) {
			return folder;
		}
	}
	return workspace.workspaceFolders[0];
}

export async function resolveUriToMarkdownFile(workspace: IWorkspace, resource: URI): Promise<ITextDocument | undefined> {
	try {
		const doc = await workspace.openMarkdownDocument(resource);
		if (doc) {
			return doc;
		}
	} catch {
		// Noop
	}

	// If no extension, try with `.md` extension
	if (Utils.extname(resource) === '') {
		return workspace.openMarkdownDocument(resource.with({ path: resource.path + '.md' }));
	}

	return undefined;
}
