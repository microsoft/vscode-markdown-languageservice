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
 * Provides set of markdown files in the current workspace.
 */
export interface IWorkspace {

	get workspaceFolders(): readonly URI[];

	/**
	 * Get list of all known markdown files.
	 */
	getAllMarkdownDocuments(): Promise<Iterable<ITextDocument>>;

	/**
	 * Check if a document already exists in the workspace contents.
	 */
	hasMarkdownDocument(resource: URI): boolean;

	getOrLoadMarkdownDocument(resource: URI): Promise<ITextDocument | undefined>;

	/**
	 * Get metadata about a file.
	 *
	 * @return Metadata or `undefined` if the resource does not exist.
	 */
	stat(resource: URI): Promise<FileStat | undefined>;

	readDirectory(resource: URI): Promise<[string, FileStat][]>;

	readonly onDidChangeMarkdownDocument: Event<ITextDocument>;
	readonly onDidCreateMarkdownDocument: Event<ITextDocument>;
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
		const doc = await workspace.getOrLoadMarkdownDocument(resource);
		if (doc) {
			return doc;
		}
	} catch {
		// Noop
	}

	// If no extension, try with `.md` extension
	if (Utils.extname(resource) === '') {
		return workspace.getOrLoadMarkdownDocument(resource.with({ path: resource.path + '.md' }));
	}

	return undefined;
}
