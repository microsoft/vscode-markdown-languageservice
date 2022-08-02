/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { CancellationToken } from 'vscode-languageserver';
import * as lsp from 'vscode-languageserver-types';
import { LsConfiguration } from '../config';
import { MdTableOfContentsProvider } from '../tableOfContents';
import { rangeContains } from '../types/range';
import { ITextDocument } from '../types/textDocument';
import { IWorkspace, statLinkToMarkdownFile } from '../workspace';
import { MdWorkspaceInfoCache } from '../workspaceCache';
import { LinkDefinitionSet, MdLink } from './documentLinks';

export class MdDefinitionProvider {

	constructor(
		private readonly configuration: LsConfiguration,
		private readonly workspace: IWorkspace,
		private readonly tocProvider: MdTableOfContentsProvider,
		private readonly linkCache: MdWorkspaceInfoCache<readonly MdLink[]>,
	) { }

	async provideDefinition(document: ITextDocument, position: lsp.Position, token: CancellationToken): Promise<lsp.Definition | undefined> {
		const toc = await this.tocProvider.getForDocument(document);
		if (token.isCancellationRequested) {
			return [];
		}

		const header = toc.entries.find(entry => entry.line === position.line);
		if (header) {
			return header.headerLocation;
		}

		return this.getDefinitionOfLinkAtPosition(document, position, token);
	}

	private async getDefinitionOfLinkAtPosition(document: ITextDocument, position: lsp.Position, token: CancellationToken): Promise<lsp.Definition | undefined> {
		const docLinks = (await this.linkCache.getForDocs([document]))[0];

		for (const link of docLinks) {
			if (link.kind === 'definition' && rangeContains(link.ref.range, position)) {
				return this.getDefinitionOfRef(link.ref.text, docLinks);
			}
			if (rangeContains(link.source.hrefRange, position)) {
				return this.getDefinitionOfLink(link, docLinks, token);
			}
		}

		return undefined;
	}

	private async getDefinitionOfLink(sourceLink: MdLink, allLinksInFile: readonly MdLink[], token: CancellationToken): Promise<lsp.Definition | undefined> {
		if (sourceLink.href.kind === 'reference') {
			return this.getDefinitionOfRef(sourceLink.href.ref, allLinksInFile);
		}

		if (sourceLink.href.kind === 'external' || !sourceLink.href.fragment) {
			return undefined;
		}

		const resolvedResource = await statLinkToMarkdownFile(this.configuration, this.workspace, sourceLink.href.path);
		if (!resolvedResource || token.isCancellationRequested) {
			return undefined;
		}

		const toc = await this.tocProvider.get(resolvedResource);
		return toc.lookup(sourceLink.href.fragment)?.headerLocation;
	}

	private getDefinitionOfRef(ref: string, allLinksInFile: readonly MdLink[]) {
		const allDefinitions = new LinkDefinitionSet(allLinksInFile);
		const def = allDefinitions.lookup(ref);
		return def ? { range: def.source.range, uri: def.source.resource.toString() } : undefined;
	}
}
