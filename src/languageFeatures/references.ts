/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { CancellationToken } from 'vscode-languageserver';
import * as lsp from 'vscode-languageserver-types';
import * as uri from 'vscode-uri';
import { URI } from 'vscode-uri';
import { LsConfiguration } from '../config';
import { ILogger, LogLevel } from '../logging';
import { IMdParser } from '../parser';
import { MdTableOfContentsProvider, TocEntry } from '../tableOfContents';
import { translatePosition } from '../types/position';
import { areRangesEqual, modifyRange, rangeContains } from '../types/range';
import { ITextDocument } from '../types/textDocument';
import { Disposable } from '../util/dispose';
import { looksLikeMarkdownPath } from '../util/file';
import { IWorkspace, statLinkToMarkdownFile } from '../workspace';
import { MdWorkspaceInfoCache } from '../workspaceCache';
import { InternalHref, MdLink } from './documentLinks';

/**
 * A link in a markdown file.
 */
export interface MdLinkReference {
	readonly kind: 'link';
	readonly isTriggerLocation: boolean;
	readonly isDefinition: boolean;
	readonly location: lsp.Location;

	readonly link: MdLink;
}

/**
 * A header in a markdown file.
 */
export interface MdHeaderReference {
	readonly kind: 'header';

	readonly isTriggerLocation: boolean;
	readonly isDefinition: boolean;

	/**
	 * The range of the header.
	 *
	 * In `# a b c #` this would be the range of `# a b c #`
	 */
	readonly location: lsp.Location;

	/**
	 * The text of the header.
	 *
	 * In `# a b c #` this would be `a b c`
	 */
	readonly headerText: string;

	/**
	 * The range of the header text itself.
	 *
	 * In `# a b c #` this would be the range of `a b c`
	 */
	readonly headerTextLocation: lsp.Location;
}

export type MdReference = MdLinkReference | MdHeaderReference;

/**
 * Stateful object that computes references for markdown files.
 */
export class MdReferencesProvider extends Disposable {

	public constructor(
		private readonly configuration: LsConfiguration,
		private readonly parser: IMdParser,
		private readonly workspace: IWorkspace,
		private readonly tocProvider: MdTableOfContentsProvider,
		private readonly linkCache: MdWorkspaceInfoCache<readonly MdLink[]>,
		private readonly logger: ILogger,
	) {
		super();
	}

	async provideReferences(document: ITextDocument, position: lsp.Position, context: lsp.ReferenceContext, token: CancellationToken): Promise<lsp.Location[]> {
		const allRefs = await this.getReferencesAtPosition(document, position, token);
		return allRefs
			.filter(ref => context.includeDeclaration || !ref.isDefinition)
			.map(ref => ref.location);
	}

	public async getReferencesAtPosition(document: ITextDocument, position: lsp.Position, token: CancellationToken): Promise<MdReference[]> {
		this.logger.log(LogLevel.Trace, 'ReferencesProvider', `getReferencesAtPosition: ${document.uri}`);

		const toc = await this.tocProvider.getForDocument(document);
		if (token.isCancellationRequested) {
			return [];
		}

		const header = toc.entries.find(entry => entry.line === position.line);
		if (header) {
			return this.getReferencesToHeader(document, header);
		} else {
			return this.getReferencesToLinkAtPosition(document, position, token);
		}
	}

	public async getReferencesToFileInWorkspace(resource: URI, token: CancellationToken): Promise<MdReference[]> {
		this.logger.log(LogLevel.Trace, 'ReferencesProvider', `getAllReferencesToFileInWorkspace: ${resource}`);

		const allLinksInWorkspace = (await this.linkCache.values()).flat();
		if (token.isCancellationRequested) {
			return [];
		}

		return Array.from(this.findLinksToFile(resource, allLinksInWorkspace, undefined));
	}

	private async getReferencesToHeader(document: ITextDocument, header: TocEntry): Promise<MdReference[]> {
		const links = (await this.linkCache.values()).flat();

		const references: MdReference[] = [];

		references.push({
			kind: 'header',
			isTriggerLocation: true,
			isDefinition: true,
			location: header.headerLocation,
			headerText: header.text,
			headerTextLocation: header.headerTextLocation
		});

		for (const link of links) {
			if (link.href.kind === 'internal'
				&& this.looksLikeLinkToDoc(link.href, URI.parse(document.uri))
				&& this.parser.slugifier.fromHeading(link.href.fragment).value === header.slug.value
			) {
				references.push({
					kind: 'link',
					isTriggerLocation: false,
					isDefinition: false,
					link,
					location: { uri: link.source.resource.toString(), range: link.source.hrefRange },
				});
			}
		}

		return references;
	}

	private async getReferencesToLinkAtPosition(document: ITextDocument, position: lsp.Position, token: CancellationToken): Promise<MdReference[]> {
		const docLinks = (await this.linkCache.getForDocs([document]))[0];

		for (const link of docLinks) {
			if (link.kind === 'definition') {
				// We could be in either the ref name or the definition
				if (rangeContains(link.ref.range, position)) {
					return Array.from(this.getReferencesToLinkReference(docLinks, link.ref.text, { resource: URI.parse(document.uri), range: link.ref.range }));
				} else if (rangeContains(link.source.hrefRange, position)) {
					return this.getReferencesToLink(link, position, token);
				}
			} else {
				if (rangeContains(link.source.hrefRange, position)) {
					return this.getReferencesToLink(link, position, token);
				}
			}
		}

		return [];
	}

