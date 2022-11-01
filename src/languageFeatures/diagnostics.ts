/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as picomatch from 'picomatch';
import { CancellationToken, DiagnosticSeverity, Emitter, Event } from 'vscode-languageserver';
import * as lsp from 'vscode-languageserver-types';
import * as nls from 'vscode-nls';
import { URI } from 'vscode-uri';
import { LsConfiguration } from '../config';
import { MdTableOfContentsProvider } from '../tableOfContents';
import { translatePosition } from '../types/position';
import { modifyRange } from '../types/range';
import { getDocUri, ITextDocument } from '../types/textDocument';
import { Disposable, IDisposable } from '../util/dispose';
import { looksLikeMarkdownPath } from '../util/file';
import { Limiter } from '../util/limiter';
import { ResourceMap } from '../util/resourceMap';
import { FileStat, IWorkspace, IWorkspaceWithWatching, statLinkToMarkdownFile } from '../workspace';
import { HrefKind, InternalHref, LinkDefinitionSet, MdLink, MdLinkDefinition, MdLinkKind, MdLinkProvider, MdLinkSource, parseLocationInfoFromFragment, ReferenceLinkMap } from './documentLinks';

const localize = nls.loadMessageBundle();

/**
 * The severity at which diagnostics are reported
 */
export enum DiagnosticLevel {
	/** Don't report this diagnostic. */
	ignore = 'ignore',

	/**
	 * Report the diagnostic at a hint level.
	 * 
	 * Hints will typically not be directly reported by editors, but may show up as unused spans.
	 */
	hint = 'hint',

	/** Report the diagnostic as a warning. */
	warning = 'warning',

	/** Report the diagnostic as an error. */
	error = 'error',
}

/**
 * Configure how diagnostics are computed.
 */
export interface DiagnosticOptions {
	/**
	 * Diagnostic level for invalid reference links, e.g. `[text][no-such-ref]`.
	 */
	readonly validateReferences: DiagnosticLevel | undefined;

	/**
	 * Diagnostic level for fragments links to headers in the current file that don't exist, e.g. `[text](#no-such-header)`.
	 */
	readonly validateFragmentLinks: DiagnosticLevel | undefined;

	/**
	 * Diagnostic level for links to local files that don't exist, e.g. `[text](./no-such-file.png)`.
	 */
	readonly validateFileLinks: DiagnosticLevel | undefined;

	/**
	 * Diagnostic level for the fragment part of links to other local markdown files , e.g. `[text](./file.md#no-such-header)`.
	 */
	readonly validateMarkdownFileLinkFragments: DiagnosticLevel | undefined;

	/**
	 * Diagnostic level for link definitions that aren't used anywhere. `[never-used]: http://example.com`.
	 */
	readonly validateUnusedLinkDefinitions: DiagnosticLevel | undefined;

	/**
	 * Diagnostic level for duplicate link definitions.
	 */
	readonly validateDuplicateLinkDefinitions: DiagnosticLevel | undefined;

	/**
	 * Glob of links that should not be validated.
	 */
	readonly ignoreLinks: readonly string[];
}

function toSeverity(level: DiagnosticLevel | undefined): DiagnosticSeverity | undefined {
	switch (level) {
		case DiagnosticLevel.error: return DiagnosticSeverity.Error;
		case DiagnosticLevel.warning: return DiagnosticSeverity.Warning;
		case DiagnosticLevel.hint: return DiagnosticSeverity.Hint;
		case DiagnosticLevel.ignore: return undefined;
		case undefined: return undefined;
	}
}

/**
 * Error codes of Markdown diagnostics
 */
export enum DiagnosticCode {
	/** The linked to reference does not exist. */
	link_noSuchReferences = 'link.no-such-reference',

	/** The linked to heading does not exist in the current file. */
	link_noSuchHeaderInOwnFile = 'link.no-such-header-in-own-file',

	/** The linked to local file does not exist. */
	link_noSuchFile = 'link.no-such-file',

	/** The linked to heading does not exist in the another file. */
	link_noSuchHeaderInFile = 'link.no-such-header-in-file',

	/** The link definition is not used anywhere. */
	link_unusedDefinition = 'link.unused-definition',

	/** The link definition is not used anywhere. */
	link_duplicateDefinition = 'link.duplicate-definition',
}

