/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as l10n from '@vscode/l10n';
import * as path from 'path';
import * as lsp from 'vscode-languageserver-protocol';
import { URI, Utils } from 'vscode-uri';
import { LsConfiguration, defaultMarkdownFileExtension } from '../config';
import { ILogger, LogLevel } from '../logging';
import { ISlugifier } from '../slugify';
import { arePositionsEqual, translatePosition } from '../types/position';
import { makeRange, modifyRange, rangeContains } from '../types/range';
import { ITextDocument, getDocUri } from '../types/textDocument';
import { Disposable } from '../util/dispose';
import { WorkspaceEditBuilder } from '../util/editBuilder';
import { escapeForAngleBracketLink, needsAngleBracketLink } from '../util/mdLinks';
import { computeRelativePath } from '../util/path';
import { tryDecodeUri } from '../util/uri';
import { IWorkspace, statLinkToMarkdownFile } from '../workspace';
import { HrefKind, InternalHref, MdLink, MdLinkKind, MdLinkSource, resolveInternalDocumentLink } from './documentLinks';
import { MdHeaderReference, MdLinkReference, MdReference, MdReferenceKind, MdReferencesProvider } from './references';

export interface MdReferencesResponse {
	readonly references: readonly MdReference[];
	readonly triggerRef: MdReference;
}

/**
 * Error thrown when rename is not supported performed at the requested location.
 */
export class RenameNotSupportedAtLocationError extends Error {
	constructor() {
		super(l10n.t('Renaming is not supported here. Try renaming a header or link.'));
	}
}

export class MdRenameProvider extends Disposable {

