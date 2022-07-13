/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from 'vscode-languageserver';
import * as lsp from 'vscode-languageserver-types';
import { URI, Utils } from 'vscode-uri';
import { ILogger } from '../logging';
import { IMdParser } from '../parser';
import { MdTableOfContentsProvider } from '../tableOfContents';
import { translatePosition } from '../types/position';
import { rangeContains } from '../types/range';
import { getLine, ITextDocument } from '../types/textDocument';
import { coalesce } from '../util/arrays';
import { noopToken } from '../util/cancellation';
import { Disposable } from '../util/dispose';
import { getWorkspaceFolder, IWorkspace } from '../workspace';
import { MdDocumentInfoCache } from '../workspaceCache';


export interface ExternalHref {
	readonly kind: 'external';
	readonly uri: URI;
}

export interface InternalHref {
	readonly kind: 'internal';
	readonly path: URI;
	readonly fragment: string;
}

export interface ReferenceHref {
	readonly kind: 'reference';
	readonly ref: string;
}

export type LinkHref = ExternalHref | InternalHref | ReferenceHref;

function resolveLink(
	document: ITextDocument,
	link: string,
	workspace: IWorkspace,
): ExternalHref | InternalHref | undefined {
	const cleanLink = stripAngleBrackets(link);
	if (/^[a-z\-][a-z\-]+:/i.test(cleanLink)) {
		// Looks like a uri
		return { kind: 'external', uri: URI.parse(cleanLink) };
	}

	// Assume it must be an relative or absolute file path
	// Use a fake scheme to avoid parse warnings
	const tempUri = URI.parse(`vscode-resource:${link}`);

	const docUri = workspace.getContainingDocument?.(URI.parse(document.uri))?.uri ?? URI.parse(document.uri);

	let resourceUri: URI | undefined;
	if (!tempUri.path) {
		resourceUri = docUri;
	} else if (tempUri.path[0] === '/') {
		const root = getWorkspaceFolder(workspace, docUri);
		if (root) {
			resourceUri = Utils.joinPath(root, tempUri.path);
		}
	} else {
		if (docUri.scheme === 'untitled') {
			const root = getWorkspaceFolder(workspace, docUri);
			if (root) {
				resourceUri = Utils.joinPath(root, tempUri.path);
			}
		} else {
			const base = Utils.dirname(docUri);
			resourceUri = Utils.joinPath(base, tempUri.path);
		}
	}

	if (!resourceUri) {
		return undefined;
	}

	return {
		kind: 'internal',
		path: resourceUri.with({ fragment: '' }),
		fragment: tempUri.fragment,
	};
}

export interface MdLinkSource {
	/**
	 * The full range of the link.
	 */
	readonly range: lsp.Range;

	/**
	 * The file where the link is defined.
	 */
	readonly resource: URI;

	/**
	 * The original text of the link destination in code.
	 */
	readonly hrefText: string;

	/**
	 * The original text of just the link's path in code.
	 */
	readonly pathText: string;

	/**
	 * The range of the path.
	 */
	readonly hrefRange: lsp.Range;

	/**
	 * The range of the fragment within the path.
	 */
	readonly fragmentRange: lsp.Range | undefined;
}

export interface MdInlineLink {
	readonly kind: 'link';
	readonly source: MdLinkSource;
	readonly href: LinkHref;
}

export interface MdLinkDefinition {
	readonly kind: 'definition';
	readonly source: MdLinkSource;
	readonly ref: {
		readonly range: lsp.Range;
		readonly text: string;
	};
	readonly href: ExternalHref | InternalHref;
}

export type MdLink = MdInlineLink | MdLinkDefinition;

function extractDocumentLink(
	document: ITextDocument,
	pre: string,
	rawLink: string,
	matchIndex: number,
	fullMatch: string,
	workspace: IWorkspace,
): MdLink | undefined {
	const isAngleBracketLink = rawLink.startsWith('<');
	const link = stripAngleBrackets(rawLink);

	let linkTarget: ExternalHref | InternalHref | undefined;
	try {
		linkTarget = resolveLink(document, link, workspace);
	} catch {
		return undefined;
	}
	if (!linkTarget) {
		return undefined;
	}

	const linkStart = document.positionAt(matchIndex);
	const linkEnd = translatePosition(linkStart, { characterDelta: fullMatch.length });
	const hrefStart = translatePosition(linkStart, { characterDelta: pre.length + (isAngleBracketLink ? 1 : 0) });
	const hrefEnd = translatePosition(hrefStart, { characterDelta: link.length });
	return {
		kind: 'link',
		href: linkTarget,
		source: {
			hrefText: link,
			resource: URI.parse(document.uri),
			range: { start: linkStart, end: linkEnd },
			hrefRange: { start: hrefStart, end: hrefEnd },
			...getLinkSourceFragmentInfo(document, link, hrefStart, hrefEnd),
		}
	};
}

