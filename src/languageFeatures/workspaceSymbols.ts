/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from 'vscode-languageserver';
import * as lsp from 'vscode-languageserver-types';
import { ITextDocument } from '../types/textDocument';
import { Disposable } from '../util/dispose';
import { IWorkspace } from '../workspace';
import { MdWorkspaceInfoCache } from '../workspaceCache';
import { MdDocumentSymbolProvider } from './documentSymbols';

export class MdWorkspaceSymbolProvider extends Disposable {

	private readonly _cache: MdWorkspaceInfoCache<lsp.SymbolInformation[]>;

	public constructor(
		workspace: IWorkspace,
		private readonly symbolProvider: MdDocumentSymbolProvider,
	) {
		super();

		this._cache = this._register(new MdWorkspaceInfoCache(workspace, (doc, token) => this.provideDocumentSymbolInformation(doc, token)));
	}

	public async provideWorkspaceSymbols(query: string, token: CancellationToken): Promise<lsp.WorkspaceSymbol[]> {
		const allSymbols = await this._cache.values();
		if (token.isCancellationRequested) {
			return [];
		}

		const normalizedQueryStr = query.toLowerCase();
		return allSymbols.flat().filter(symbolInformation => symbolInformation.name.includes(normalizedQueryStr));
	}

	public async provideDocumentSymbolInformation(document: ITextDocument, token: CancellationToken): Promise<lsp.SymbolInformation[]> {
		const docSymbols = await this.symbolProvider.provideDocumentSymbols(document, {}, token);
		if (token.isCancellationRequested) {
			return [];
		}
		return Array.from(this.toSymbolInformation(document.uri, docSymbols));
	}

	private *toSymbolInformation(uri: string, docSymbols: lsp.DocumentSymbol[]): Iterable<lsp.SymbolInformation> {
		for (const symbol of docSymbols) {
			yield {
				name: symbol.name,
				kind: lsp.SymbolKind.String,
				location: { uri, range: symbol.selectionRange }
			};
			if (symbol.children) {
				yield* this.toSymbolInformation(uri, symbol.children);
			}
		}
	}
}