/**
 * Map of file paths to markdown links to that file.
 */
class FileLinkMap {

	private readonly _filesToLinksMap = new ResourceMap<{
		readonly outgoingLinks: Array<{
			readonly source: MdLinkSource;
			readonly fragment: string;
		}>;
	}>();

	constructor(links: Iterable<MdLink>) {
		for (const link of links) {
			if (link.href.kind !== HrefKind.Internal) {
				continue;
			}

			const existingFileEntry = this._filesToLinksMap.get(link.href.path);
			const linkData = { source: link.source, fragment: link.href.fragment };
			if (existingFileEntry) {
				existingFileEntry.outgoingLinks.push(linkData);
			} else {
				this._filesToLinksMap.set(link.href.path, { outgoingLinks: [linkData] });
			}
		}
	}

	public get size(): number {
		return this._filesToLinksMap.size;
	}

	public entries() {
		return this._filesToLinksMap.entries();
	}
}

export class DiagnosticComputer {

	constructor(
		private readonly _configuration: LsConfiguration,
		private readonly _workspace: IWorkspace,
		private readonly _linkProvider: MdLinkProvider,
		private readonly _tocProvider: MdTableOfContentsProvider,
	) { }

	public async compute(
		doc: ITextDocument,
		options: DiagnosticOptions,
		token: CancellationToken,
	): Promise<{
		readonly diagnostics: lsp.Diagnostic[];
		readonly links: readonly MdLink[];
		readonly statCache: ResourceMap<{ readonly exists: boolean }>;
	}> {
		const { links, definitions } = await this._linkProvider.getLinks(doc);
		const statCache = new ResourceMap<{ readonly exists: boolean }>();
		if (token.isCancellationRequested) {
			return { links, diagnostics: [], statCache };
		}

		// Current doc always implicitly exists
		statCache.set(getDocUri(doc), { exists: true });

		return {
			links: links,
			statCache,
			diagnostics: (await Promise.all([
				this._validateFileLinks(options, links, statCache, token),
				this._validateFragmentLinks(doc, options, links, token),
				Array.from(this._validateReferenceLinks(options, links, definitions)),
				Array.from(this._validateUnusedLinkDefinitions(options, links)),
				Array.from(this._validateDuplicateLinkDefinitions(options, links)),
			])).flat()
		};
	}

	private async _validateFragmentLinks(doc: ITextDocument, options: DiagnosticOptions, links: readonly MdLink[], token: CancellationToken): Promise<lsp.Diagnostic[]> {
		const severity = toSeverity(options.validateFragmentLinks);
		if (typeof severity === 'undefined') {
			return [];
		}

		const toc = await this._tocProvider.getForDocument(doc);
		if (token.isCancellationRequested) {
			return [];
		}

		const diagnostics: lsp.Diagnostic[] = [];
		for (const link of links) {

			if (link.href.kind === HrefKind.Internal
				&& link.source.hrefText.startsWith('#')
				&& link.href.path.toString() === doc.uri.toString()
				&& link.href.fragment
				&& !toc.lookup(link.href.fragment)
			) {
				// Don't validate line number links
				if (parseLocationInfoFromFragment(link.href.fragment)) {
					continue;
				}

				if (!this._isIgnoredLink(options, link.source.hrefText)) {
					diagnostics.push({
						code: DiagnosticCode.link_noSuchHeaderInOwnFile,
						message: localize('invalidHeaderLink', 'No header found: \'{0}\'', link.href.fragment),
						range: link.source.hrefRange,
						severity,
						data: {
							hrefText: link.source.hrefText
						}
					});
				}
			}
		}

		return diagnostics;
	}

	private *_validateReferenceLinks(options: DiagnosticOptions, links: readonly MdLink[], definitions: LinkDefinitionSet): Iterable<lsp.Diagnostic> {
		const severity = toSeverity(options.validateReferences);
		if (typeof severity === 'undefined') {
			return [];
		}

		for (const link of links) {
			if (link.href.kind === HrefKind.Reference && !definitions.lookup(link.href.ref)) {
				yield {
					code: DiagnosticCode.link_noSuchReferences,
					message: localize('invalidReferenceLink', 'No link definition found: \'{0}\'', link.href.ref),
					range: link.source.hrefRange,
					severity,
					data: {
						ref: link.href.ref,
					},
				};
			}
		}
	}