function getFragmentRange(text: string, start: lsp.Position, end: lsp.Position): lsp.Range | undefined {
	const index = text.indexOf('#');
	if (index < 0) {
		return undefined;
	}
	return { start: translatePosition(start, { characterDelta: index + 1 }), end };
}

function getLinkSourceFragmentInfo(document: ITextDocument, link: string, linkStart: lsp.Position, linkEnd: lsp.Position): { fragmentRange: lsp.Range | undefined; pathText: string } {
	const fragmentRange = getFragmentRange(link, linkStart, linkEnd);
	return {
		pathText: document.getText({ start: linkStart, end: fragmentRange ? translatePosition(fragmentRange.start, { characterDelta: -1 }) : linkEnd }),
		fragmentRange,
	};
}

const angleBracketLinkRe = /^<(.*)>$/;

/**
 * Used to strip brackets from the markdown link
 *
 * <http://example.com> will be transformed to http://example.com
*/
function stripAngleBrackets(link: string) {
	return link.replace(angleBracketLinkRe, '$1');
}

const r = String.raw;

/**
 * Matches `[text](link)` or `[text](<link>)`
 */
const linkPattern = new RegExp(
	// text
	r`(\[` + // open prefix match -->
	/**/r`(?:` +
	/*****/r`[^\[\]\\]|` + // Non-bracket chars, or...
	/*****/r`\\.|` + // Escaped char, or...
	/*****/r`\[[^\[\]]*\]` + // Matched bracket pair
	/**/r`)*` +
	r`\]` +

	// Destination
	r`\(\s*)` + // <-- close prefix match
	/**/r`(` +
	/*****/r`[^\s\(\)\<](?:[^\s\(\)]|\([^\s\(\)]*?\))*|` + // Link without whitespace, or...
	/*****/r`<[^<>]+>` + // In angle brackets
	/**/r`)` +

	// Title
	/**/r`\s*(?:"[^"]*"|'[^']*'|\([^\(\)]*\))?\s*` +
	r`\)`,
	'g');

/**
* Matches `[text][ref]` or `[shorthand]`
*/
const referenceLinkPattern = /(^|[^\]\\])(?:(?:(\[((?:\\\]|[^\]])+)\]\[\s*?)([^\s\]]*?)\]|\[\s*?([^\s\\\]]*?)\])(?![\:\(]))/gm;

/**
 * Matches `<http://example.com>`
 */
const autoLinkPattern = /\<(\w+:[^\>\s]+)\>/g;

/**
 * Matches `[text]: link`
 */
const definitionPattern = /^([\t ]*\[(?!\^)((?:\\\]|[^\]])+)\]:\s*)([^<]\S*|<[^>]+>)/gm;

