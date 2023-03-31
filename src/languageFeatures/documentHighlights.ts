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

	readonly #configuration: LsConfiguration;
	readonly #tocProvider: MdTableOfContentsProvider;
	readonly #linkProvider: MdLinkProvider;

	constructor(
		configuration: LsConfiguration,
		tocProvider: MdTableOfContentsProvider,
		linkProvider: MdLinkProvider,
	) {
		this.#configuration = configuration;
		this.#tocProvider = tocProvider;
		this.#linkProvider = linkProvider;
	}

	public async getDocumentHighlights(document: ITextDocument, position: lsp.Position, token: CancellationToken): Promise<lsp.DocumentHighlight[]> {
		const toc = await this.#tocProvider.getForDocument(document);
		if (token.isCancellationRequested) {
			return [];
		}

		const { links } = await this.#linkProvider.getLinks(document);
		if (token.isCancellationRequested) {
			return [];
		}

		const header = toc.entries.find(entry => entry.line === position.line);
		if (header) {
			return [...this.#getHighlightsForHeader(document, header, links, toc)];
		}

		return [...this.#getHighlightsForLinkAtPosition(document, position, links, toc)];
	}

	*#getHighlightsForHeader(document: ITextDocument, header: TocEntry, links: readonly MdLink[], toc: TableOfContents): Iterable<lsp.DocumentHighlight> {
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

	#getHighlightsForLinkAtPosition(document: ITextDocument, position: lsp.Position, links: readonly MdLink[], toc: TableOfContents): Iterable<lsp.DocumentHighlight> {
		const link = links.find(link => rangeContains(link.source.hrefRange, position) || (link.kind === MdLinkKind.Definition && rangeContains(link.ref.range, position)));
		if (!link) {
			return [];
		}

		if (link.kind === MdLinkKind.Definition && rangeContains(link.ref.range, position)) {
			// We are on the reference text inside the link definition
			return this.#getHighlightsForReference(link.ref.text, links);
		}

		switch (link.href.kind) {
			case HrefKind.Reference: {
				return this.#getHighlightsForReference(link.href.ref, links);
			}
			case HrefKind.Internal: {
				if (link.source.fragmentRange && rangeContains(link.source.fragmentRange, position)) {
					return this.#getHighlightsForLinkFragment(document, link.href, links, toc);
				}

				return this.#getHighlightsForLinkPath(link.href.path, links);
			}
			case HrefKind.External: {
				return this.#getHighlightsForExternalLink(link.href.uri, links);
			}
		}
	}

	*#getHighlightsForLinkFragment(document: ITextDocument, href: InternalHref, links: readonly MdLink[], toc: TableOfContents): Iterable<lsp.DocumentHighlight> {
		const targetDoc = tryAppendMarkdownFileExtension(this.#configuration, href.path);
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
			if (link.href.kind === HrefKind.Internal && looksLikeLinkToResource(this.#configuration, link.href, targetDoc)) {
				if (link.source.fragmentRange && link.href.fragment.toLowerCase() === fragment) {
					yield {
						range: modifyRange(link.source.fragmentRange, translatePosition(link.source.fragmentRange.start, { characterDelta: -1 })),
						kind: lsp.DocumentHighlightKind.Read,
					};
				}
			}
		}
	}

	*#getHighlightsForLinkPath(path: URI, links: readonly MdLink[]): Iterable<lsp.DocumentHighlight> {
		const targetDoc = tryAppendMarkdownFileExtension(this.#configuration, path) ?? path;
		for (const link of links) {
			if (link.href.kind === HrefKind.Internal && looksLikeLinkToResource(this.#configuration, link.href, targetDoc)) {
				yield {
					range: getFilePathRange(link),
					kind: lsp.DocumentHighlightKind.Read,
				};
			}
		}
	}

	*#getHighlightsForExternalLink(uri: URI, links: readonly MdLink[]): Iterable<lsp.DocumentHighlight> {
		for (const link of links) {
			if (link.href.kind === HrefKind.External && link.href.uri.toString() === uri.toString()) {
				yield {
					range: getFilePathRange(link),
					kind: lsp.DocumentHighlightKind.Read,
				};
			}
		}
	}

	*#getHighlightsForReference(ref: string, links: readonly MdLink[]): Iterable<lsp.DocumentHighlight> {
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