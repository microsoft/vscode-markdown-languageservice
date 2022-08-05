/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken, CompletionContext } from 'vscode-languageserver';
import * as lsp from 'vscode-languageserver-types';
import { URI } from 'vscode-uri';
import { getLsConfiguration } from './config';
import { MdDefinitionProvider } from './languageFeatures/definitions';
import { DiagnosticComputer, DiagnosticOptions, DiagnosticsManager, IPullDiagnosticsManager } from './languageFeatures/diagnostics';
import { createWorkspaceLinkCache, MdLinkProvider } from './languageFeatures/documentLinks';
import { MdDocumentSymbolProvider } from './languageFeatures/documentSymbols';
import { MdFileRenameProvider } from './languageFeatures/fileRename';
import { MdFoldingProvider } from './languageFeatures/folding';
import { MdPathCompletionProvider } from './languageFeatures/pathCompletions';
import { MdReferencesProvider } from './languageFeatures/references';
import { MdRenameProvider } from './languageFeatures/rename';
import { MdSelectionRangeProvider } from './languageFeatures/smartSelect';
import { MdWorkspaceSymbolProvider } from './languageFeatures/workspaceSymbols';
import { ILogger } from './logging';
import { IMdParser } from './parser';
import { MdTableOfContentsProvider } from './tableOfContents';
import { ITextDocument } from './types/textDocument';
import { isWorkspaceWithFileWatching, IWorkspace, IWorkspaceWithWatching } from './workspace';

export { DiagnosticCode, DiagnosticLevel, DiagnosticOptions } from './languageFeatures/diagnostics';
export { ILogger, LogLevel } from './logging';
export { IMdParser, Token } from './parser';
export { githubSlugifier, ISlugifier } from './slugify';
export { ITextDocument } from './types/textDocument';
export { FileStat, FileWatcherOptions, IWorkspace } from './workspace';
export { IWorkspaceWithWatching };

/**
 * Provides language tooling methods for working with markdown.
 */
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
	 * Get the references to a symbol at the current location.
	 *
	 * Supports finding references to headers and links.
	 */
	getReferences(document: ITextDocument, position: lsp.Position, context: lsp.ReferenceContext, token: CancellationToken): Promise<lsp.Location[]>;

	/**
	 * Get the references to a given file.
	 */
	getFileReferences(resource: URI, token: CancellationToken): Promise<lsp.Location[]>;

	/**
	 * Get the definition of the symbol at the current location.
	 *
	 * Supports finding headers from fragments links or reference link definitions.
	 */
	getDefinition(document: ITextDocument, position: lsp.Position, token: CancellationToken): Promise<lsp.Definition | undefined>;

	/**
	 * Prepare for showing rename UI.
	 *
	 * Indicates if rename is supported. If it is, returns the range of symbol being renamed as well as the placeholder to show to the user for the rename.
	 */
	prepareRename(document: ITextDocument, position: lsp.Position, token: CancellationToken): Promise<{ range: lsp.Range; placeholder: string } | undefined>;

	/**
	 * Get the edits for a rename operation.
	 *
	 * @return A workspace edit that performs the rename or undefined if the rename cannot be performed.
	 */
	getRenameEdit(document: ITextDocument, position: lsp.Position, nameName: string, token: CancellationToken): Promise<lsp.WorkspaceEdit | undefined>;

	/**
	 * Get the edits for a file rename. This update links to the renamed files as well as links within the renamed files.
	 *
	 * This should be invoked after the rename has already happened.
	 *
	 * @return A workspace edit that performs the rename or undefined if the rename cannot be performed.
	 */
	getRenameFilesInWorkspaceEdit(edits: Iterable<{ readonly oldUri: URI; readonly newUri: URI }>, token: CancellationToken): Promise<lsp.WorkspaceEdit | undefined>;

	/**
	 * Compute diagnostics for a given file.
	 *
	 * Note that this function is stateless and revalidated all links every time you make the request. Use {@link createPullDiagnosticsManager}
	 * to more efficiently get diagnostics.
	 */
	computeDiagnostics(doc: ITextDocument, options: DiagnosticOptions, token: CancellationToken): Promise<lsp.Diagnostic[]>;

	/**
	 * Create a stateful object that is more efficient at computing diagnostics across repeated calls and workspace changes.
	 *
	 * This requires a {@link IWorkspace workspace} that {@link IWorkspaceWithWatching supports file watching}.
	 *
	 * Note that you must dispose of the returned object once you are done using it.
	 */
	createPullDiagnosticsManager(): IPullDiagnosticsManager;

	/**
	 * Dispose of the language service, freeing any associated resources.
	 */
	dispose(): void;
}

