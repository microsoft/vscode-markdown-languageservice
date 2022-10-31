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
import { HrefKind, LinkDefinitionSet, MdLink, MdLinkKind } from './documentLinks';

export class MdDefinitionProvider {

	constructor(
		private readonly _configuration: LsConfiguration,
		private readonly _workspace: IWorkspace,
		private readonly _tocProvider: MdTableOfContentsProvider,
		private readonly _linkCache: MdWorkspaceInfoCache<readonly MdLink[]>,
	) { }

	async provideDefinition(document: ITextDocument, position: lsp.Position, token: CancellationToken): Promise<lsp.Definition | undefined> {
		const toc = await this._tocProvider.getForDocument(document);
		if (token.isCancellationRequested) {
			return [];
		}

		const header = toc.entries.find(entry => entry.line === position.line);
		if (header) {
			return header.headerLocation;
		}

		return this._getDefinitionOfLinkAtPosition(document, position, token);
	}

	private async _getDefinitionOfLinkAtPosition(document: ITextDocument, position: lsp.Position, token: CancellationToken): Promise<lsp.Definition | undefined> {
		const docLinks = (await this._linkCache.getForDocs([document]))[0];

		for (const link of docLinks) {
			if (link.kind === MdLinkKind.Definition && rangeContains(link.ref.range, position)) {
				return this._getDefinitionOfRef(link.ref.text, docLinks);
			}
			if (rangeContains(link.source.hrefRange, position)) {
				return this._getDefinitionOfLink(link, docLinks, token);
			}
		}

		return undefined;
	}

	private async _getDefinitionOfLink(sourceLink: MdLink, allLinksInFile: readonly MdLink[], token: CancellationToken): Promise<lsp.Definition | undefined> {
		if (sourceLink.href.kind === HrefKind.Reference) {
			return this._getDefinitionOfRef(sourceLink.href.ref, allLinksInFile);
		}

		if (sourceLink.href.kind === HrefKind.External || !sourceLink.href.fragment) {
			return undefined;
		}

		const resolvedResource = await statLinkToMarkdownFile(this._configuration, this._workspace, sourceLink.href.path);
		if (!resolvedResource || token.isCancellationRequested) {
			return undefined;
		}

		const toc = await this._tocProvider.get(resolvedResource);
		return toc.lookup(sourceLink.href.fragment)?.headerLocation;
	}

	private _getDefinitionOfRef(ref: string, allLinksInFile: readonly MdLink[]) {
		const allDefinitions = new LinkDefinitionSet(allLinksInFile);
		const def = allDefinitions.lookup(ref);
		return def ? { range: def.source.range, uri: def.source.resource.toString() } : undefined;
	}
}