	private *_validateUnusedLinkDefinitions(options: DiagnosticOptions, links: readonly MdLink[]): Iterable<lsp.Diagnostic> {
		const errorSeverity = toSeverity(options.validateUnusedLinkDefinitions);
		if (typeof errorSeverity === 'undefined') {
			return;
		}

		const usedRefs = new ReferenceLinkMap<boolean>();
		for (const link of links) {
			if (link.kind === MdLinkKind.Link && link.href.kind === HrefKind.Reference) {
				usedRefs.set(link.href.ref, true);
			}
		}

		for (const link of links) {
			if (link.kind === MdLinkKind.Definition && !usedRefs.lookup(link.ref.text)) {
				yield {
					code: DiagnosticCode.link_unusedDefinition,
					message: localize('unusedLinkDefinition', 'Link definition is unused'),
					range: link.source.range,
					severity: errorSeverity,
					tags: [
						lsp.DiagnosticTag.Unnecessary,
					],
					data: link
				};
			}
		}
	}
	
	private *_validateDuplicateLinkDefinitions(options: DiagnosticOptions, links: readonly MdLink[]): Iterable<lsp.Diagnostic> {
		const errorSeverity = toSeverity(options.validateDuplicateLinkDefinitions);
		if (typeof errorSeverity === 'undefined') {
			return;
		}

		const definitionMultiMap = new Map<string, MdLinkDefinition[]>();
		for (const link of links) {
			if (link.kind === MdLinkKind.Definition) {
				const existing = definitionMultiMap.get(link.ref.text);
				if (existing) {
					existing.push(link);
				} else {
					definitionMultiMap.set(link.ref.text, [link]);
				}
			}
		}

		for (const [ref, defs] of definitionMultiMap) {
			if (defs.length <= 1) {
				continue;
			}

			for (const duplicateDef of defs) {
				yield {
					code: DiagnosticCode.link_duplicateDefinition,
					message: localize('duplicateLinkDefinition', 'Link definition for \'{0}\' already exists', ref),
					range: duplicateDef.ref.range,
					severity: errorSeverity,
					relatedInformation:
						defs
							.filter(x => x !== duplicateDef)
							.map(def => lsp.DiagnosticRelatedInformation.create(
								{ uri: def.source.resource.toString(), range: def.ref.range },
								localize('duplicateLinkDefinitionRelated', 'Link is also defined here'),
							)),
					data: duplicateDef
				};
			}
		}
	}

	private async _validateFileLinks(
		options: DiagnosticOptions,
		links: readonly MdLink[],
		statCache: ResourceMap<{ readonly exists: boolean }>,
		token: CancellationToken,
	): Promise<lsp.Diagnostic[]> {
		const pathErrorSeverity = toSeverity(options.validateFileLinks);
		if (typeof pathErrorSeverity === 'undefined') {
			return [];
		}
		const fragmentErrorSeverity = toSeverity(typeof options.validateMarkdownFileLinkFragments === 'undefined' ? options.validateFragmentLinks : options.validateMarkdownFileLinkFragments);

		// We've already validated our own fragment links in `validateOwnHeaderLinks`
		const linkSet = new FileLinkMap(links.filter(link => !link.source.hrefText.startsWith('#')));
		if (linkSet.size === 0) {
			return [];
		}

		const limiter = new Limiter(10);

		const diagnostics: lsp.Diagnostic[] = [];
		await Promise.all(
			Array.from(linkSet.entries()).map(([path, { outgoingLinks: links }]) => {
				return limiter.queue(async () => {
					if (token.isCancellationRequested) {
						return;
					}

					const resolvedHrefPath = await statLinkToMarkdownFile(this._configuration, this._workspace, path, statCache);
					if (token.isCancellationRequested) {
						return;
					}

					if (!resolvedHrefPath) {
						for (const link of links) {
							if (!this._isIgnoredLink(options, link.source.pathText)) {
								diagnostics.push({
									code: DiagnosticCode.link_noSuchFile,
									message: localize('invalidPathLink', 'File does not exist at path: {0}', path.fsPath),
									range: link.source.hrefRange,
									severity: pathErrorSeverity,
									data: {
										fsPath: path.fsPath,
										hrefText: link.source.pathText,
									}
								});
							}
						}
					} else if (typeof fragmentErrorSeverity !== 'undefined' && this._isMarkdownPath(resolvedHrefPath)) {
						// Validate each of the links to headers in the file
						const fragmentLinks = links.filter(x => x.fragment);
						if (fragmentLinks.length) {
							const toc = await this._tocProvider.get(resolvedHrefPath);
							if (token.isCancellationRequested) {
								return;
							}
							
							for (const link of fragmentLinks) {
								// Don't validate line number links
								if (parseLocationInfoFromFragment(link.fragment)) {
									continue;
								}

								if (!toc.lookup(link.fragment) && !this._isIgnoredLink(options, link.source.pathText) && !this._isIgnoredLink(options, link.source.hrefText)) {
									const range = (link.source.fragmentRange && modifyRange(link.source.fragmentRange, translatePosition(link.source.fragmentRange.start, { characterDelta: -1 }), undefined)) ?? link.source.hrefRange;
									diagnostics.push({
										code: DiagnosticCode.link_noSuchHeaderInFile,
										message: localize('invalidLinkToHeaderInOtherFile', 'Header does not exist in file: {0}', link.fragment),
										range: range,
										severity: fragmentErrorSeverity,
										data: {
											fragment: link.fragment,
											hrefText: link.source.hrefText
										},
									});
								}
							}
						}
					}
				});
			}));
		return diagnostics;
	}