	#cachedRefs?: {
		readonly resource: URI;
		readonly version: number;
		readonly position: lsp.Position;
		readonly triggerRef: MdReference;
		readonly references: MdReference[];
	} | undefined;

	readonly #configuration: LsConfiguration;
	readonly #workspace: IWorkspace;
	readonly #referencesProvider: MdReferencesProvider;
	readonly #slugifier: ISlugifier;
	readonly #logger: ILogger;

	public constructor(
		configuration: LsConfiguration,
		workspace: IWorkspace,
		referencesProvider: MdReferencesProvider,
		slugifier: ISlugifier,
		logger: ILogger,
	) {
		super();

		this.#configuration = configuration;
		this.#workspace = workspace;
		this.#referencesProvider = referencesProvider;
		this.#slugifier = slugifier;
		this.#logger = logger;
	}

	public async prepareRename(document: ITextDocument, position: lsp.Position, token: lsp.CancellationToken): Promise<undefined | { range: lsp.Range; placeholder: string }> {
		this.#logger.log(LogLevel.Debug, 'RenameProvider.prepareRename', { document: document.uri, version: document.version });

		const allRefsInfo = await this.#getAllReferences(document, position, token);
		if (token.isCancellationRequested) {
			return undefined;
		}

		if (!allRefsInfo || !allRefsInfo.references.length) {
			throw new RenameNotSupportedAtLocationError();
		}

		const triggerRef = allRefsInfo.triggerRef;
		switch (triggerRef.kind) {
			case MdReferenceKind.Header: {
				return { range: triggerRef.headerTextLocation.range, placeholder: triggerRef.headerText };
			}
			case MdReferenceKind.Link: {
				if (triggerRef.link.kind === MdLinkKind.Definition) {
					// We may have been triggered on the ref or the definition itself
					if (rangeContains(triggerRef.link.ref.range, position)) {
						return { range: triggerRef.link.ref.range, placeholder: triggerRef.link.ref.text };
					}
				}

				if (triggerRef.link.href.kind === HrefKind.External) {
					return { range: triggerRef.link.source.hrefRange, placeholder: document.getText(triggerRef.link.source.hrefRange) };
				}

				// See if we are renaming the fragment or the path
				const { fragmentRange } = triggerRef.link.source;
				if (fragmentRange && rangeContains(fragmentRange, position)) {
					const declaration = this.#findHeaderDeclaration(allRefsInfo.references);
					return {
						range: fragmentRange,
						placeholder: declaration ? declaration.headerText : document.getText(fragmentRange),
					};
				}

				const range = getFilePathRange(triggerRef.link);
				if (!range) {
					throw new RenameNotSupportedAtLocationError();
				}
				return { range, placeholder: tryDecodeUri(document.getText(range)) };
			}
		}
	}

	#findHeaderDeclaration(references: readonly MdReference[]): MdHeaderReference | undefined {
		return references.find(ref => ref.isDefinition && ref.kind === MdReferenceKind.Header) as MdHeaderReference | undefined;
	}

	public async provideRenameEdits(document: ITextDocument, position: lsp.Position, newName: string, token: lsp.CancellationToken): Promise<lsp.WorkspaceEdit | undefined> {
		this.#logger.log(LogLevel.Debug, 'RenameProvider.provideRenameEdits', { document: document.uri, version: document.version });

		const allRefsInfo = await this.#getAllReferences(document, position, token);
		if (token.isCancellationRequested || !allRefsInfo || !allRefsInfo.references.length) {
			return undefined;
		}

		const triggerRef = allRefsInfo.triggerRef;

		if (triggerRef.kind === MdReferenceKind.Link && (
			(triggerRef.link.kind === MdLinkKind.Definition && rangeContains(triggerRef.link.ref.range, position)) || triggerRef.link.href.kind === HrefKind.Reference
		)) {
			return this.#renameReferenceLinks(allRefsInfo, newName);
		} else if (triggerRef.kind === MdReferenceKind.Link && triggerRef.link.href.kind === HrefKind.External) {
			return this.#renameExternalLink(allRefsInfo, newName);
		} else if (triggerRef.kind === MdReferenceKind.Header || (triggerRef.kind === MdReferenceKind.Link && triggerRef.link.source.fragmentRange && rangeContains(triggerRef.link.source.fragmentRange, position) && (triggerRef.link.kind === MdLinkKind.Definition || triggerRef.link.kind === MdLinkKind.Link && triggerRef.link.href.kind === HrefKind.Internal))) {
			return this.#renameFragment(allRefsInfo, newName);
		} else if (triggerRef.kind === MdReferenceKind.Link && !(triggerRef.link.source.fragmentRange && rangeContains(triggerRef.link.source.fragmentRange, position)) && (triggerRef.link.kind === MdLinkKind.Link || triggerRef.link.kind === MdLinkKind.Definition) && triggerRef.link.href.kind === HrefKind.Internal) {
			return this.#renameFilePath(triggerRef.link.source.resource, triggerRef.link.href, allRefsInfo, newName, token);
		}

		return undefined;
	}

	async #renameFilePath(triggerDocument: URI, triggerHref: InternalHref, allRefsInfo: MdReferencesResponse, newName: string, token: lsp.CancellationToken): Promise<lsp.WorkspaceEdit> {
		const builder = new WorkspaceEditBuilder();

		const targetUri = await statLinkToMarkdownFile(this.#configuration, this.#workspace, triggerHref.path) ?? triggerHref.path;
		if (token.isCancellationRequested) {
			return builder.getEdit();
		}

		const rawNewFilePath = resolveInternalDocumentLink(triggerDocument, newName, this.#workspace);
		if (!rawNewFilePath) {
			return builder.getEdit();
		}

		let resolvedNewFilePath = rawNewFilePath.resource;
		if (!Utils.extname(resolvedNewFilePath)) {
			// If the newly entered path doesn't have a file extension but the original link did
			// tack on a .md file extension
			if (Utils.extname(targetUri)) {
				resolvedNewFilePath = resolvedNewFilePath.with({
					path: resolvedNewFilePath.path + '.' + (this.#configuration.markdownFileExtensions[0] ?? defaultMarkdownFileExtension)
				});
			}
		}

		// First rename the file
		if (await this.#workspace.stat(targetUri)) {
			builder.renameFile(targetUri, resolvedNewFilePath);
		}

		// Then update all refs to it
		for (const ref of allRefsInfo.references) {
			if (ref.kind === MdReferenceKind.Link) {
				const { range, newText } = this.#getLinkRenameEdit(ref, rawNewFilePath, newName);
				builder.replace(ref.link.source.resource, range, newText);
			}
		}

		return builder.getEdit();
	}

	#getLinkRenameEdit(ref: MdLinkReference, rawNewFilePath: { resource: URI; linkFragment: string; }, newName: string): lsp.TextEdit {
		// Try to preserve style of existing links
		const newLinkText = getLinkRenameText(this.#workspace, ref.link.source, rawNewFilePath.resource, newName.startsWith('./') || newName.startsWith('.\\'));

		return getLinkRenameEdit(ref.link, newLinkText ?? newName);
	}

	#renameFragment(allRefsInfo: MdReferencesResponse, newName: string): lsp.WorkspaceEdit {
		const slug = this.#slugifier.fromHeading(newName).value;

		const builder = new WorkspaceEditBuilder();
		for (const ref of allRefsInfo.references) {
			switch (ref.kind) {
				case MdReferenceKind.Header:
					builder.replace(URI.parse(ref.location.uri), ref.headerTextLocation.range, newName);
					break;

				case MdReferenceKind.Link:
					builder.replace(ref.link.source.resource, ref.link.source.fragmentRange ?? ref.location.range, !ref.link.source.fragmentRange || ref.link.href.kind === HrefKind.External ? newName : slug);
					break;
			}
		}
		return builder.getEdit();
	}

	#renameExternalLink(allRefsInfo: MdReferencesResponse, newName: string): lsp.WorkspaceEdit {
		const builder = new WorkspaceEditBuilder();
		for (const ref of allRefsInfo.references) {
			if (ref.kind === MdReferenceKind.Link) {
				builder.replace(ref.link.source.resource, ref.location.range, newName);
			}
		}
		return builder.getEdit();
	}

	#renameReferenceLinks(allRefsInfo: MdReferencesResponse, newName: string): lsp.WorkspaceEdit {
		const builder = new WorkspaceEditBuilder();

		for (const ref of allRefsInfo.references) {
			if (ref.kind === MdReferenceKind.Link) {
				if (ref.link.kind === MdLinkKind.Definition) {
					builder.replace(ref.link.source.resource, ref.link.ref.range, newName);
				} else {
					builder.replace(ref.link.source.resource, ref.link.source.fragmentRange ?? ref.location.range, newName);
				}
			}
		}

		return builder.getEdit();
	}

	async #getAllReferences(document: ITextDocument, position: lsp.Position, token: lsp.CancellationToken): Promise<MdReferencesResponse | undefined> {
		const version = document.version;

		if (this.#cachedRefs
			&& this.#cachedRefs.resource.fsPath === getDocUri(document).fsPath
			&& this.#cachedRefs.version === document.version
			&& arePositionsEqual(this.#cachedRefs.position, position)
		) {
			return this.#cachedRefs;
		}

		const references = await this.#referencesProvider.getReferencesAtPosition(document, position, token);
		if (token.isCancellationRequested) {
			return;
		}

		const triggerRef = references.find(ref => ref.isTriggerLocation);
		if (!triggerRef) {
			return undefined;
		}

		this.#cachedRefs = {
			resource: getDocUri(document),
			version,
			position,
			references,
			triggerRef
		};
		return this.#cachedRefs;
	}
}

