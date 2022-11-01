/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, CancellationTokenSource } from 'vscode-languageserver';
import { URI } from 'vscode-uri';
import { getDocUri, ITextDocument } from './types/textDocument';
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
		private readonly _workspace: IWorkspace,
		private readonly _getValue: (document: ITextDocument, token: CancellationToken) => Promise<T>,
	) {
		super();

		this._register(this._workspace.onDidChangeMarkdownDocument(doc => this._invalidate(doc)));
		this._register(this._workspace.onDidDeleteMarkdownDocument(this._onDidDeleteDocument, this));
	}

	public async get(resource: URI): Promise<T | undefined> {
		let existing = this._cache.get(resource);
		if (existing) {
			return existing.value.value;
		}

		const doc = await this._loadDocument(resource);
		if (!doc) {
			return undefined;
		}

		// Check if we have invalidated
		existing = this._cache.get(resource);
		if (existing) {
			return existing.value.value;
		}

		return this._resetEntry(doc)?.value;
	}

	public async getForDocument(document: ITextDocument): Promise<T> {
		const existing = this._cache.get(getDocUri(document));
		if (existing) {
			return existing.value.value;
		}
		return this._resetEntry(document).value;
	}

	private _loadDocument(resource: URI): Promise<ITextDocument | undefined> {
		const existing = this._loadingDocuments.get(resource);
		if (existing) {
			return existing;
		}

		const p = this._workspace.openMarkdownDocument(resource);
		this._loadingDocuments.set(resource, p);
		p.finally(() => {
			this._loadingDocuments.delete(resource);
		});
		return p;
	}

	private _resetEntry(document: ITextDocument): Lazy<Promise<T>> {
		// TODO: cancel old request?

		const cts = new CancellationTokenSource();
		const value = lazy(() => this._getValue(document, cts.token));
		this._cache.set(getDocUri(document), { value, cts });
		return value;
	}

	private _invalidate(document: ITextDocument): void {
		if (this._cache.has(getDocUri(document))) {
			this._resetEntry(document);
		}
	}

	private _onDidDeleteDocument(resource: URI) {
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

		this._register(this._workspace.onDidChangeMarkdownDocument(this._onDidChangeDocument, this));
		this._register(this._workspace.onDidCreateMarkdownDocument(this._onDidChangeDocument, this));
		this._register(this._workspace.onDidDeleteMarkdownDocument(this._onDidDeleteDocument, this));
	}

	public async entries(): Promise<Array<[URI, T]>> {
		await this._ensureInit();

		return Promise.all(Array.from(this._cache.entries(), async ([k, v]) => {
			return [k, await v.value.value];
		}));
	}

	public async values(): Promise<Array<T>> {
		await this._ensureInit();
		return Promise.all(Array.from(this._cache.entries(), x => x[1].value.value));
	}

	public async getForDocs(docs: readonly ITextDocument[]): Promise<T[]> {
		for (const doc of docs) {
			if (!this._cache.has(getDocUri(doc))) {
				this._update(doc);
			}
		}

		return Promise.all(docs.map(doc => this._cache.get(getDocUri(doc))!.value.value));
	}

	private async _ensureInit(): Promise<void> {
		if (!this._init) {
			this._init = this._populateCache();
		}
		await this._init;
	}

	private async _populateCache(): Promise<void> {
		const markdownDocuments = await this._workspace.getAllMarkdownDocuments();
		for (const document of markdownDocuments) {
			if (!this._cache.has(getDocUri(document))) {
				this._update(document);
			}
		}
	}

	private _update(document: ITextDocument): void {
		// TODO: cancel old request?

		const cts = new CancellationTokenSource();
		this._cache.set(getDocUri(document), {
			value: lazy(() => this._getValue(document, cts.token)),
			cts
		});
	}

	private _onDidChangeDocument(document: ITextDocument) {
		this._update(document);
	}

	private _onDidDeleteDocument(resource: URI) {
		const entry = this._cache.get(resource);
		if (entry) {
			entry.cts.cancel();
			entry.cts.dispose();
			this._cache.delete(resource);
		}
	}
}
