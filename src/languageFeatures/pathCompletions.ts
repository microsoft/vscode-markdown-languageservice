/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { dirname, extname, resolve } from 'path';
import type { CancellationToken, CompletionContext } from 'vscode-languageserver-protocol';
import * as lsp from 'vscode-languageserver-protocol';
import { URI, Utils } from 'vscode-uri';
import { LsConfiguration, isExcludedPath } from '../config';
import { IMdParser } from '../parser';
import { MdTableOfContentsProvider, TableOfContents, TocEntry } from '../tableOfContents';
import { translatePosition } from '../types/position';
import { ITextDocument, getDocUri, getLine } from '../types/textDocument';
import { htmlTagPathAttrs } from '../util/html';
import * as mdBuilder from '../util/mdBuilder';
import { escapeForAngleBracketLink, hasBalancedParens } from '../util/mdLinks';
import { MediaType, getMediaPreviewType } from '../util/media';
import { computeRelativePath, isSameResource, looksLikeMarkdownFilePath } from '../util/path';
import { Schemes } from '../util/schemes';
import { r } from '../util/string';
import { FileStat, IWorkspace, getWorkspaceFolder, openLinkToMarkdownFile } from '../workspace';
import { MdWorkspaceInfoCache } from '../workspaceCache';
import { MdLinkProvider } from './documentLinks';

enum CompletionContextKind {
	/** `[...](|)` */
	Link,

	/** `[...][|]` */
	ReferenceLink,

	/** `[]: |` */
	LinkDefinition,

	/** <img src="|"> */
	HtmlAttribute,
}

interface AnchorContext {
	/**
	 * Link text before the `#`.
	 *
	 * For `[text](xy#z|abc)` this is `xy`.
	 */
	readonly beforeAnchor: string;

	/**
	 * Text of the anchor before the current position.
	 *
	 * For `[text](xy#z|abc)` this is `z`.
	 */
	readonly anchorPrefix: string;
}

interface PathCompletionContext {
	readonly kind: CompletionContextKind;

	/**
	 * Text of the link before the current position
	 *
	 * For `[text](xy#z|abc)` this is `xy#z`.
	 */
	readonly linkPrefix: string;

	/**
	 * Position of the start of the link.
	 *
	 * For `[text](xy#z|abc)` this is the position before `xy`.
	 */
	readonly linkTextStartPosition: lsp.Position;

	/**
	 * Text of the link after the current position.
	 *
	 * For `[text](xy#z|abc)` this is `abc`.
	 */
	readonly linkSuffix: string;

	/**
	 * Info if the link looks like it is for an anchor: `[](#header)`
	 */
	readonly anchorInfo?: AnchorContext;

	/**
	 * Indicates that the completion does not require encoding.
	 */
	readonly isAngleBracketPath?: boolean;
}

function tryDecodeUriComponent(str: string): string {
	try {
		return decodeURIComponent(str);
	} catch {
		return str;
	}
}

/**
 * Controls if header completions for other files in the workspace be returned.
 */
export enum IncludeWorkspaceHeaderCompletions {
	/**
	 * Never return workspace header completions.
	 */
	never = 'never',

	/**
	 * Return workspace header completions after `##` is typed.
	 * 
	 * This lets the user signal 
	 */
	onDoubleHash = 'onDoubleHash',

	/**
	 * Return workspace header completions after either a single `#` is typed or after `##`
	 * 
	 * For a single hash, this means the workspace header completions will be returned along side the current file header completions.
	 */
	onSingleOrDoubleHash = 'onSingleOrDoubleHash',
}

/**
 * Control the type of path completions returned.
 */
export interface PathCompletionOptions {
	/**
	 * Should header completions for other files in the workspace be returned when
	 * you trigger completions.
	 * 
	 * Defaults to {@link IncludeWorkspaceHeaderCompletions.never never} (not returned).
	 */
	readonly includeWorkspaceHeaderCompletions?: IncludeWorkspaceHeaderCompletions;
}

const sortTexts = Object.freeze({
	localHeader: '1',
	workspaceHeader: '2',
});

/**
 * Adds path completions in markdown files.
 */
export class MdPathCompletionProvider {

	readonly #configuration: LsConfiguration;
	readonly #workspace: IWorkspace;
	readonly #parser: IMdParser;
	readonly #linkProvider: MdLinkProvider;

	readonly #workspaceTocCache: MdWorkspaceInfoCache<TableOfContents>;

