/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vscode-languageserver';
import { ITextDocument } from './types/textDocument';
import { URI } from 'vscode-uri';

/**
 * Provides set of markdown files in the current workspace.
 */
export interface IWorkspace {
	/**
	 * Get list of all known markdown files.
	 */
	getAllMarkdownDocuments(): Promise<Iterable<ITextDocument>>;

	/**
	 * Check if a document already exists in the workspace contents.
	 */
	hasMarkdownDocument(resource: URI): boolean;

	getOrLoadMarkdownDocument(resource: URI): Promise<ITextDocument | undefined>;

	// pathExists(resource: URI): Promise<boolean>;

	// readDirectory(resource: URI): Promise<[string, { isDir: boolean }][]>;

	readonly onDidChangeMarkdownDocument: Event<ITextDocument>;
	readonly onDidCreateMarkdownDocument: Event<ITextDocument>;
	readonly onDidDeleteMarkdownDocument: Event<URI>;
}