	private _isMarkdownPath(resolvedHrefPath: URI) {
		return this._workspace.hasMarkdownDocument(resolvedHrefPath) || looksLikeMarkdownPath(this._configuration, resolvedHrefPath);
	}

	private _isIgnoredLink(options: DiagnosticOptions, link: string): boolean {
		return options.ignoreLinks.some(glob => picomatch.isMatch(link, glob));
	}
}

/**
 * Stateful object that can more efficiently compute diagnostics for the workspace.
 */
export interface IPullDiagnosticsManager {

	/**
	 * Dispose of the diagnostic manager and clean up any associated resources.
	 */
	dispose(): void;

	/**
	 * Event fired when a file that Markdown document is linking to changes.
	 */
	readonly onLinkedToFileChanged: Event<{
		readonly changedResource: URI;
		readonly linkingResources: readonly URI[];
	}>;

	/**
	 * Compute the current diagnostics for a file.
	 */
	computeDiagnostics(doc: ITextDocument, options: DiagnosticOptions, token: CancellationToken): Promise<lsp.Diagnostic[]>;

	/**
	 * Clean up resources that help provide diagnostics for a document. 
	 * 
	 * You should call this when you will no longer be making diagnostic requests for a document, for example
	 * when the file has been closed in the editor (but still exists on disk).
	 */
	disposeDocumentResources(document: URI): void;
}

class FileLinkState extends Disposable {

	private readonly _onDidChangeLinkedToFile = this._register(new Emitter<{
		readonly changedResource: URI;
		readonly linkingFiles: Iterable<URI>;
		readonly exists: boolean;
	}>);
	/**
	 * Event fired with a list of document uri when one of the links in the document changes
	 */
	public readonly onDidChangeLinkedToFile = this._onDidChangeLinkedToFile.event;

	private readonly _linkedToFile = new ResourceMap<{
		/**
		 * Watcher for this link path
		 */
		readonly watcher: IDisposable;

		/**
		 * List of documents that reference the link
		 */
		readonly documents: ResourceMap</* document resource*/ URI>;

		exists: boolean;
	}>();

	constructor(
		private readonly _workspace: IWorkspaceWithWatching
	) {
		super();
	}

	override dispose() {
		super.dispose();

		for (const entry of this._linkedToFile.values()) {
			entry.watcher.dispose();
		}
		this._linkedToFile.clear();
	}