	constructor(
		configuration: LsConfiguration,
		workspace: IWorkspace,
		parser: IMdParser,
		linkProvider: MdLinkProvider,
		tocProvider: MdTableOfContentsProvider,
	) {
		this.#configuration = configuration;
		this.#workspace = workspace;
		this.#parser = parser;
		this.#linkProvider = linkProvider;

		this.#workspaceTocCache = new MdWorkspaceInfoCache(workspace, (doc) => tocProvider.getForDocument(doc));
	}

	public async provideCompletionItems(document: ITextDocument, position: lsp.Position, context: CompletionContext & PathCompletionOptions, token: CancellationToken): Promise<lsp.CompletionItem[]> {
		const pathContext = this.#getPathCompletionContext(document, position);
		if (!pathContext) {
			return [];
		}

		const items: lsp.CompletionItem[] = [];
		for await (const item of this.#provideCompletionItems(document, position, pathContext, context, token)) {
			items.push(item);
		}
		return items;
	}

	async *#provideCompletionItems(document: ITextDocument, position: lsp.Position, context: PathCompletionContext, options: PathCompletionOptions, token: CancellationToken): AsyncIterable<lsp.CompletionItem> {
		switch (context.kind) {
			case CompletionContextKind.ReferenceLink: {
				yield* this.#provideReferenceSuggestions(document, position, context, token);
				return;
			}
			case CompletionContextKind.LinkDefinition:
			case CompletionContextKind.Link:
			case CompletionContextKind.HtmlAttribute: {
				if (
					(context.linkPrefix.startsWith('#') && options.includeWorkspaceHeaderCompletions === IncludeWorkspaceHeaderCompletions.onSingleOrDoubleHash) ||
					(context.linkPrefix.startsWith('##') && (options.includeWorkspaceHeaderCompletions === IncludeWorkspaceHeaderCompletions.onDoubleHash || options.includeWorkspaceHeaderCompletions === IncludeWorkspaceHeaderCompletions.onSingleOrDoubleHash))
				) {
					const insertRange = lsp.Range.create(context.linkTextStartPosition, position);
					yield* this.#provideWorkspaceHeaderSuggestions(document, position, context, insertRange, token);
					return;
				}

				const isAnchorInCurrentDoc = context.anchorInfo && context.anchorInfo.beforeAnchor.length === 0;

				// Add anchor #links in current doc
				if (context.linkPrefix.length === 0 || isAnchorInCurrentDoc) {
					const insertRange = lsp.Range.create(context.linkTextStartPosition, position);
					yield* this.#provideHeaderSuggestions(document, position, context, insertRange, token);
				}

				if (token.isCancellationRequested) {
					return;
				}

				if (!isAnchorInCurrentDoc) {
					if (context.anchorInfo) { // Anchor to a different document
						const rawUri = this.#resolveReference(document, context.anchorInfo.beforeAnchor);
						if (rawUri) {
							const otherDoc = await openLinkToMarkdownFile(this.#configuration, this.#workspace, rawUri);
							if (token.isCancellationRequested) {
								return;
							}

							if (otherDoc) {
								const anchorStartPosition = translatePosition(position, { characterDelta: -(context.anchorInfo.anchorPrefix.length + 1) });
								const range = lsp.Range.create(anchorStartPosition, position);
								yield* this.#provideHeaderSuggestions(otherDoc, position, context, range, token);
							}
						}
					} else { // Normal path suggestions
						yield* this.#providePathSuggestions(document, position, context, token);
					}
				}
				return;
			}
		}
	}

