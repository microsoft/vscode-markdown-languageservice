/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as path from 'path';
import { Emitter } from 'vscode-languageserver';
import { URI } from 'vscode-uri';
import { ITextDocument } from '../types/textDocument';
import { Disposable } from '../util/dispose';
import { ResourceMap } from '../util/resourceMap';
import { FileStat, IWorkspace } from '../workspace';


export class InMemoryWorkspace extends Disposable implements IWorkspace {
	private readonly _documents = new ResourceMap<ITextDocument>(uri => uri.fsPath);

	constructor(documents: ITextDocument[]) {
		super();
		for (const doc of documents) {
			this._documents.set(URI.parse(doc.uri), doc);
		}
	}

	get workspaceFolders(): readonly URI[] {
		return [
			URI.file('/workspace'),
		]
	}

	async stat(resource: URI): Promise<FileStat | undefined> {
		if (this._documents.has(resource)) {
			return { isDirectory: false }
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

	public async pathExists(resource: URI): Promise<boolean> {
		return this._documents.has(resource);
	}

	public async readDirectory(resource: URI): Promise<[string, FileStat][]> {
		const files = new Map<string, FileStat>();
		const pathPrefix = resource.fsPath + (resource.fsPath.endsWith('/') || resource.fsPath.endsWith('\\') ? '' : path.sep);
		for (const doc of this._documents.values()) {
			const path = URI.parse(doc.uri).fsPath;
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

	public updateDocument(document: ITextDocument) {
		this._documents.set(URI.parse(document.uri), document);
		this._onDidChangeMarkdownDocumentEmitter.fire(document);
	}

	public createDocument(document: ITextDocument) {
		assert.ok(!this._documents.has(URI.parse(document.uri)));

		this._documents.set(URI.parse(document.uri), document);
		this._onDidCreateMarkdownDocumentEmitter.fire(document);
	}

	public deleteDocument(resource: URI) {
		this._documents.delete(resource);
		this._onDidDeleteMarkdownDocumentEmitter.fire(resource);
	}
}
