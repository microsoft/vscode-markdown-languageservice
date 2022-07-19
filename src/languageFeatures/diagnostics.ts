/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as picomatch from 'picomatch';
import { CancellationToken, DiagnosticSeverity, Emitter } from 'vscode-languageserver';
import * as lsp from 'vscode-languageserver-types';
import * as nls from 'vscode-nls';
import { URI } from 'vscode-uri';
import { LsConfiguration } from '../config';
import { MdTableOfContentsProvider } from '../tableOfContents';
import { translatePosition } from '../types/position';
import { modifyRange } from '../types/range';
import { ITextDocument } from '../types/textDocument';
import { Disposable, IDisposable } from '../util/dispose';
import { looksLikeMarkdownPath } from '../util/file';
import { Limiter } from '../util/limiter';
import { ResourceMap } from '../util/resourceMap';
import { IWorkspace, IWorkspaceWithWatching as IWorkspaceWithFileWatching, statLinkToMarkdownFile } from '../workspace';
import { InternalHref, LinkDefinitionSet, MdLink, MdLinkProvider, MdLinkSource } from './documentLinks';

const localize = nls.loadMessageBundle();


export enum DiagnosticLevel {
	ignore = 'ignore',
	warning = 'warning',
	error = 'error',
}

export interface DiagnosticOptions {
	readonly validateReferences: DiagnosticLevel | undefined;
	readonly validateFragmentLinks: DiagnosticLevel | undefined;
	readonly validateFileLinks: DiagnosticLevel | undefined;
	readonly validateMarkdownFileLinkFragments: DiagnosticLevel | undefined;
	readonly ignoreLinks: readonly string[];
}

function toSeverity(level: DiagnosticLevel | undefined): DiagnosticSeverity | undefined {
	switch (level) {
		case DiagnosticLevel.error: return DiagnosticSeverity.Error;
		case DiagnosticLevel.warning: return DiagnosticSeverity.Warning;
		case DiagnosticLevel.ignore: return undefined;
		case undefined: return undefined;
	}
}


export enum DiagnosticCode {
	link_noSuchReferences = 'link.no-such-reference',
	link_noSuchHeaderInOwnFile = 'link.no-such-header-in-own-file',
	link_NoSuchFile = 'link.no-such-file',
	link_noSuchHeaderInFile = 'link.no-such-header-in-file',
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
			if (link.href.kind !== 'internal') {
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
		private readonly configuration: LsConfiguration,
		private readonly workspace: IWorkspace,
		private readonly linkProvider: MdLinkProvider,
		private readonly tocProvider: MdTableOfContentsProvider,
	) { }

	public async compute(
		doc: ITextDocument,
		options: DiagnosticOptions,
		knownFileLinks: ResourceMap<{ readonly exists: boolean }>,
		token: CancellationToken,
	): Promise<{
		readonly diagnostics: lsp.Diagnostic[];
		readonly links: readonly MdLink[];
		readonly invalidFiles: ResourceMap<void>;
	}> {
		const { links, definitions } = await this.linkProvider.getLinks(doc);
		const invalidFiles = new ResourceMap<void>();

		if (token.isCancellationRequested) {
			return { links, diagnostics: [], invalidFiles };
		}

		return {
			links: links,
			invalidFiles,
			diagnostics: (await Promise.all([
				this.validateFileLinks(options, links, knownFileLinks, invalidFiles, token),
				Array.from(this.validateReferenceLinks(options, links, definitions)),
				this.validateFragmentLinks(doc, options, links, token),
			])).flat()
		};
	}

