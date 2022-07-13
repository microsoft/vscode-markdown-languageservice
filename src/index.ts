/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken, CompletionContext } from 'vscode-languageserver';
import * as lsp from 'vscode-languageserver-types';
import { MdLinkProvider } from './languageFeatures/documentLinks';
import { MdDocumentSymbolProvider } from './languageFeatures/documentSymbols';
import { MdFoldingProvider } from './languageFeatures/folding';
import { MdPathCompletionProvider } from './languageFeatures/pathCompletions';
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
export { FileStat, IWorkspace } from './workspace';

// Language service

export interface IMdLanguageService {

	/**
	 * Get all links of a markdown file.
	 *
	 * Note that you must invoke {@link resolveDocumentLink} on each link before executing the link.
	 */
	getDocumentLinks(document: ITextDocument, token: CancellationToken): Promise<lsp.DocumentLink[]>;

	/**
	 * Resolves a link from {@link getDocumentLinks}.
	 *
	 * This fills in the target on the link.
	 *
	 * @return The resolved link or `undefined` if the passed in link should be used
	 */
	resolveDocumentLink(link: lsp.DocumentLink, token: CancellationToken): Promise<lsp.DocumentLink | undefined>;

	/**
	 * Get the symbols of a markdown file.
	 *
	 * This currently returns the headers in the file.
	 */
	getDocumentSymbols(document: ITextDocument, token: CancellationToken): Promise<lsp.DocumentSymbol[]>;

	/**
	 * Get the folding ranges of a markdown file.
	 *
	 * This returns folding ranges for:
	 *
	 * - Header sections
	 * - Regions
	 * - List and other block element
	 */
	getFoldingRanges(document: ITextDocument, token: CancellationToken): Promise<lsp.FoldingRange[]>;

	/**
	 * Get the selection ranges of a markdown file.
	 */
	getSelectionRanges(document: ITextDocument, positions: lsp.Position[], token: CancellationToken): Promise<lsp.SelectionRange[] | undefined>;

	/**
	 * Get the symbols for all markdown files in the current workspace.
	 */
	getWorkspaceSymbols(query: string, token: CancellationToken): Promise<lsp.WorkspaceSymbol[]>;

	/**
	 * Get completions items at a given position in a markdown file.
	 */
	getCompletionItems(document: ITextDocument, position: lsp.Position, context: CompletionContext, token: CancellationToken): Promise<lsp.CompletionItem[]>;

	/**
	 * Dispose of the language service, freeing any associated resources.
	 */
	dispose(): void;
}

export interface LanguageServiceConfiguration {
	readonly workspace: IWorkspace;
	readonly parser: IMdParser;
	readonly logger: ILogger;
}

/**
 * Create a new instance of the language service.
 */
export function createLanguageService(config: LanguageServiceConfiguration): IMdLanguageService {
	const tocProvider = new MdTableOfContentsProvider(config.parser, config.workspace, config.logger);
	const docSymbolProvider = new MdDocumentSymbolProvider(tocProvider, config.logger);
	const smartSelectProvider = new MdSelectionRangeProvider(config.parser, tocProvider, config.logger);
	const foldingProvider = new MdFoldingProvider(config.parser, tocProvider, config.logger);
	const workspaceSymbolProvider = new MdWorkspaceSymbolProvider(config.workspace, docSymbolProvider);
	const linkProvider = new MdLinkProvider(config.parser, config.workspace, tocProvider, config.logger);
	const pathCompletionProvider = new MdPathCompletionProvider(config.workspace, config.parser, linkProvider);

	return Object.freeze<IMdLanguageService>({
		dispose: () => {
			tocProvider.dispose();
			workspaceSymbolProvider.dispose();
			linkProvider.dispose();
		},
		getDocumentLinks: linkProvider.provideDocumentLinks.bind(linkProvider),
		resolveDocumentLink: linkProvider.resolveDocumentLink.bind(linkProvider),
		getDocumentSymbols: docSymbolProvider.provideDocumentSymbols.bind(docSymbolProvider),
		getFoldingRanges: foldingProvider.provideFoldingRanges.bind(foldingProvider),
		getSelectionRanges: smartSelectProvider.provideSelectionRanges.bind(smartSelectProvider),
		getWorkspaceSymbols: workspaceSymbolProvider.provideWorkspaceSymbols.bind(workspaceSymbolProvider),
		getCompletionItems: pathCompletionProvider.provideCompletionItems.bind(pathCompletionProvider),
	});
}