export interface LanguageServiceInitialization {
	// Services

	readonly workspace: IWorkspace;
	readonly parser: IMdParser;
	readonly logger: ILogger;

	// Config

	/**
	 * List of file extensions should be considered as markdown.
	 *
	 * These should not include the leading `.`.
	 *
	 * @default ['md']
	 */
	readonly markdownFileExtensions?: readonly string[];
}

/**
 * Create a new instance of the language service.
 */
export function createLanguageService(init: LanguageServiceInitialization): IMdLanguageService {
	const config = getLsConfiguration(init);
	const logger = init.logger;

	const tocProvider = new MdTableOfContentsProvider(init.parser, init.workspace, logger);
	const docSymbolProvider = new MdDocumentSymbolProvider(tocProvider, logger);
	const smartSelectProvider = new MdSelectionRangeProvider(init.parser, tocProvider, logger);
	const foldingProvider = new MdFoldingProvider(init.parser, tocProvider, logger);
	const workspaceSymbolProvider = new MdWorkspaceSymbolProvider(init.workspace, docSymbolProvider);
	const linkProvider = new MdLinkProvider(init.parser, init.workspace, tocProvider, logger);
	const pathCompletionProvider = new MdPathCompletionProvider(config, init.workspace, init.parser, linkProvider);
	const linkCache = createWorkspaceLinkCache(init.parser, init.workspace);
	const referencesProvider = new MdReferencesProvider(config, init.parser, init.workspace, tocProvider, linkCache, logger);
	const definitionsProvider = new MdDefinitionProvider(config, init.workspace, tocProvider, linkCache);
	const renameProvider = new MdRenameProvider(config, init.workspace, referencesProvider, init.parser.slugifier);
	const fileRenameProvider = new MdFileRenameProvider(config, init.workspace, linkCache, referencesProvider);
	const diagnosticsComputer = new DiagnosticComputer(config, init.workspace, linkProvider, tocProvider);

	return Object.freeze<IMdLanguageService>({
		dispose: () => {
			linkCache.dispose();
			tocProvider.dispose();
			workspaceSymbolProvider.dispose();
			linkProvider.dispose();
			referencesProvider.dispose();
		},
		getDocumentLinks: linkProvider.provideDocumentLinks.bind(linkProvider),
		resolveDocumentLink: linkProvider.resolveDocumentLink.bind(linkProvider),
		getDocumentSymbols: docSymbolProvider.provideDocumentSymbols.bind(docSymbolProvider),
		getFoldingRanges: foldingProvider.provideFoldingRanges.bind(foldingProvider),
		getSelectionRanges: smartSelectProvider.provideSelectionRanges.bind(smartSelectProvider),
		getWorkspaceSymbols: workspaceSymbolProvider.provideWorkspaceSymbols.bind(workspaceSymbolProvider),
		getCompletionItems: pathCompletionProvider.provideCompletionItems.bind(pathCompletionProvider),
		getReferences: referencesProvider.provideReferences.bind(referencesProvider),
		getFileReferences: async (resource: URI, token: CancellationToken): Promise<lsp.Location[]> => {
			return (await referencesProvider.getReferencesToFileInWorkspace(resource, token)).map(x => x.location);
		},
		getDefinition: definitionsProvider.provideDefinition.bind(definitionsProvider),
		prepareRename: renameProvider.prepareRename.bind(renameProvider),
		getRenameEdit: renameProvider.provideRenameEdits.bind(renameProvider),
		getRenameFilesInWorkspaceEdit: fileRenameProvider.getRenameFilesInWorkspaceEdit.bind(fileRenameProvider),
		computeDiagnostics: async (doc: ITextDocument, options: DiagnosticOptions, token: CancellationToken): Promise<lsp.Diagnostic[]> => {
			return (await diagnosticsComputer.compute(doc, options, token))?.diagnostics;
		},
		createPullDiagnosticsManager: () => {
			if (!isWorkspaceWithFileWatching(init.workspace)) {
				throw new Error(`Workspace does not support file watching. Diagnostics manager not supported`);
			}
			return new DiagnosticsManager(config, init.workspace, linkProvider, tocProvider);
		}
	});
}