	private async getReferencesToLink(sourceLink: MdLink, triggerPosition: lsp.Position, token: CancellationToken): Promise<MdReference[]> {
		const allLinksInWorkspace = (await this.linkCache.values()).flat();
		if (token.isCancellationRequested) {
			return [];
		}

		if (sourceLink.href.kind === 'reference') {
			return Array.from(this.getReferencesToLinkReference(allLinksInWorkspace, sourceLink.href.ref, { resource: sourceLink.source.resource, range: sourceLink.source.hrefRange }));
		}

		if (sourceLink.href.kind === 'external') {
			const references: MdReference[] = [];

			for (const link of allLinksInWorkspace) {
				if (link.href.kind === 'external' && link.href.uri.toString() === sourceLink.href.uri.toString()) {
					const isTriggerLocation = sourceLink.source.resource.fsPath === link.source.resource.fsPath && areRangesEqual(sourceLink.source.hrefRange, link.source.hrefRange);
					references.push({
						kind: 'link',
						isTriggerLocation,
						isDefinition: false,
						link,
						location: { uri: link.source.resource.toString(), range: link.source.hrefRange },
					});
				}
			}
			return references;
		}

		const resolvedResource = await statLinkToMarkdownFile(this.configuration, this.workspace, sourceLink.href.path);
		if (token.isCancellationRequested) {
			return [];
		}

		const references: MdReference[] = [];

		if (resolvedResource && this.isMarkdownPath(resolvedResource) && sourceLink.href.fragment && sourceLink.source.fragmentRange && rangeContains(sourceLink.source.fragmentRange, triggerPosition)) {
			const toc = await this.tocProvider.get(resolvedResource);
			const entry = toc.lookup(sourceLink.href.fragment);
			if (entry) {
				references.push({
					kind: 'header',
					isTriggerLocation: false,
					isDefinition: true,
					location: entry.headerLocation,
					headerText: entry.text,
					headerTextLocation: entry.headerTextLocation
				});
			}

			for (const link of allLinksInWorkspace) {
				if (link.href.kind !== 'internal' || !this.looksLikeLinkToDoc(link.href, resolvedResource)) {
					continue;
				}

				if (this.parser.slugifier.fromHeading(link.href.fragment).equals(this.parser.slugifier.fromHeading(sourceLink.href.fragment))) {
					const isTriggerLocation = sourceLink.source.resource.fsPath === link.source.resource.fsPath && areRangesEqual(sourceLink.source.hrefRange, link.source.hrefRange);
					references.push({
						kind: 'link',
						isTriggerLocation,
						isDefinition: false,
						link,
						location: { uri: link.source.resource.toString(), range: link.source.hrefRange },
					});
				}
			}
		} else { // Triggered on a link without a fragment so we only require matching the file and ignore fragments
			references.push(...this.findLinksToFile(resolvedResource ?? sourceLink.href.path, allLinksInWorkspace, sourceLink));
		}

		return references;
	}

	private isMarkdownPath(resolvedHrefPath: URI) {
		return this.workspace.hasMarkdownDocument(resolvedHrefPath) || looksLikeMarkdownPath(this.configuration, resolvedHrefPath);
	}

	private looksLikeLinkToDoc(href: InternalHref, targetDoc: URI) {
		return href.path.fsPath === targetDoc.fsPath
			|| uri.Utils.extname(href.path) === '' && href.path.with({ path: href.path.path + '.md' }).fsPath === targetDoc.fsPath;
	}

	private *findLinksToFile(resource: URI, links: readonly MdLink[], sourceLink: MdLink | undefined): Iterable<MdReference> {
		for (const link of links) {
			if (link.href.kind !== 'internal' || !this.looksLikeLinkToDoc(link.href, resource)) {
				continue;
			}

			// Exclude cases where the file is implicitly referencing itself
			if (link.source.hrefText.startsWith('#') && link.source.resource.fsPath === resource.fsPath) {
				continue;
			}

			const isTriggerLocation = !!sourceLink && sourceLink.source.resource.fsPath === link.source.resource.fsPath && areRangesEqual(sourceLink.source.hrefRange, link.source.hrefRange);
			const pathRange = this.getPathRange(link);
			yield {
				kind: 'link',
				isTriggerLocation,
				isDefinition: false,
				link,
				location: { uri: link.source.resource.toString(), range: pathRange },
			};
		}
	}

	private *getReferencesToLinkReference(allLinks: Iterable<MdLink>, refToFind: string, from: { resource: URI; range: lsp.Range }): Iterable<MdReference> {
		for (const link of allLinks) {
			let ref: string;
			if (link.kind === 'definition') {
				ref = link.ref.text;
			} else if (link.href.kind === 'reference') {
				ref = link.href.ref;
			} else {
				continue;
			}

			if (ref === refToFind && link.source.resource.fsPath === from.resource.fsPath) {
				const isTriggerLocation = from.resource.fsPath === link.source.resource.fsPath && (
					(link.href.kind === 'reference' && areRangesEqual(from.range, link.source.hrefRange)) || (link.kind === 'definition' && areRangesEqual(from.range, link.ref.range)));

				const pathRange = this.getPathRange(link);
				yield {
					kind: 'link',
					isTriggerLocation,
					isDefinition: link.kind === 'definition',
					link,
					location: { uri: from.resource.toString(), range: pathRange },
				};
			}
		}
	}

	/**
	 * Get just the range of the file path, dropping the fragment
	 */
	private getPathRange(link: MdLink): lsp.Range {
		return link.source.fragmentRange
			? modifyRange(link.source.hrefRange, undefined, translatePosition(link.source.fragmentRange.start, { characterDelta: -1 }))
			: link.source.hrefRange;
	}
}
