/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, CancellationTokenSource } from 'vscode-languageserver';
import { URI } from 'vscode-uri';
import { ITextDocument } from './types/textDocument';
import { Disposable } from './util/dispose';
import { lazy, Lazy } from './util/lazy';
import { ResourceMap } from './util/resourceMap';
import { IWorkspace } from './workspace';



/**
 * Cache of information per-document in the workspace.
 *
 * The values are computed lazily and invalidated when the document changes.
 */
export class MdDocumentInfoCache<T> extends Disposable {

	private readonly _cache = new ResourceMap<{
		readonly value: Lazy<Promise<T>>;
		readonly cts: CancellationTokenSource;
	}>();

	private readonly _loadingDocuments = new ResourceMap<Promise<ITextDocument | undefined>>();

	public constructor(
		private readonly workspace: IWorkspace,
		private readonly getValue: (document: ITextDocument, token: CancellationToken) => Promise<T>,
	) {
		super();

		this._register(this.workspace.onDidChangeMarkdownDocument(doc => this.invalidate(doc)));
		this._register(this.workspace.onDidDeleteMarkdownDocument(this.onDidDeleteDocument, this));
	}

	public async get(resource: URI): Promise<T | undefined> {
		let existing = this._cache.get(resource);
		if (existing) {
			return existing.value.value;
		}

		const doc = await this.loadDocument(resource);
		if (!doc) {
			return undefined;
		}

		// Check if we have invalidated
		existing = this._cache.get(resource);
		if (existing) {
			return existing.value.value;
		}

		return this.resetEntry(doc)?.value;
	}

	public async getForDocument(document: ITextDocument): Promise<T> {
		const existing = this._cache.get(URI.parse(document.uri));
		if (existing) {
			return existing.value.value;
		}
		return this.resetEntry(document).value;
	}

	private loadDocument(resource: URI): Promise<ITextDocument | undefined> {
		const existing = this._loadingDocuments.get(resource);
		if (existing) {
			return existing;
		}

		const p = this.workspace.openMarkdownDocument(resource);
		this._loadingDocuments.set(resource, p);
		p.finally(() => {
			this._loadingDocuments.delete(resource);
		});
		return p;
	}

	private resetEntry(document: ITextDocument): Lazy<Promise<T>> {
		// TODO: cancel old request?

		const cts = new CancellationTokenSource();
		const value = lazy(() => this.getValue(document, cts.token));
		this._cache.set(URI.parse(document.uri), { value, cts });
		return value;
	}

	private invalidate(document: ITextDocument): void {
		if (this._cache.has(URI.parse(document.uri))) {
			this.resetEntry(document);
		}
	}

	private onDidDeleteDocument(resource: URI) {
		const entry = this._cache.get(resource);
		if (entry) {
			entry.cts.cancel();
			entry.cts.dispose();
			this._cache.delete(resource);
		}
	}
}

/**
 * Cache of information across all markdown files in the workspace.
 *
 * Unlike {@link MdDocumentInfoCache}, the entries here are computed eagerly for every file in the workspace.
 * However the computation of the values is still lazy.
 */
export class MdWorkspaceInfoCache<T> extends Disposable {

	private readonly _cache = new ResourceMap<{
		readonly value: Lazy<Promise<T>>;
		readonly cts: CancellationTokenSource;
	}>();

	private _init?: Promise<void>;

	public constructor(
		private readonly _workspace: IWorkspace,
		private readonly _getValue: (document: ITextDocument, token: CancellationToken) => Promise<T>,
	) {
		super();

		this._register(this._workspace.onDidChangeMarkdownDocument(this.onDidChangeDocument, this));
		this._register(this._workspace.onDidCreateMarkdownDocument(this.onDidChangeDocument, this));
		this._register(this._workspace.onDidDeleteMarkdownDocument(this.onDidDeleteDocument, this));
	}

	public async entries(): Promise<Array<[URI, T]>> {
		await this.ensureInit();

		return Promise.all(Array.from(this._cache.entries(), async ([k, v]) => {
			return [k, await v.value.value];
		}));
	}

	public async values(): Promise<Array<T>> {
		await this.ensureInit();
		return Promise.all(Array.from(this._cache.entries(), x => x[1].value.value));
	}

	public async getForDocs(docs: readonly ITextDocument[]): Promise<T[]> {
		for (const doc of docs) {
			if (!this._cache.has(URI.parse(doc.uri))) {
				this.update(doc);
			}
		}

		return Promise.all(docs.map(doc => this._cache.get(URI.parse(doc.uri))!.value.value));
	}

	private async ensureInit(): Promise<void> {
		if (!this._init) {
			this._init = this.populateCache();
		}
		await this._init;
	}

	private async populateCache(): Promise<void> {
		const markdownDocuments = await this._workspace.getAllMarkdownDocuments();
		for (const document of markdownDocuments) {
			if (!this._cache.has(URI.parse(document.uri))) {
				this.update(document);
			}
		}
	}

	private update(document: ITextDocument): void {
		// TODO: cancel old request?

		const cts = new CancellationTokenSource();
		this._cache.set(URI.parse(document.uri), {
			value: lazy(() => this._getValue(document, cts.token)),
			cts
		});
	}

	private onDidChangeDocument(document: ITextDocument) {
		this.update(document);
	}

	private onDidDeleteDocument(resource: URI) {
		const entry = this._cache.get(resource);
		if (entry) {
			entry.cts.cancel();
			entry.cts.dispose();
			this._cache.delete(resource);
		}
	}
}
