/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from 'vscode-languageserver';
import * as lsp from 'vscode-languageserver-types';
import { URI } from 'vscode-uri';
import { LsConfiguration } from '../config';
import { MdTableOfContentsProvider, TableOfContents, TocEntry } from '../tableOfContents';
import { translatePosition } from '../types/position';
import { modifyRange, rangeContains } from '../types/range';
import { ITextDocument } from '../types/textDocument';
import { tryAppendMarkdownFileExtension } from '../workspace';
import { HrefKind, InternalHref, looksLikeLinkToResource, MdLink, MdLinkKind, MdLinkProvider } from './documentLinks';
import { getFilePathRange } from './rename';

export class MdDocumentHighlightProvider {

	constructor(
		private readonly _configuration: LsConfiguration,
		private readonly _tocProvider: MdTableOfContentsProvider,
		private readonly _linkProvider: MdLinkProvider,
	) { }

	public async getDocumentHighlights(document: ITextDocument, position: lsp.Position, token: CancellationToken): Promise<lsp.DocumentHighlight[]> {
		const toc = await this._tocProvider.getForDocument(document);
		if (token.isCancellationRequested) {
			return [];
		}

		const { links } = await this._linkProvider.getLinks(document);
		if (token.isCancellationRequested) {
			return [];
		}

		const header = toc.entries.find(entry => entry.line === position.line);
		if (header) {
			return [...this._getHighlightsForHeader(document, header, links, toc)];
		}

		return [...this._getHighlightsForLinkAtPosition(document, position, links, toc)];
	}

	private *_getHighlightsForHeader(document: ITextDocument, header: TocEntry, links: readonly MdLink[], toc: TableOfContents): Iterable<lsp.DocumentHighlight> {
		yield { range: header.headerLocation.range, kind: lsp.DocumentHighlightKind.Write };

		const docUri = document.uri.toString();
		for (const link of links) {
			if (link.href.kind === HrefKind.Internal
				&& toc.lookup(link.href.fragment) === header
				&& link.source.fragmentRange
				&& link.href.path.toString() === docUri
			) {
				yield {
					range: modifyRange(link.source.fragmentRange, translatePosition(link.source.fragmentRange.start, { characterDelta: -1 })),
					kind: lsp.DocumentHighlightKind.Read,
				};
			}
		}
	}

	private _getHighlightsForLinkAtPosition(document: ITextDocument, position: lsp.Position, links: readonly MdLink[], toc: TableOfContents): Iterable<lsp.DocumentHighlight> {
		const link = links.find(link => rangeContains(link.source.hrefRange, position) || (link.kind === MdLinkKind.Definition && rangeContains(link.ref.range, position)));
		if (!link) {
			return [];
		}

		if (link.kind === MdLinkKind.Definition && rangeContains(link.ref.range, position)) {
			// We are on the reference text inside the link definition
			return this._getHighlightsForReference(link.ref.text, links);
		}

		switch (link.href.kind) {
			case HrefKind.Reference: {
				return this._getHighlightsForReference(link.href.ref, links);
			}
			case HrefKind.Internal: {
				if (link.source.fragmentRange && rangeContains(link.source.fragmentRange, position)) {
					return this._getHighlightsForLinkFragment(document, link.href, links, toc);
				}

				return this._getHighlightsForLinkPath(link.href.path, links);
			}
			case HrefKind.External: {
				return this._getHighlightsForExternalLink(link.href.uri, links);
			}
		}
	}

	private *_getHighlightsForLinkFragment(document: ITextDocument, href: InternalHref, links: readonly MdLink[], toc: TableOfContents): Iterable<lsp.DocumentHighlight> {
		const targetDoc = tryAppendMarkdownFileExtension(this._configuration, href.path);
		if (!targetDoc) {
			return;
		}

		const fragment = href.fragment.toLowerCase();

		if (targetDoc.toString() === document.uri) {
			const header = toc.lookup(fragment);
			if (header) {
				yield { range: header.headerLocation.range, kind: lsp.DocumentHighlightKind.Write };
			}
		}

		for (const link of links) {
			if (link.href.kind === HrefKind.Internal && looksLikeLinkToResource(this._configuration, link.href, targetDoc)) {
				if (link.source.fragmentRange && link.href.fragment.toLowerCase() === fragment) {
					yield {
						range: modifyRange(link.source.fragmentRange, translatePosition(link.source.fragmentRange.start, { characterDelta: -1 })),
						kind: lsp.DocumentHighlightKind.Read,
					};
				}
			}
		}
	}

	private *_getHighlightsForLinkPath(path: URI, links: readonly MdLink[]): Iterable<lsp.DocumentHighlight> {
		const targetDoc = tryAppendMarkdownFileExtension(this._configuration, path) ?? path;
		for (const link of links) {
			if (link.href.kind === HrefKind.Internal && looksLikeLinkToResource(this._configuration, link.href, targetDoc)) {
				yield {
					range: getFilePathRange(link),
					kind: lsp.DocumentHighlightKind.Read,
				};
			}
		}
	}

	private *_getHighlightsForExternalLink(uri: URI, links: readonly MdLink[]): Iterable<lsp.DocumentHighlight> {
		for (const link of links) {
			if (link.href.kind === HrefKind.External && link.href.uri.toString() === uri.toString()) {
				yield {
					range: getFilePathRange(link),
					kind: lsp.DocumentHighlightKind.Read,
				};
			}
		}
	}

	private *_getHighlightsForReference(ref: string, links: readonly MdLink[]): Iterable<lsp.DocumentHighlight> {
		for (const link of links) {
			if (link.kind === MdLinkKind.Definition && link.ref.text === ref) {
				yield {
					range: link.ref.range,
					kind: lsp.DocumentHighlightKind.Write,
				};
			} else if (link.href.kind === HrefKind.Reference && link.href.ref === ref) {
				yield {
					range: link.source.hrefRange,
					kind: lsp.DocumentHighlightKind.Read,
				};
			}
		}
	}
}