/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from 'vscode-languageserver';
import * as lsp from 'vscode-languageserver-types';
import { MdDocumentSymbolProvider } from './languageFeatures/documentSymbols';
import { MdFoldingProvider } from './languageFeatures/folding';
import { MdSelectionRangeProvider } from './languageFeatures/smartSelect';
import { MdWorkspaceSymbolProvider } from './languageFeatures/workspaceSymbols';
import { ILogger } from './logging';
import { IMdParser } from './parser';
import { MdTableOfContentsProvider } from './tableOfContents';
import { ITextDocument } from './types/textDocument';
import { IWorkspace } from './workspace';

export { InMemoryDocument } from './inMemoryDocument';
export { ILogger } from './logging';
export { IMdParser, Token } from './parser';
export { githubSlugifier, ISlugifier } from './slugify';
export { ITextDocument } from './types/textDocument';
export { IWorkspace } from './workspace';

// Language service

export interface IMdLanguageService {
	provideDocumentSymbols(document: ITextDocument, token: CancellationToken): Promise<lsp.DocumentSymbol[]>;

	provideFoldingRanges(document: ITextDocument, token: CancellationToken): Promise<lsp.FoldingRange[]>;

	provideSelectionRanges(document: ITextDocument, positions: lsp.Position[], token: CancellationToken): Promise<lsp.SelectionRange[] | undefined>;

	provideWorkspaceSymbols(query: string, token: CancellationToken): Promise<lsp.WorkspaceSymbol[]>;
}

export interface LanguageServiceConfiguration {
	readonly workspace: IWorkspace;
	readonly parser: IMdParser;
	readonly logger: ILogger
}

export function createLanguageService(config: LanguageServiceConfiguration): IMdLanguageService {
	const tocProvider = new MdTableOfContentsProvider(config.parser, config.workspace, config.logger);
	const docSymbolProvider = new MdDocumentSymbolProvider(tocProvider, config.logger);
	const smartSelectProvider = new MdSelectionRangeProvider(config.parser, tocProvider, config.logger);
	const foldingProvider = new MdFoldingProvider(config.parser, tocProvider, config.logger);
	const workspaceSymbolProvider = new MdWorkspaceSymbolProvider(config.workspace, docSymbolProvider);

	return Object.freeze<IMdLanguageService>({
		provideDocumentSymbols(document, _token) {
			return docSymbolProvider.provideDocumentSymbols(document);
		},
		provideFoldingRanges(document: ITextDocument, token: CancellationToken): Promise<lsp.FoldingRange[]> {
			return foldingProvider.provideFoldingRanges(document, token);
		},
		provideSelectionRanges(document: ITextDocument, positions: lsp.Position[], token: CancellationToken): Promise<lsp.SelectionRange[] | undefined> {
			return smartSelectProvider.provideSelectionRanges(document, positions, token);
		},
		provideWorkspaceSymbols(query: string, token: CancellationToken): Promise<lsp.WorkspaceSymbol[]> {
			return workspaceSymbolProvider.provideWorkspaceSymbols(query, token);
		}
	});
}
