/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as lsp from 'vscode-languageserver-protocol';
import { LsConfiguration } from '../config';
import { MdTableOfContentsProvider } from '../tableOfContents';
import { rangeContains } from '../types/range';
import { ITextDocument } from '../types/textDocument';
import { IWorkspace, statLinkToMarkdownFile } from '../workspace';
import { MdWorkspaceInfoCache } from '../workspaceCache';
import { HrefKind, LinkDefinitionSet, MdLink, MdLinkKind } from './documentLinks';

export class MdDefinitionProvider {

	readonly #configuration: LsConfiguration;
	readonly #workspace: IWorkspace;
	readonly #tocProvider: MdTableOfContentsProvider;
	readonly #linkCache: MdWorkspaceInfoCache<readonly MdLink[]>;

	constructor(
		configuration: LsConfiguration,
		workspace: IWorkspace,
		tocProvider: MdTableOfContentsProvider,
		linkCache: MdWorkspaceInfoCache<readonly MdLink[]>,
	) {
		this.#configuration = configuration;
		this.#workspace = workspace;
		this.#tocProvider = tocProvider;
		this.#linkCache = linkCache;
	}

	async provideDefinition(document: ITextDocument, position: lsp.Position, token: lsp.CancellationToken): Promise<lsp.Definition | undefined> {
		const toc = await this.#tocProvider.getForDocument(document);
		if (token.isCancellationRequested) {
			return [];
		}

		const header = toc.entries.find(entry => entry.line === position.line);
		if (header) {
			return header.headerLocation;
		}

		return this.#getDefinitionOfLinkAtPosition(document, position, token);
	}

	async #getDefinitionOfLinkAtPosition(document: ITextDocument, position: lsp.Position, token: lsp.CancellationToken): Promise<lsp.Definition | undefined> {
		const docLinks = (await this.#linkCache.getForDocs([document]))[0];

		for (const link of docLinks) {
			if (link.kind === MdLinkKind.Definition && rangeContains(link.ref.range, position)) {
				return this.#getDefinitionOfRef(link.ref.text, docLinks);
			}
			if (rangeContains(link.source.hrefRange, position)) {
				return this.#getDefinitionOfLink(link, docLinks, token);
			}
		}

		return undefined;
	}

	async #getDefinitionOfLink(sourceLink: MdLink, allLinksInFile: readonly MdLink[], token: lsp.CancellationToken): Promise<lsp.Definition | undefined> {
		if (sourceLink.href.kind === HrefKind.Reference) {
			return this.#getDefinitionOfRef(sourceLink.href.ref, allLinksInFile);
		}

		if (sourceLink.href.kind === HrefKind.External || !sourceLink.href.fragment) {
			return undefined;
		}

		const resolvedResource = await statLinkToMarkdownFile(this.#configuration, this.#workspace, sourceLink.href.path);
		if (!resolvedResource || token.isCancellationRequested) {
			return undefined;
		}

		const toc = await this.#tocProvider.get(resolvedResource);
		return toc?.lookup(sourceLink.href.fragment)?.headerLocation;
	}

	#getDefinitionOfRef(ref: string, allLinksInFile: readonly MdLink[]) {
		const allDefinitions = new LinkDefinitionSet(allLinksInFile);
		const def = allDefinitions.lookup(ref);
		return def ? { range: def.source.range, uri: def.source.resource.toString() } : undefined;
	}
}
