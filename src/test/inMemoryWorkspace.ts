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

	readonly #documents = new ResourceMap<ITextDocument>(uri => uri.fsPath);
	readonly #additionalFiles = new ResourceMap<void>();

	readonly #watchers = new Set<{
		readonly resource: URI;
		readonly options: FileWatcherOptions;
		readonly onDidChange: Emitter<URI>;
		readonly onDidCreate: Emitter<URI>;
		readonly onDidDelete: Emitter<URI>;
	}>();

	readonly #workspaceRoots: readonly URI[];

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

		this.#workspaceRoots = options?.roots ?? [workspaceRoot];

		for (const doc of documents) {
			if (doc instanceof InMemoryDocument) {
				this.#documents.set(getDocUri(doc), doc);
			} else {
				this.#additionalFiles.set(doc);
			}
		}
	}

	get workspaceFolders(): readonly URI[] {
		return this.#workspaceRoots;
	}

	async stat(resource: URI): Promise<FileStat | undefined> {
		this.statCallList.push(resource);
		if (this.#documents.has(resource) || this.#additionalFiles.has(resource)) {
			return { isDirectory: false };
		}

		const pathPrefix = resource.fsPath + (resource.fsPath.endsWith('/') || resource.fsPath.endsWith('\\') ? '' : path.sep);
		const allPaths = this.#getAllKnownFilePaths();
		if (allPaths.some(path => path.startsWith(pathPrefix))) {
			return { isDirectory: true };
		}

		return undefined;
	}

	public values() {
		return Array.from(this.#documents.values());
	}

	public async getAllMarkdownDocuments() {
		return this.values();
	}

	public async openMarkdownDocument(resource: URI): Promise<ITextDocument | undefined> {
		return this.#documents.get(resource);
	}

	public hasMarkdownDocument(resolvedHrefPath: URI): boolean {
		return this.#documents.has(resolvedHrefPath);
	}

	public async readDirectory(resource: URI): Promise<[string, FileStat][]> {
		const files = new Map<string, FileStat>();
		const pathPrefix = resource.fsPath + (resource.fsPath.endsWith('/') || resource.fsPath.endsWith('\\') ? '' : path.sep);
		const allPaths = this.#getAllKnownFilePaths();
		for (const path of allPaths) {
			if (path.startsWith(pathPrefix)) {
				const parts = path.slice(pathPrefix.length).split(/\/|\\/g);
				files.set(parts[0], parts.length > 1 ? { isDirectory: true } : { isDirectory: false });
			}
		}
		return Array.from(files.entries());
	}

	readonly #onDidChangeMarkdownDocumentEmitter = this._register(new Emitter<ITextDocument>());
	public onDidChangeMarkdownDocument = this.#onDidChangeMarkdownDocumentEmitter.event;

	readonly #onDidCreateMarkdownDocumentEmitter = this._register(new Emitter<ITextDocument>());
	public onDidCreateMarkdownDocument = this.#onDidCreateMarkdownDocumentEmitter.event;

	readonly #onDidDeleteMarkdownDocumentEmitter = this._register(new Emitter<URI>());
	public onDidDeleteMarkdownDocument = this.#onDidDeleteMarkdownDocumentEmitter.event;

	#getAllKnownFilePaths(): string[] {
		return [
			...Array.from(this.#documents.values(), doc => getDocUri(doc).fsPath),
			...Array.from(this.#additionalFiles.keys(), uri => uri.fsPath),
		];
	}

	public updateDocument(document: ITextDocument) {
		this.#documents.set(getDocUri(document), document);
		this.#onDidChangeMarkdownDocumentEmitter.fire(document);
	}

	public createDocument(document: ITextDocument) {
		assert.ok(!this.#documents.has(getDocUri(document)));

		this.#documents.set(getDocUri(document), document);
		this.#onDidCreateMarkdownDocumentEmitter.fire(document);
	}

	public watchFile(resource: URI, options: FileWatcherOptions): IFileSystemWatcher {
		const entry = {
			resource,
			options,
			onDidCreate: new Emitter<URI>(),
			onDidChange: new Emitter<URI>(),
			onDidDelete: new Emitter<URI>(),
		};
		this.#watchers.add(entry);
		return {
			onDidCreate: entry.onDidCreate.event,
			onDidChange: entry.onDidChange.event,
			onDidDelete: entry.onDidDelete.event,
			dispose: () => {
				this.#watchers.delete(entry);
			}
		};
	}

	public triggerFileDelete(resource: URI) {
		for (const watcher of this.#watchers) {
			if (watcher.resource.toString() === resource.toString()) {
				watcher.onDidDelete?.fire(watcher.resource);
			}
		}

		this.#additionalFiles.delete(resource);
	}

	public deleteDocument(resource: URI) {
		this.#documents.delete(resource);
		this.#onDidDeleteMarkdownDocumentEmitter.fire(resource);
	}
}
