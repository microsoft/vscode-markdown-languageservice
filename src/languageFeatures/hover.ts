/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as lsp from 'vscode-languageserver-protocol';
import { rangeContains } from '../types/range';
import { ITextDocument } from '../types/textDocument';
import * as mdBuilder from '../util/mdBuilder';
import { getMediaPreviewType, MediaType } from '../util/media';
import { HrefKind, MdLink, MdLinkProvider } from './documentLinks';

export class MdHoverProvider {

	readonly #linkProvider: MdLinkProvider;

	constructor(linkProvider: MdLinkProvider) {
		this.#linkProvider = linkProvider;
	}

	public async provideHover(document: ITextDocument, pos: lsp.Position, token: lsp.CancellationToken): Promise<lsp.Hover | undefined> {
		const links = await this.#linkProvider.getLinks(document);
		if (token.isCancellationRequested) {
			return;
		}

		const link = links.links.find(link => rangeContains(link.source.hrefRange, pos));
		if (!link || link.href.kind === HrefKind.Reference) {
			return;
		}

		const contents = this.#getHoverContents(link);
		return contents && {
			contents,
			range: link.source.hrefRange
		};
	}

	#getHoverContents(link: MdLink): lsp.MarkupContent | undefined {
		if (link.href.kind === HrefKind.Reference) {
			return undefined;
		}

		const uri = link.href.kind === HrefKind.External ? link.href.uri : link.href.path;
		const mediaType = getMediaPreviewType(uri);
		const maxWidth = 300;
		switch (mediaType) {
			case MediaType.Image: {
				return {
					kind: 'markdown',
					value: mdBuilder.imageLink(uri, '', maxWidth),
				};
			}
			case MediaType.Video: {
				return {
					kind: 'markdown',
					value: mdBuilder.video(uri, maxWidth),
				};
			}
		}
		return undefined;
	}
}
