/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as path from 'path';
import { Emitter } from 'vscode-languageserver';
import { URI } from 'vscode-uri';
import { getDocUri, ITextDocument } from '../types/textDocument';
import { Disposable } from '../util/dispose';
import { ResourceMap } from '../util/resourceMap';
import { FileStat, FileWatcherOptions, IFileSystemWatcher, IWorkspaceWithWatching } from '../workspace';
import { InMemoryDocument } from './inMemoryDocument';
import { workspaceRoot } from './util';

export class InMemoryWorkspace extends Disposable implements IWorkspaceWithWatching {

	private readonly _documents = new ResourceMap<ITextDocument>(uri => uri.fsPath);
	private readonly _additionalFiles = new ResourceMap<void>();

	private readonly _watchers = new Set<{
		readonly resource: URI;
		readonly options: FileWatcherOptions;
		readonly onDidChange: Emitter<URI>;
		readonly onDidCreate: Emitter<URI>;
		readonly onDidDelete: Emitter<URI>;
	}>();

	private readonly _workspaceRoots: readonly URI[];

	/**
	 * List of calls to `stat`.
	 */
	public readonly statCallList: URI[] = [];

	constructor(
		documents: ReadonlyArray<InMemoryDocument | URI>,
		options?: {
			readonly roots: readonly URI[]
		}
	) {
		super();

		this._workspaceRoots = options?.roots ?? [workspaceRoot];

		for (const doc of documents) {
			if (doc instanceof InMemoryDocument) {
				this._documents.set(getDocUri(doc), doc);
			} else {
				this._additionalFiles.set(doc);
			}
		}
	}

	get workspaceFolders(): readonly URI[] {
		return this._workspaceRoots;
	}

	async stat(resource: URI): Promise<FileStat | undefined> {
		this.statCallList.push(resource);
		if (this._documents.has(resource) || this._additionalFiles.has(resource)) {
			return { isDirectory: false };
		}

		const pathPrefix = resource.fsPath + (resource.fsPath.endsWith('/') || resource.fsPath.endsWith('\\') ? '' : path.sep);
		const allPaths = this._getAllKnownFilePaths();
		if (allPaths.some(path => path.startsWith(pathPrefix))) {
			return { isDirectory: true };
		}

		return undefined;
	}

	public values() {
		return Array.from(this._documents.values());
	}

	public async getAllMarkdownDocuments() {
		return this.values();
	}

	public async openMarkdownDocument(resource: URI): Promise<ITextDocument | undefined> {
		return this._documents.get(resource);
	}

	public hasMarkdownDocument(resolvedHrefPath: URI): boolean {
		return this._documents.has(resolvedHrefPath);
	}

	public async readDirectory(resource: URI): Promise<[string, FileStat][]> {
		const files = new Map<string, FileStat>();
		const pathPrefix = resource.fsPath + (resource.fsPath.endsWith('/') || resource.fsPath.endsWith('\\') ? '' : path.sep);
		const allPaths = this._getAllKnownFilePaths();
		for (const path of allPaths) {
			if (path.startsWith(pathPrefix)) {
				const parts = path.slice(pathPrefix.length).split(/\/|\\/g);
				files.set(parts[0], parts.length > 1 ? { isDirectory: true } : { isDirectory: false });
			}
		}
		return Array.from(files.entries());
	}

	private readonly _onDidChangeMarkdownDocumentEmitter = this._register(new Emitter<ITextDocument>());
	public onDidChangeMarkdownDocument = this._onDidChangeMarkdownDocumentEmitter.event;

	private readonly _onDidCreateMarkdownDocumentEmitter = this._register(new Emitter<ITextDocument>());
	public onDidCreateMarkdownDocument = this._onDidCreateMarkdownDocumentEmitter.event;

	private readonly _onDidDeleteMarkdownDocumentEmitter = this._register(new Emitter<URI>());
	public onDidDeleteMarkdownDocument = this._onDidDeleteMarkdownDocumentEmitter.event;

	private _getAllKnownFilePaths(): string[] {
		return [
			...Array.from(this._documents.values(), doc => getDocUri(doc).fsPath),
			...Array.from(this._additionalFiles.keys(), uri => uri.fsPath),
		];
	}

	public updateDocument(document: ITextDocument) {
		this._documents.set(getDocUri(document), document);
		this._onDidChangeMarkdownDocumentEmitter.fire(document);
	}

	public createDocument(document: ITextDocument) {
		assert.ok(!this._documents.has(getDocUri(document)));

		this._documents.set(getDocUri(document), document);
		this._onDidCreateMarkdownDocumentEmitter.fire(document);
	}

	public watchFile(resource: URI, options: FileWatcherOptions): IFileSystemWatcher {
		const entry = {
			resource,
			options,
			onDidCreate: new Emitter<URI>(),
			onDidChange: new Emitter<URI>(),
			onDidDelete: new Emitter<URI>(),
		};
		this._watchers.add(entry);
		return {
			onDidCreate: entry.onDidCreate.event,
			onDidChange: entry.onDidChange.event,
			onDidDelete: entry.onDidDelete.event,
			dispose: () => {
				this._watchers.delete(entry);
			}
		};
	}

	public triggerFileDelete(resource: URI) {
		for (const watcher of this._watchers) {
			if (watcher.resource.toString() === resource.toString()) {
				watcher.onDidDelete?.fire(watcher.resource);
			}
		}

		this._additionalFiles.delete(resource);
	}

	public deleteDocument(resource: URI) {
		this._documents.delete(resource);
		this._onDidDeleteMarkdownDocumentEmitter.fire(resource);
	}
}