	/**
	 * Set the known links in a markdown document, adding and removing file watchers as needed
	 */
	updateLinksForDocument(document: URI, links: readonly MdLink[], statCache: ResourceMap<{ readonly exists: boolean }>) {
		const linkedToResource = new Set<{ path: URI; exists: boolean }>(
			links
				.filter(link => link.href.kind === HrefKind.Internal)
				.map(link => ({ path: (link.href as InternalHref).path, exists: !!(statCache.get((link.href as InternalHref).path)?.exists) })));

		// First decrement watcher counter for previous document state
		for (const entry of this._linkedToFile.values()) {
			entry.documents.delete(document);
		}

		// Then create/update watchers for new document state
		for (const { path, exists } of linkedToResource) {
			let entry = this._linkedToFile.get(path);
			if (!entry) {
				entry = {
					watcher: this._startWatching(path),
					documents: new ResourceMap(),
					exists
				};
				this._linkedToFile.set(path, entry);
			}

			entry.documents.set(document, document);
		}

		// Finally clean up watchers for links that are no longer are referenced anywhere
		for (const [key, value] of this._linkedToFile) {
			if (value.documents.size === 0) {
				value.watcher.dispose();
				this._linkedToFile.delete(key);
			}
		}
	}

	public deleteDocument(resource: URI) {
		this.updateLinksForDocument(resource, [], new ResourceMap());
	}

	public tryStatFileLink(link: URI): { exists: boolean } | undefined {
		const entry = this._linkedToFile.get(link);
		if (!entry) {
			return undefined;
		}
		return { exists: entry.exists };
	}

	private _startWatching(path: URI): IDisposable {
		const watcher = this._workspace.watchFile(path, { ignoreChange: true });
		const deleteReg = watcher.onDidDelete((resource: URI) => this._onLinkedResourceChanged(resource, false));
		const createReg = watcher.onDidCreate((resource: URI) => this._onLinkedResourceChanged(resource, true));
		return {
			dispose: () => {
				watcher.dispose();
				deleteReg.dispose();
				createReg.dispose();
			}
		};
	}

	private _onLinkedResourceChanged(resource: URI, exists: boolean) {
		const entry = this._linkedToFile.get(resource);
		if (entry) {
			entry.exists = exists;
			this._onDidChangeLinkedToFile.fire({
				changedResource: resource,
				linkingFiles: entry.documents.values(),
				exists,
			});
		}
	}
}

export class DiagnosticsManager extends Disposable implements IPullDiagnosticsManager {

	private readonly _computer: DiagnosticComputer;
	private readonly _linkWatcher: FileLinkState;

	private readonly _onLinkedToFileChanged = this._register(new Emitter<{
		readonly changedResource: URI;
		readonly linkingResources: readonly URI[];
	}>());
	public readonly onLinkedToFileChanged = this._onLinkedToFileChanged.event;

	constructor(
		configuration: LsConfiguration,
		workspace: IWorkspaceWithWatching,
		linkProvider: MdLinkProvider,
		tocProvider: MdTableOfContentsProvider
	) {
		super();

		const linkWatcher = new FileLinkState(workspace);
		this._linkWatcher = this._register(linkWatcher);

		this._register(this._linkWatcher.onDidChangeLinkedToFile(e => {
			this._onLinkedToFileChanged.fire({
				changedResource: e.changedResource,
				linkingResources: Array.from(e.linkingFiles),
			});
		}));

		const stateCachedWorkspace = new Proxy(workspace, {
			get(target, p, receiver) {
				if (p !== 'stat') {
					return (workspace as any)[p];
				}

				return async function (this: any, resource: URI): Promise<FileStat | undefined> {
					const stat = linkWatcher.tryStatFileLink(resource);
					if (stat) {
						if (stat.exists) {
							return { isDirectory: false };
						} else {
							return undefined;
						}
					}
					return workspace.stat.call(this === receiver ? target : this, resource);
				};
			},
		});

		this._computer = new DiagnosticComputer(configuration, stateCachedWorkspace, linkProvider, tocProvider);

		this._register(workspace.onDidDeleteMarkdownDocument(uri => {
			this._linkWatcher.deleteDocument(uri);
		}));
	}

	public async computeDiagnostics(doc: ITextDocument, options: DiagnosticOptions, token: CancellationToken): Promise<lsp.Diagnostic[]> {
		const results = await this._computer.compute(doc, options, token);
		if (token.isCancellationRequested) {
			return [];
		}

		this._linkWatcher.updateLinksForDocument(getDocUri(doc), results.links, results.statCache);
		return results.diagnostics;
	}

	public disposeDocumentResources(uri: URI): void {
		this._linkWatcher.deleteDocument(uri);
	}
}