const inlineCodePattern = /(?:^|[^`])(`+)(?:.+?|.*?(?:(?:\r?\n).+?)*?)(?:\r?\n)?\1(?:$|[^`])/gm;

class NoLinkRanges {
	public static async compute(tokenizer: IMdParser, document: ITextDocument): Promise<NoLinkRanges> {
		const tokens = await tokenizer.tokenize(document);
		const multiline = tokens.filter(t => (t.type === 'code_block' || t.type === 'fence' || t.type === 'html_block') && !!t.map).map(t => t.map) as [number, number][];

		const inlineRanges = new Map</* line number */ number, lsp.Range[]>();
		const text = document.getText();
		for (const match of text.matchAll(inlineCodePattern)) {
			const startOffset = match.index ?? 0;
			const startPosition = document.positionAt(startOffset);

			const range: lsp.Range = { start: startPosition, end: document.positionAt(startOffset + match[0].length) };
			for (let line = range.start.line; line <= range.end.line; ++line) {
				let entry = inlineRanges.get(line);
				if (!entry) {
					entry = [];
					inlineRanges.set(line, entry);
				}
				entry.push(range);
			}
		}

		return new NoLinkRanges(multiline, inlineRanges);
	}

	private constructor(
		/**
		 * code blocks and fences each represented by [line_start,line_end).
		 */
		public readonly multiline: ReadonlyArray<[number, number]>,

		/**
		 * Inline code spans where links should not be detected
		 */
		public readonly inline: Map</* line number */ number, lsp.Range[]>
	) { }

	contains(position: lsp.Position): boolean {
		return this.multiline.some(interval => position.line >= interval[0] && position.line < interval[1]) ||
			!!this.inline.get(position.line)?.some(inlineRange => rangeContains(inlineRange, position));
	}

	concatInline(inlineRanges: Iterable<lsp.Range>): NoLinkRanges {
		const newInline = new Map(this.inline);
		for (const range of inlineRanges) {
			for (let line = range.start.line; line <= range.end.line; ++line) {
				let entry = newInline.get(line);
				if (!entry) {
					entry = [];
					newInline.set(line, entry);
				}
				entry.push(range);
			}
		}
		return new NoLinkRanges(this.multiline, newInline);
	}
}

/**
 * Stateless object that extracts link information from markdown files.
 */
export class MdLinkComputer {

	constructor(
		private readonly tokenizer: IMdParser,
		private readonly workspace: IWorkspace,
	) { }

	public async getAllLinks(document: ITextDocument, token: CancellationToken): Promise<MdLink[]> {
		const noLinkRanges = await NoLinkRanges.compute(this.tokenizer, document);
		if (token.isCancellationRequested) {
			return [];
		}

		const inlineLinks = Array.from(this.getInlineLinks(document, noLinkRanges));
		return Array.from([
			...inlineLinks,
			...this.getReferenceLinks(document, noLinkRanges.concatInline(inlineLinks.map(x => x.source.range))),
			...this.getLinkDefinitions(document, noLinkRanges),
			...this.getAutoLinks(document, noLinkRanges),
		]);
	}

	private *getInlineLinks(document: ITextDocument, noLinkRanges: NoLinkRanges): Iterable<MdLink> {
		const text = document.getText();
		for (const match of text.matchAll(linkPattern)) {
			const matchLinkData = extractDocumentLink(document, match[1], match[2], match.index ?? 0, match[0], this.workspace);
			if (matchLinkData && !noLinkRanges.contains(matchLinkData.source.hrefRange.start)) {
				yield matchLinkData;

				// Also check link destination for links
				for (const innerMatch of match[1].matchAll(linkPattern)) {
					const innerData = extractDocumentLink(document, innerMatch[1], innerMatch[2], (match.index ?? 0) + (innerMatch.index ?? 0), innerMatch[0], this.workspace);
					if (innerData) {
						yield innerData;
					}
				}
			}
		}
	}

	private *getAutoLinks(document: ITextDocument, noLinkRanges: NoLinkRanges): Iterable<MdLink> {
		const text = document.getText();
		for (const match of text.matchAll(autoLinkPattern)) {
			const linkOffset = (match.index ?? 0);
			const linkStart = document.positionAt(linkOffset);
			if (noLinkRanges.contains(linkStart)) {
				continue;
			}

			const link = match[1];
			const linkTarget = resolveLink(document, link, this.workspace);
			if (!linkTarget) {
				continue;
			}

			const linkEnd = translatePosition(linkStart, { characterDelta: match[0].length });
			const hrefStart = translatePosition(linkStart, { characterDelta: 1 });
			const hrefEnd = translatePosition(hrefStart, { characterDelta: link.length });
			yield {
				kind: 'link',
				href: linkTarget,
				source: {
					hrefText: link,
					resource: URI.parse(document.uri),
					hrefRange: { start: hrefStart, end: hrefEnd },
					range: { start: linkStart, end: linkEnd },
					...getLinkSourceFragmentInfo(document, link, hrefStart, hrefEnd),
				}
			};
		}
	}

	private *getReferenceLinks(document: ITextDocument, noLinkRanges: NoLinkRanges): Iterable<MdLink> {
		const text = document.getText();
		for (const match of text.matchAll(referenceLinkPattern)) {
			const linkStartOffset = (match.index ?? 0) + match[1].length;
			const linkStart = document.positionAt(linkStartOffset);
			if (noLinkRanges.contains(linkStart)) {
				continue;
			}

			let hrefStart: lsp.Position;
			let hrefEnd: lsp.Position;
			let reference = match[4];
			if (reference === '') { // [ref][],
				reference = match[3];
				const offset = linkStartOffset + 1;
				hrefStart = document.positionAt(offset);
				hrefEnd = document.positionAt(offset + reference.length);
			} else if (reference) { // [text][ref]
				const pre = match[2];
				const offset = linkStartOffset + pre.length;
				hrefStart = document.positionAt(offset);
				hrefEnd = document.positionAt(offset + reference.length);
			} else if (match[5]) { // [ref]
				reference = match[5];
				const offset = linkStartOffset + 1;
				hrefStart = document.positionAt(offset);
				const line = getLine(document, hrefStart.line);
				// See if link looks like a checkbox
				const checkboxMatch = line.match(/^\s*[\-\*]\s*\[x\]/i);
				if (checkboxMatch && hrefStart.character <= checkboxMatch[0].length) {
					continue;
				}
				hrefEnd = document.positionAt(offset + reference.length);
			} else {
				continue;
			}

			const linkEnd = translatePosition(linkStart, { characterDelta: match[0].length - match[1].length });
			yield {
				kind: 'link',
				source: {
					hrefText: reference,
					pathText: reference,
					resource: URI.parse(document.uri),
					range: { start: linkStart, end: linkEnd },
					hrefRange: { start: hrefStart, end: hrefEnd },
					fragmentRange: undefined,
				},
				href: {
					kind: 'reference',
					ref: reference,
				}
			};
		}
	}

	private *getLinkDefinitions(document: ITextDocument, noLinkRanges: NoLinkRanges): Iterable<MdLinkDefinition> {
		const text = document.getText();
		for (const match of text.matchAll(definitionPattern)) {
			const offset = (match.index ?? 0);
			const linkStart = document.positionAt(offset);
			if (noLinkRanges.contains(linkStart)) {
				continue;
			}

			const pre = match[1];
			const reference = match[2];
			const rawLinkText = match[3].trim();
			const target = resolveLink(document, rawLinkText, this.workspace);
			if (!target) {
				continue;
			}

			const isAngleBracketLink = angleBracketLinkRe.test(rawLinkText);
			const linkText = stripAngleBrackets(rawLinkText);
			const hrefStart = translatePosition(linkStart, { characterDelta: pre.length + (isAngleBracketLink ? 1 : 0) });
			const hrefEnd = translatePosition(hrefStart, { characterDelta: linkText.length });
			const hrefRange = { start: hrefStart, end: hrefEnd };

			const refStart = translatePosition(linkStart, { characterDelta: 1 });
			const refRange: lsp.Range = { start: refStart, end: translatePosition(refStart, { characterDelta: reference.length }) };
			const linkEnd = translatePosition(linkStart, { characterDelta: match[0].length });
			yield {
				kind: 'definition',
				source: {
					hrefText: linkText,
					resource: URI.parse(document.uri),
					range: { start: linkStart, end: linkEnd },
					hrefRange,
					...getLinkSourceFragmentInfo(document, rawLinkText, hrefStart, hrefEnd),
				},
				ref: { text: reference, range: refRange },
				href: target,
			};
		}
	}
}

interface MdDocumentLinks {
	readonly links: readonly MdLink[];
	readonly definitions: LinkDefinitionSet;
}

export class LinkDefinitionSet implements Iterable<[string, MdLinkDefinition]> {
	private readonly _map = new Map<string, MdLinkDefinition>();

	constructor(links: Iterable<MdLink>) {
		for (const link of links) {
			if (link.kind === 'definition') {
				this._map.set(link.ref.text, link);
			}
		}
	}

	public [Symbol.iterator](): Iterator<[string, MdLinkDefinition]> {
		return this._map.entries();
	}

	public lookup(ref: string): MdLinkDefinition | undefined {
		return this._map.get(ref);
	}
}

/**
 * Stateful object which provides links for markdown files the workspace.
 */
export class MdLinkProvider extends Disposable {

	private readonly _linkCache: MdDocumentInfoCache<MdDocumentLinks>;

	private readonly _linkComputer: MdLinkComputer;

	constructor(
		tokenizer: IMdParser,
		private readonly _workspace: IWorkspace,
		private readonly _tocProvider: MdTableOfContentsProvider,
		logger: ILogger,
	) {
		super();
		this._linkComputer = new MdLinkComputer(tokenizer, _workspace);
		this._linkCache = this._register(new MdDocumentInfoCache(this._workspace, async doc => {
			logger.verbose('LinkProvider', `compute - ${doc.uri}`);

			const links = await this._linkComputer.getAllLinks(doc, noopToken);
			return {
				links,
				definitions: new LinkDefinitionSet(links),
			};
		}));
	}

	public getLinks(document: ITextDocument): Promise<MdDocumentLinks> {
		return this._linkCache.getForDocument(document);
	}

	public async provideDocumentLinks(document: ITextDocument, token: CancellationToken): Promise<lsp.DocumentLink[]> {
		const { links, definitions } = await this.getLinks(document);
		if (token.isCancellationRequested) {
			return [];
		}

		return coalesce(links.map(data => this.toValidDocumentLink(data, definitions)));
	}

	public async resolveDocumentLink(link: lsp.DocumentLink, _token: CancellationToken): Promise<lsp.DocumentLink | undefined> {
		if (!link.data) {
			return undefined;
		}

		const mdLink = link.data as MdLink;
		if (mdLink.href.kind !== 'internal') {
			return undefined;
		}

		// Default to allowing to click link to goto / create file
		link.target = this.createCommandUri('vscode.open', mdLink.href.path);

		let target = URI.from(mdLink.href.path);

		const stat = await this._workspace.stat(target);
		if (stat?.isDirectory) {
			link.target = this.createCommandUri('revealInExplorer', mdLink.href.path);
			return link;
		}

		if (!stat) {
			// We don't think the file exists. If it doesn't already have an extension, try tacking on a `.md` and using that instead
			let found = false;
			if (Utils.extname(target) === '') {
				const dotMdResource = target.with({ path: target.path + '.md' });
				if (await this._workspace.stat(dotMdResource)) {
					target = dotMdResource;
					found = true;
				}
			}

			if (!found) {
				return link;
			}
		}

		if (!mdLink.href.fragment) {
			link.target = this.createCommandUri('vscode.open', target);
			return link;
		}

		// Try navigating with fragment that sets line number
		const lineNumberFragment = mdLink.href.fragment.match(/^L(\d+)(?:,(\d+))?$/i);
		if (lineNumberFragment) {
			const line = +lineNumberFragment[1] - 1;
			if (!isNaN(line)) {
				const char = +lineNumberFragment[2] - 1;
				const pos: lsp.Position = { line, character: isNaN(char) ? 0 : char };
				link.target = this.createOpenAtPosCommand(target, pos);
				return link;
			}
		}

		// Try navigating to header in file
		const doc = await this._workspace.openMarkdownDocument(target);
		if (doc) {
			const toc = await this._tocProvider.getForDocument(doc);
			const entry = toc.lookup(mdLink.href.fragment);
			if (entry) {
				link.target = this.createOpenAtPosCommand(target, entry.headerLocation.range.start);
				return link;
			}

		}

		link.target = this.createCommandUri('vscode.open', target);

		return link;
	}

	private toValidDocumentLink(link: MdLink, definitionSet: LinkDefinitionSet): lsp.DocumentLink | undefined {
		switch (link.href.kind) {
			case 'external': {
				return {
					range: link.source.hrefRange,
					target: link.href.uri.toString(),
				};
			}
			case 'internal': {
				return {
					range: link.source.hrefRange,
					target: undefined, // Needs to be resolved later
					tooltip: "Follow link",
					data: link,
				};
			}
			case 'reference': {
				// We only render reference links in the editor if they are actually defined.
				// This matches how reference links are rendered by markdown-it.
				const def = definitionSet.lookup(link.href.ref);
				if (!def) {
					return undefined;
				}

				const target = this.createOpenAtPosCommand(link.source.resource, def.source.hrefRange.start);
				return {
					range: link.source.hrefRange,
					tooltip: "Go to link definition",
					target: target,
					data: link
				};
			}
		}
	}

	private createCommandUri(command: string, ...args: any[]): string {
		return `command:${command}?${encodeURIComponent(JSON.stringify(args))}`;
	}

	private createOpenAtPosCommand(resource: URI, pos: lsp.Position): string {
		// Workaround https://github.com/microsoft/vscode/issues/154993
		return this.createCommandUri('_workbench.open', resource, [undefined, {
			selection: <VsCodeIRange>{
				startLineNumber: pos.line + 1,
				startColumn: pos.character + 1,
				endLineNumber: pos.line + 1,
				endColumn: pos.character + 1,
			}
		}]);
	}
}

export interface VsCodeIRange {
	readonly startLineNumber: number;
	readonly startColumn: number;
	readonly endLineNumber: number;
	readonly endColumn: number;
}