	/// [...](...|
	readonly #linkStartPattern = new RegExp(
		// text
		r`\[` +
		/**/r`(?:` +
		/*****/r`[^\[\]\\]|` + // Non-bracket chars, or...
		/*****/r`\\.|` + // Escaped char, or...
		/*****/r`\[[^\[\]]*\]` + // Matched bracket pair
		/**/r`)*` +
		r`\]` +
		// Destination start
		r`\(\s*(<[^\>\)]*|[^\s\(\)]*)` +
		r`$`// Must match cursor position
	);

	/// [...][...|
	readonly #referenceLinkStartPattern = /\[([^\]]*?)\]\[\s*([^\s\(\)]*)$/;

	/// [ref...|
	readonly #referenceLinkShortHandPrefix = /(?<![\]\)])\[([^\s\(\)]*)$/;

	/// [id]: |
	readonly #definitionPattern = /^\s*\[(?!\^)(?:\\\]|\\\[|[^\]\[\n])+]:\s*([^\s]*)$/m;

	/// [id]: |
	readonly #htmlAttributeStartPattern = /\<(?<tag>\w+)([^>]*)\s(?<attr>\w+)=['"](?<link>[^'"]*)$/m;

	#getPathCompletionContext(document: ITextDocument, position: lsp.Position): PathCompletionContext | undefined {
		const line = getLine(document, position.line);

		const linePrefixText = line.slice(0, position.character);
		const lineSuffixText = line.slice(position.character);

		const htmlAttributePrefixMatch = linePrefixText.match(this.#htmlAttributeStartPattern);
		if (htmlAttributePrefixMatch?.groups) {
			const validPathAttrs = htmlTagPathAttrs.get(htmlAttributePrefixMatch.groups.tag.toUpperCase());
			if (!validPathAttrs || !validPathAttrs.some(attr => attr === htmlAttributePrefixMatch.groups!.attr.toLowerCase())) {
				return undefined;
			}

			const prefix = htmlAttributePrefixMatch.groups.link;
			if (this.#refLooksLikeUrl(prefix)) {
				return undefined;
			}

			const suffix = lineSuffixText.match(/^[^\s'"]*/);
			return this.#createCompletionContext(CompletionContextKind.HtmlAttribute, position, prefix, suffix?.[0] ?? '', false);
		}

		const linkPrefixMatch = linePrefixText.match(this.#linkStartPattern);
		if (linkPrefixMatch) {
			const isAngleBracketLink = linkPrefixMatch[1].startsWith('<');
			const prefix = linkPrefixMatch[1].slice(isAngleBracketLink ? 1 : 0);
			if (this.#refLooksLikeUrl(prefix)) {
				return undefined;
			}

			const suffix = lineSuffixText.match(/^[^\)\s][^\)\s\>]*/);
			return this.#createCompletionContext(CompletionContextKind.Link, position, prefix, suffix?.[0] ?? '', isAngleBracketLink);
		}

		const definitionLinkPrefixMatch = linePrefixText.match(this.#definitionPattern);
		if (definitionLinkPrefixMatch) {
			const isAngleBracketLink = definitionLinkPrefixMatch[1].startsWith('<');
			const prefix = definitionLinkPrefixMatch[1].slice(isAngleBracketLink ? 1 : 0);
			if (this.#refLooksLikeUrl(prefix)) {
				return undefined;
			}

			const suffix = lineSuffixText.match(/^[^\s]*/);
			return this.#createCompletionContext(CompletionContextKind.LinkDefinition, position, prefix, suffix?.[0] ?? '', isAngleBracketLink);
		}

		const fullReferenceLinkPrefixMatch = linePrefixText.match(this.#referenceLinkStartPattern);
		if (fullReferenceLinkPrefixMatch) {
			const prefix = fullReferenceLinkPrefixMatch[2];
			const suffix = lineSuffixText.match(/^[^\]\s]*/);
			return {
				kind: CompletionContextKind.ReferenceLink,
				linkPrefix: prefix,
				linkTextStartPosition: translatePosition(position, { characterDelta: -prefix.length }),
				linkSuffix: suffix ? suffix[0] : '',
			};
		}

		const shorthandReferenceLinkPrefixMatch = linePrefixText.match(this.#referenceLinkShortHandPrefix);
		if (shorthandReferenceLinkPrefixMatch) {
			const prefix = shorthandReferenceLinkPrefixMatch[1];
			const suffix = lineSuffixText.match(/^[^\]\s]*/);
			return {
				kind: CompletionContextKind.ReferenceLink,
				linkPrefix: prefix,
				linkTextStartPosition: translatePosition(position, { characterDelta: -prefix.length }),
				linkSuffix: suffix ? suffix[0] : '',
			};
		}

		return undefined;
	}

	#createCompletionContext(kind: CompletionContextKind, position: lsp.Position, prefix: string, suffix: string, isAngleBracketPath: boolean): PathCompletionContext | undefined {
		return {
			kind,
			linkPrefix: prefix,
			linkTextStartPosition: translatePosition(position, { characterDelta: -prefix.length }),
			linkSuffix: suffix,
			anchorInfo: this.#getAnchorContext(prefix),
			isAngleBracketPath,
		};
	}

	/**
	 * Check if {@param ref} looks like a 'http:' style url.
	 */
	#refLooksLikeUrl(prefix: string): boolean {
		return /^\s*[\w\d\-]+:/.test(prefix);
	}

	#getAnchorContext(prefix: string): AnchorContext | undefined {
		const anchorMatch = prefix.match(/^([^#]*)#([^#]*)$/);
		if (!anchorMatch) {
			return undefined;
		}
		return {
			beforeAnchor: anchorMatch[1],
			anchorPrefix: anchorMatch[2],
		};
	}

	async *#provideReferenceSuggestions(document: ITextDocument, position: lsp.Position, context: PathCompletionContext, token: CancellationToken): AsyncIterable<lsp.CompletionItem> {
		const insertionRange = lsp.Range.create(context.linkTextStartPosition, position);
		const replacementRange = lsp.Range.create(insertionRange.start, translatePosition(position, { characterDelta: context.linkSuffix.length }));

		const { definitions } = await this.#linkProvider.getLinks(document);
		if (token.isCancellationRequested) {
			return;
		}

		for (const def of definitions) {
			yield {
				kind: lsp.CompletionItemKind.Reference,
				label: def.ref.text,
				detail: l10n.t(`Reference link '{0}'`, def.ref.text),
				textEdit: {
					newText: def.ref.text,
					insert: insertionRange,
					replace: replacementRange,
				},
			};
		}
	}

	async *#provideHeaderSuggestions(document: ITextDocument, position: lsp.Position, context: PathCompletionContext, insertionRange: lsp.Range, token: CancellationToken): AsyncIterable<lsp.CompletionItem> {
		const toc = await TableOfContents.createForContainingDoc(this.#parser, this.#workspace, document, token);
		if (token.isCancellationRequested) {
			return;
		}

		const replacementRange = lsp.Range.create(insertionRange.start, translatePosition(position, { characterDelta: context.linkSuffix.length }));
		for (const entry of toc.entries) {
			const completionItem = this.#createHeaderCompletion(entry, insertionRange, replacementRange);
			completionItem.labelDetails = {

			};
			yield completionItem;
		}
	}

	#createHeaderCompletion(entry: TocEntry, insertionRange: lsp.Range, replacementRange: lsp.Range, filePath = ''): lsp.CompletionItem {
		const label = '#' + decodeURIComponent(entry.slug.value);
		const newText = filePath + '#' + decodeURIComponent(entry.slug.value);
		return {
			kind: lsp.CompletionItemKind.Reference,
			label,
			detail: this.#ownHeaderEntryDetails(entry),
			textEdit: {
				newText,
				insert: insertionRange,
				replace: replacementRange,
			},
		};
	}

	#ownHeaderEntryDetails(entry: TocEntry): string | undefined {
		return l10n.t(`Link to '{0}'`, '#'.repeat(entry.level) + ' ' + entry.text);
	}

	/**
	 * Suggestions for headers across  all md files in the workspace
	 */
	async *#provideWorkspaceHeaderSuggestions(document: ITextDocument, position: lsp.Position, context: PathCompletionContext, insertionRange: lsp.Range, token: CancellationToken): AsyncIterable<lsp.CompletionItem> {
		const tocs = await this.#workspaceTocCache.entries();
		if (token.isCancellationRequested) {
			return;
		}

		const replacementRange = lsp.Range.create(insertionRange.start, translatePosition(position, { characterDelta: context.linkSuffix.length }));
		for (const [toDoc, toc] of tocs) {
			const isHeaderInCurrentDocument = isSameResource(toDoc, getDocUri(document));

			const rawPath = isHeaderInCurrentDocument ? '' : computeRelativePath(getDocUri(document), toDoc);
			if (typeof rawPath === 'undefined') {
				continue;
			}

			const normalizedPath = this.#normalizeFileNameCompletion(rawPath);
			const path = this.#getPathInsertText(context, normalizedPath);
			for (const entry of toc.entries) {
				const completionItem = this.#createHeaderCompletion(entry, insertionRange, replacementRange, path);
				completionItem.filterText = '#' + completionItem.label;
				completionItem.sortText = isHeaderInCurrentDocument ? sortTexts.localHeader : sortTexts.workspaceHeader;

				if (isHeaderInCurrentDocument) {
					completionItem.detail = this.#ownHeaderEntryDetails(entry);
				} else if (path) {
					completionItem.detail = l10n.t(`Link to '# {0}' in '{1}'`, entry.text, path);
					completionItem.labelDetails = { description: path };
				}
				yield completionItem;
			}
		}
	}

	async *#providePathSuggestions(document: ITextDocument, position: lsp.Position, context: PathCompletionContext, token: CancellationToken): AsyncIterable<lsp.CompletionItem> {
		const valueBeforeLastSlash = context.linkPrefix.substring(0, context.linkPrefix.lastIndexOf('/') + 1);// keep the last slash
		const parentDir = this.#resolveReference(document, valueBeforeLastSlash ? tryDecodeUriComponent(valueBeforeLastSlash) : '.');
		if (!parentDir) {
			return;
		}

		const pathSegmentStart = translatePosition(position, { characterDelta: valueBeforeLastSlash.length - context.linkPrefix.length });
		const insertRange = lsp.Range.create(pathSegmentStart, position);

		const pathSegmentEnd = translatePosition(position, { characterDelta: context.linkSuffix.length });
		const replacementRange = lsp.Range.create(pathSegmentStart, pathSegmentEnd);

		let dirInfo: Iterable<readonly [string, FileStat]>;
		try {
			dirInfo = await this.#workspace.readDirectory(parentDir);
		} catch {
			return;
		}

		if (token.isCancellationRequested) {
			return;
		}

		// eslint-disable-next-line prefer-const
		for (let [name, type] of dirInfo) {
			const uri = Utils.joinPath(parentDir, name);
			if (isExcludedPath(this.#configuration, uri)) {
				continue;
			}

			if (!type.isDirectory) {
				name = this.#normalizeFileNameCompletion(name);
			}

			const isDir = type.isDirectory;
			const newText = this.#getPathInsertText(context, name) + (isDir ? '/' : '');
			const label = isDir ? name + '/' : name;
			yield {
				label,
				kind: isDir ? lsp.CompletionItemKind.Folder : lsp.CompletionItemKind.File,
				detail: l10n.t(`Link to '{0}'`, label),
				documentation: this.#getPathDocumentation(uri, type),
				textEdit: {
					newText,
					insert: insertRange,
					replace: replacementRange,
				},
				command: isDir ? { command: 'editor.action.triggerSuggest', title: '' } : undefined,
			};
		}
	}

	#getPathDocumentation(uri: URI, stat: FileStat): lsp.MarkupContent {
		let documentation = stat.isDirectory
			? mdBuilder.inlineCode(uri.path + '/') // TODO: support links to folders too
			: mdBuilder.codeLink(uri.path, uri);

		if (!stat.isDirectory) {
			const maxMediaWidth = 300;
			switch (getMediaPreviewType(uri)) {
				case MediaType.Image: {
					documentation += `\n\n${mdBuilder.imageLink(uri, 'Linked image', maxMediaWidth)}`;
					break;
				}
				case MediaType.Video: {
					documentation += `\n\n${mdBuilder.video(uri, maxMediaWidth)}`;
					break;
				}
			}
		}

		return {
			kind: lsp.MarkupKind.Markdown,
			value: documentation,
		};
	}

	#getPathInsertText(context: PathCompletionContext, name: string): string {
		// If the  path has a literal `%` in it, we need encode it to prevent
		// it being incorrectly decoded
		name = name.replaceAll('%', '%25');

		if (context.kind === CompletionContextKind.HtmlAttribute) {
			return name
				.replaceAll(`"`, '&quot;')
				.replaceAll(`'`, '&apos;');
		}

		if (context.isAngleBracketPath) {
			return escapeForAngleBracketLink(name);
		}

		if (!hasBalancedParens(name)) {
			name = name.replace(/([()])/g, '\\$1'); // CodeQL [SM02383] This code is for editing text, not sanitizing rendered markdown
		}

		return name.replaceAll(' ', '%20');
	}

	#normalizeFileNameCompletion(name: string): string {
		if (this.#configuration.preferredMdPathExtensionStyle === 'removeExtension') {
			if (looksLikeMarkdownFilePath(this.#configuration, name)) {
				const ext = extname(name);
				name = name.slice(0, -ext.length);
			}
		}
		return name;
	}

	#resolveReference(document: ITextDocument, ref: string): URI | undefined {
		const docUri = this.#getFileUriOfTextDocument(document);

		if (ref.startsWith('/')) {
			const workspaceFolder = getWorkspaceFolder(this.#workspace, docUri);
			if (workspaceFolder) {
				return Utils.joinPath(workspaceFolder, ref);
			} else {
				return this.#resolvePath(docUri, ref.slice(1));
			}
		}

		return this.#resolvePath(docUri, ref);
	}

	#resolvePath(root: URI, ref: string): URI | undefined {
		try {
			if (root.scheme === Schemes.file) {
				return URI.file(resolve(dirname(root.fsPath), ref));
			} else {
				return root.with({
					path: resolve(dirname(root.path), ref),
				});
			}
		} catch {
			return undefined;
		}
	}

	#getFileUriOfTextDocument(document: ITextDocument): URI {
		return this.#workspace.getContainingDocument?.(getDocUri(document))?.uri ?? getDocUri(document);
	}
}
