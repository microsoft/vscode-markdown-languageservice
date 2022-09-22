/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vscode-languageserver';
import { URI, Utils } from 'vscode-uri';
import { defaultMarkdownFileExtension, LsConfiguration } from './config';
import { ITextDocument } from './types/textDocument';
import { IDisposable } from './util/dispose';
import { ResourceMap } from './util/resourceMap';

export interface FileStat {
	readonly isDirectory?: boolean;
}

export interface ContainingDocumentContext {
	/**
	 * Uri of the parent document.
	 */
	readonly uri: URI;

	/**
	 * List of child markdown documents.
	 */
	readonly children: Iterable<{ readonly uri: URI }>;
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
	 * @returns The document, or `undefined` if the file could not be opened or was not a markdown file.
	 */
	openMarkdownDocument(resource: URI): Promise<ITextDocument | undefined>;

	/**
	 * Get metadata about a file.
	 *
	 * @param resource URI to check. Does not have to be to a markdown file.
	 *
	 * @returns Metadata or `undefined` if the resource does not exist.
	 */
	stat(resource: URI): Promise<FileStat | undefined>;

	/**
	 * List all files in a directory.
	 *
	 * @param resource URI of the directory to check. Does not have to be to a markdown file.
	 *
	 * @returns List of `[fileName, metadata]` tuples.
	 */
	readDirectory(resource: URI): Promise<Iterable<readonly [string, FileStat]>>;

	/**
	 * Get the document that contains `resource` as a sub document.
	 *
	 * If `resource` is a notebook cell for example, this should return the parent notebook.
	 *
	 * @returns The parent document info or `undefined` if none.
	 */
	getContainingDocument?(resource: URI): ContainingDocumentContext | undefined;
}

export interface FileWatcherOptions {
	readonly ignoreCreate?: boolean;
	readonly ignoreChange?: boolean;
	readonly ignoreDelete?: boolean;
}

/**
 * A workspace that also supports watching arbitrary files.
 */
export interface IWorkspaceWithWatching extends IWorkspace {
	/**
	 * Start watching a given file.
	 */
	watchFile(path: URI, options: FileWatcherOptions): IFileSystemWatcher;
}

export function isWorkspaceWithFileWatching(workspace: IWorkspace): workspace is IWorkspaceWithWatching {
	return 'watchFile' in workspace;
}

/**
 * Watches a file for changes to it on the file system.
 */
export interface IFileSystemWatcher extends IDisposable {
	/** Fired when the file is created. */
	readonly onDidCreate: Event<URI>;

	/** Fired when the file is changed on the file system. */
	readonly onDidChange: Event<URI>;

	/** Fired when the file is deleted. */
	readonly onDidDelete: Event<URI>;
}

export function getWorkspaceFolder(workspace: IWorkspace, docUri: URI): URI | undefined {
	if (workspace.workspaceFolders.length === 0) {
		return undefined;
	}

	// Find the longest match
	const possibleWorkspaces = workspace.workspaceFolders
		.filter(folder =>
			folder.scheme === docUri.scheme
			&& folder.authority === docUri.authority
			&& (docUri.fsPath.startsWith(folder.fsPath + '/') || docUri.fsPath.startsWith(folder.fsPath + '\\')))
		.sort((a, b) => b.fsPath.length - a.fsPath.length);

	if (possibleWorkspaces.length) {
		return possibleWorkspaces[0];
	}

	// Default to first workspace
	// TODO: Does this make sense?
	return workspace.workspaceFolders[0];
}

export async function openLinkToMarkdownFile(config: LsConfiguration, workspace: IWorkspace, resource: URI): Promise<ITextDocument | undefined> {
	try {
		const doc = await workspace.openMarkdownDocument(resource);
		if (doc) {
			return doc;
		}
	} catch {
		// Noop
	}

	const dotMdResource = tryAppendMarkdownFileExtension(config, resource);
	if (dotMdResource) {
		return workspace.openMarkdownDocument(dotMdResource);
	}

	return undefined;
}

/**
 * Check that a link to a file exists.
 *
 * @returns The resolved URI or `undefined` if the file does not exist.
 */
export async function statLinkToMarkdownFile(config: LsConfiguration, workspace: IWorkspace, linkUri: URI, out_statCache?: ResourceMap<{ readonly exists: boolean }>): Promise<URI | undefined> {
	const exists = async (uri: URI): Promise<boolean> => {
		const result = await workspace.stat(uri);
		out_statCache?.set(uri, { exists: !!result });
		return !!result;
	};

	if (await exists(linkUri)) {
		return linkUri;
	}

	// We don't think the file exists. See if we need to append `.md`
	const dotMdResource = tryAppendMarkdownFileExtension(config, linkUri);
	if (dotMdResource && await exists(dotMdResource)) {
		return dotMdResource;
	}

	return undefined;
}

export function tryAppendMarkdownFileExtension(config: LsConfiguration, linkUri: URI): URI | undefined {
	const ext = Utils.extname(linkUri).toLowerCase().replace(/^\./, '');
	if (ext === '' || !(config.markdownFileExtensions.includes(ext) || config.knownLinkedToFileExtensions.includes(ext))) {
		return linkUri.with({ path: linkUri.path + '.' + (config.markdownFileExtensions[0] ?? defaultMarkdownFileExtension) });
	}
	return undefined;
}