export function getLinkRenameText(workspace: IWorkspace, source: MdLinkSource, newPath: URI, preferDotSlash = false): string | undefined {
	if (source.hrefText.startsWith('/')) {
		const root = resolveInternalDocumentLink(source.resource, '/', workspace);
		if (!root) {
			return undefined;
		}

		return '/' + path.posix.relative(root.resource.path, newPath.path);
	}

	return computeRelativePath(source.resource, newPath, preferDotSlash);
}

export function getFilePathRange(link: MdLink): lsp.Range {
	if (link.source.fragmentRange) {
		return modifyRange(link.source.hrefRange, undefined, translatePosition(link.source.fragmentRange.start, { characterDelta: -1 }));
	}
	return link.source.hrefRange;
}

function newPathWithFragmentIfNeeded(newPath: string, link: MdLink): string {
	if (link.href.kind === HrefKind.Internal && link.href.fragment) {
		return newPath + '#' + link.href.fragment;
	}
	return newPath;
}

export function getLinkRenameEdit(link: MdLink, newPathText: string): lsp.TextEdit {
	const linkRange = link.source.hrefRange;

	// TODO: this won't be correct if the file name contains `\`
	newPathText = newPathWithFragmentIfNeeded(newPathText.replace(/\\/g, '/'), link);

	if (link.source.isAngleBracketLink) {
		if (!needsAngleBracketLink(newPathText)) {
			// Remove the angle brackets
			const range = makeRange(
				translatePosition(linkRange.start, { characterDelta: -1 }),
				translatePosition(linkRange.end, { characterDelta: 1 }));

			return { range, newText: newPathText };
		} else {
			return { range: linkRange, newText: escapeForAngleBracketLink(newPathText) };
		}
	}

	// We might need to use angle brackets for the link
	if (needsAngleBracketLink(newPathText)) {
		return { range: linkRange, newText: `<${escapeForAngleBracketLink(newPathText)}>` };
	}

	return { range: linkRange, newText: newPathText };
}
