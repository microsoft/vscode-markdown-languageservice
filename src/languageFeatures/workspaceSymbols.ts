/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from 'vscode-languageserver';
import * as lsp from 'vscode-languageserver-types';
import { IWorkspace } from '..';
import { Disposable } from '../util/dispose';
import { MdWorkspaceInfoCache } from '../workspaceCache';
import { MdDocumentSymbolProvider } from './documentSymbols';

export class MdWorkspaceSymbolProvider extends Disposable {

	private readonly _cache: MdWorkspaceInfoCache<lsp.SymbolInformation[]>;

	public constructor(
		workspace: IWorkspace,
		symbolProvider: MdDocumentSymbolProvider,
	) {
		super();

		this._cache = this._register(new MdWorkspaceInfoCache(workspace, doc => symbolProvider.provideDocumentSymbolInformation(doc)));
	}

	public async provideWorkspaceSymbols(query: string, _token: CancellationToken): Promise<lsp.WorkspaceSymbol[]> {
		const allSymbols = (await this._cache.values()).flat();
		return allSymbols.filter(symbolInformation => symbolInformation.name.toLowerCase().indexOf(query.toLowerCase()) !== -1);
	}
}
