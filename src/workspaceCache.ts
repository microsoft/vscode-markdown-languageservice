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



type GetValueFn<T> = (document: ITextDocument, token: CancellationToken) => Promise<T>;

/**
 * Cache of information per-document in the workspace.
 *
 * The values are computed lazily and invalidated when the document changes.
 */
export class MdDocumentInfoCache<T> extends Disposable {

	readonly #cache = new ResourceMap<{
		readonly value: Lazy<Promise<T>>;
		readonly cts: CancellationTokenSource;
	}>();

	readonly #loadingDocuments = new ResourceMap<Promise<ITextDocument | undefined>>();

	readonly #workspace: IWorkspace;
	readonly #getValue: GetValueFn<T>;

	public constructor(workspace: IWorkspace, getValue: GetValueFn<T>) {
		super();

		this.#workspace = workspace;
		this.#getValue = getValue;

		this._register(this.#workspace.onDidChangeMarkdownDocument(doc => this.#invalidate(doc)));
		this._register(this.#workspace.onDidDeleteMarkdownDocument(this.#onDidDeleteDocument, this));
	}

	public async get(resource: URI): Promise<T | undefined> {
		let existing = this.#cache.get(resource);
		if (existing) {
			return existing.value.value;
		}

		const doc = await this.#loadDocument(resource);
		if (!doc) {
			return undefined;
		}

		// Check if we have invalidated
		existing = this.#cache.get(resource);
		if (existing) {
			return existing.value.value;
		}

		return this.#resetEntry(doc)?.value;
	}

	public async getForDocument(document: ITextDocument): Promise<T> {
		const existing = this.#cache.get(getDocUri(document));
		if (existing) {
			return existing.value.value;
		}
		return this.#resetEntry(document).value;
	}

	#loadDocument(resource: URI): Promise<ITextDocument | undefined> {
		const existing = this.#loadingDocuments.get(resource);
		if (existing) {
			return existing;
		}

		const p = this.#workspace.openMarkdownDocument(resource);
		this.#loadingDocuments.set(resource, p);
		p.finally(() => {
			this.#loadingDocuments.delete(resource);
		});
		return p;
	}

	#resetEntry(document: ITextDocument): Lazy<Promise<T>> {
		// TODO: cancel old request?

		const cts = new CancellationTokenSource();
		const value = lazy(() => this.#getValue(document, cts.token));
		this.#cache.set(getDocUri(document), { value, cts });
		return value;
	}

	#invalidate(document: ITextDocument): void {
		if (this.#cache.has(getDocUri(document))) {
			this.#resetEntry(document);
		}
	}

	#onDidDeleteDocument(resource: URI) {
		const entry = this.#cache.get(resource);
		if (entry) {
			entry.cts.cancel();
			entry.cts.dispose();
			this.#cache.delete(resource);
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

	readonly #cache = new ResourceMap<{
		readonly value: Lazy<Promise<T>>;
		readonly cts: CancellationTokenSource;
	}>();

	#init?: Promise<void>;

	readonly #workspace: IWorkspace;
	readonly #getValue: GetValueFn<T>;

	public constructor(workspace: IWorkspace, getValue: GetValueFn<T>) {
		super();

		this.#workspace = workspace;
		this.#getValue = getValue;

		this._register(this.#workspace.onDidChangeMarkdownDocument(this.#onDidChangeDocument, this));
		this._register(this.#workspace.onDidCreateMarkdownDocument(this.#onDidChangeDocument, this));
		this._register(this.#workspace.onDidDeleteMarkdownDocument(this.#onDidDeleteDocument, this));
	}

	public async entries(): Promise<Array<[URI, T]>> {
		await this.#ensureInit();

		return Promise.all(Array.from(this.#cache.entries(), async ([k, v]) => {
			return [k, await v.value.value];
		}));
	}

	public async values(): Promise<Array<T>> {
		await this.#ensureInit();
		return Promise.all(Array.from(this.#cache.entries(), x => x[1].value.value));
	}

	public async getForDocs(docs: readonly ITextDocument[]): Promise<T[]> {
		for (const doc of docs) {
			if (!this.#cache.has(getDocUri(doc))) {
				this.#update(doc);
			}
		}

		return Promise.all(docs.map(doc => this.#cache.get(getDocUri(doc))!.value.value));
	}

	async #ensureInit(): Promise<void> {
		if (!this.#init) {
			this.#init = this.#populateCache();
		}
		await this.#init;
	}

	async #populateCache(): Promise<void> {
		const markdownDocuments = await this.#workspace.getAllMarkdownDocuments();
		for (const document of markdownDocuments) {
			if (!this.#cache.has(getDocUri(document))) {
				this.#update(document);
			}
		}
	}

	#update(document: ITextDocument): void {
		// TODO: cancel old request?

		const cts = new CancellationTokenSource();
		this.#cache.set(getDocUri(document), {
			value: lazy(() => this.#getValue(document, cts.token)),
			cts
		});
	}

	#onDidChangeDocument(document: ITextDocument) {
		this.#update(document);
	}

	#onDidDeleteDocument(resource: URI) {
		const entry = this.#cache.get(resource);
		if (entry) {
			entry.cts.cancel();
			entry.cts.dispose();
			this.#cache.delete(resource);
		}
	}
}