	private async validateFragmentLinks(doc: ITextDocument, options: DiagnosticOptions, links: readonly MdLink[], token: CancellationToken): Promise<lsp.Diagnostic[]> {
		const severity = toSeverity(options.validateFragmentLinks);
		if (typeof severity === 'undefined') {
			return [];
		}

		const toc = await this.tocProvider.getForDocument(doc);
		if (token.isCancellationRequested) {
			return [];
		}

		const diagnostics: lsp.Diagnostic[] = [];
		for (const link of links) {
			if (link.href.kind === 'internal'
				&& link.source.hrefText.startsWith('#')
				&& link.href.path.toString() === doc.uri.toString()
				&& link.href.fragment
				&& !toc.lookup(link.href.fragment)
			) {
				if (!this.isIgnoredLink(options, link.source.hrefText)) {
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

	private *validateReferenceLinks(options: DiagnosticOptions, links: readonly MdLink[], definitions: LinkDefinitionSet): Iterable<lsp.Diagnostic> {
		const severity = toSeverity(options.validateReferences);
		if (typeof severity === 'undefined') {
			return [];
		}

		for (const link of links) {
			if (link.href.kind === 'reference' && !definitions.lookup(link.href.ref)) {
				yield {
					code: DiagnosticCode.link_noSuchReferences,
					message: localize('invalidReferenceLink', 'No link definition found: \'{0}\'', link.href.ref),
					range: link.source.hrefRange,
					severity,
					data: {
						ref: link.href.ref,
					},
				}
			}
		}
	}

	private async validateFileLinks(
		options: DiagnosticOptions,
		links: readonly MdLink[],
		fileLinkCache: ResourceMap<{ readonly exists: boolean }>,
		invalidFiles: ResourceMap<void>,
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

					const resolvedHrefPath = await statLinkToMarkdownFile(this.workspace, path, fileLinkCache);
					if (!resolvedHrefPath) {
						for (const link of links) {
							invalidFiles.set(path);
							if (!this.isIgnoredLink(options, link.source.pathText)) {
								diagnostics.push({
									code: DiagnosticCode.link_NoSuchFile,
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
					} else if (typeof fragmentErrorSeverity !== 'undefined' && this.isMarkdownPath(resolvedHrefPath)) {
						// Validate each of the links to headers in the file
						const fragmentLinks = links.filter(x => x.fragment);
						if (fragmentLinks.length) {
							const toc = await this.tocProvider.get(resolvedHrefPath);
							for (const link of fragmentLinks) {
								if (!toc.lookup(link.fragment) && !this.isIgnoredLink(options, link.source.pathText) && !this.isIgnoredLink(options, link.source.hrefText)) {
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

	private isMarkdownPath(resolvedHrefPath: URI) {
		return this.workspace.hasMarkdownDocument(resolvedHrefPath) || looksLikeMarkdownPath(this.configuration, resolvedHrefPath);
	}

	private isIgnoredLink(options: DiagnosticOptions, link: string): boolean {
		return options.ignoreLinks.some(glob => picomatch.isMatch(link, glob));
	}
}


export interface IPullDiagnosticsManager extends IDisposable {
	computeDiagnostics(doc: ITextDocument, options: DiagnosticOptions, token: CancellationToken): Promise<lsp.Diagnostic[]>;
}

class LinkWatcher extends Disposable {

	private readonly _onDidChangeLinkedToFile = this._register(new Emitter<{ linkingFiles: Iterable<URI>; exists: boolean }>);
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
		readonly _workspace: IWorkspaceWithFileWatching
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
	updateLinksForDocument(document: URI, links: readonly MdLink[], invalidFiles: ResourceMap<void>) {
		const linkedToResource = new Set<{ path: URI; exists: boolean }>(
			links
				.filter(link => link.href.kind === 'internal')
				.map(link => ({ path: (link.href as InternalHref).path, exists: !invalidFiles.has((link.href as InternalHref).path) })));

		// First decrement watcher counter for previous document state
		for (const entry of this._linkedToFile.values()) {
			entry.documents.delete(document);
		}

		// Then create/update watchers for new document state
		for (const { path, exists } of linkedToResource) {
			let entry = this._linkedToFile.get(path);
			if (!entry) {
				entry = {
					watcher: this.startWatching(path),
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

	deleteDocument(resource: URI) {
		this.updateLinksForDocument(resource, [], new ResourceMap());
	}

	allKnownFileLinksInDoc(docUri: URI): ResourceMap<{ readonly exists: boolean }> {
		const result = new ResourceMap<{ readonly exists: boolean }>();
		for (const [link, data] of this._linkedToFile.entries()) {
			if (data.documents.has(docUri)) {
				result.set(link, { exists: data.exists });
			}
		}
		return result;
	}

	private startWatching(path: URI): IDisposable {
		const watcher = this._workspace.watchFile(path, { ignoreChange: true });
		const deleteReg = watcher.onDidDelete((resource: URI) => this.onLinkedResourceChanged(resource, false));
		const createReg = watcher.onDidCreate((resource: URI) => this.onLinkedResourceChanged(resource, true))
		return {
			dispose: () => {
				watcher.dispose();
				deleteReg.dispose();
				createReg.dispose();
			}
		};
	}

	private onLinkedResourceChanged(resource: URI, exists: boolean) {
		const entry = this._linkedToFile.get(resource);
		if (entry) {
			entry.exists = exists;
			this._onDidChangeLinkedToFile.fire({ linkingFiles: entry.documents.values(), exists });
		}
	}
}

export class DiagnosticsManager extends Disposable implements IPullDiagnosticsManager {

	private readonly _linkWatcher: LinkWatcher;

	constructor(
		_workspace: IWorkspaceWithFileWatching,
		private readonly _computer: DiagnosticComputer,
	) {
		super();

		this._linkWatcher = this._register(new LinkWatcher(_workspace));

	}

	async computeDiagnostics(doc: ITextDocument, options: DiagnosticOptions, token: CancellationToken): Promise<lsp.Diagnostic[]> {
		const uri = URI.parse(doc.uri);

		const results = await this._computer.compute(doc, options, this._linkWatcher.allKnownFileLinksInDoc(uri), token);
		this._linkWatcher.updateLinksForDocument(uri, results.links, results.invalidFiles)
		return results.diagnostics;
	}
}