/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vscode-languageserver';
import { ITextDocument } from './types/textDocument';
import { URI } from 'vscode-uri';

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

	// readDirectory(resource: URI): Promise<[string, { isDir: boolean }][]>;

	readonly onDidChangeMarkdownDocument: Event<ITextDocument>;
	readonly onDidCreateMarkdownDocument: Event<ITextDocument>;
	readonly onDidDeleteMarkdownDocument: Event<URI>;
}
