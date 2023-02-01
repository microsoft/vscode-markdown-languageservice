/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { dirname, resolve } from 'path';
import type { CancellationToken, CompletionContext } from 'vscode-languageserver-protocol';
import * as lsp from 'vscode-languageserver-types';
import { URI, Utils } from 'vscode-uri';
import { isExcludedPath, LsConfiguration } from '../config';
import { IMdParser } from '../parser';
import { MdTableOfContentsProvider, TableOfContents, TocEntry } from '../tableOfContents';
import { translatePosition } from '../types/position';
import { makeRange } from '../types/range';
import { getDocUri, getLine, ITextDocument } from '../types/textDocument';
import { Schemes } from '../util/schemes';
import { r } from '../util/string';
import { FileStat, getWorkspaceFolder, IWorkspace, openLinkToMarkdownFile } from '../workspace';
import { MdWorkspaceInfoCache } from '../workspaceCache';
import { MdLinkProvider } from './documentLinks';
import { computeRelativePath } from './rename';

enum CompletionContextKind {
	/** `[...](|)` */
	Link,

	/** `[...][|]` */
	ReferenceLink,

	/** `[]: |` */
	LinkDefinition,
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
	readonly skipEncoding?: boolean;
}

function tryDecodeUriComponent(str: string): string {
	try {
		return decodeURIComponent(str);
	} catch {
		return str;
	}
}

/**
 * Control the type of completions returned by a {@link MdPathCompletionProvider}.
 */
export interface MdPathCompletionOptions {
	/**
	 * Should header completions for other files in the workspace be returned when
	 * you trigger completions on `##`?
	 * 
	 * Defaults to false (not returned).
	 */
	readonly includeWorkspaceHeaderCompletions?: boolean;
}

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

	public async provideCompletionItems(document: ITextDocument, position: lsp.Position, context: CompletionContext & MdPathCompletionOptions, token: CancellationToken): Promise<lsp.CompletionItem[]> {
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

	async *#provideCompletionItems(document: ITextDocument, position: lsp.Position, context: PathCompletionContext, options: MdPathCompletionOptions, token: CancellationToken): AsyncIterable<lsp.CompletionItem> {
		switch (context.kind) {
			case CompletionContextKind.ReferenceLink: {
				yield* this.#provideReferenceSuggestions(document, position, context, token);
				return;
			}
			case CompletionContextKind.LinkDefinition:
			case CompletionContextKind.Link: {
				if (options.includeWorkspaceHeaderCompletions && context.linkPrefix.startsWith('##')) {
					const insertRange = makeRange(context.linkTextStartPosition, position);
					yield* this.#provideWorkspaceHeaderSuggestions(document, position, context, insertRange, token);
					return;
				}

				const isAnchorInCurrentDoc = context.anchorInfo && context.anchorInfo.beforeAnchor.length === 0;

				// Add anchor #links in current doc
				if (context.linkPrefix.length === 0 || isAnchorInCurrentDoc) {
					const insertRange = makeRange(context.linkTextStartPosition, position);
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
								const range = makeRange(anchorStartPosition, position);
								yield* this.#provideHeaderSuggestions(otherDoc, position, context, range, token);
							}
						}
					} else { // Normal path suggestions
						yield* this.#providePathSuggestions(document, position, context, token);
					}
				}
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

	/// [id]: |
	readonly #definitionPattern = /^\s*\[[\w\-]+\]:\s*([^\s]*)$/m;

	#getPathCompletionContext(document: ITextDocument, position: lsp.Position): PathCompletionContext | undefined {
		const line = getLine(document, position.line);

		const linePrefixText = line.slice(0, position.character);
		const lineSuffixText = line.slice(position.character);

		const linkPrefixMatch = linePrefixText.match(this.#linkStartPattern);
		if (linkPrefixMatch) {
			const isAngleBracketLink = linkPrefixMatch[1].startsWith('<');
			const prefix = linkPrefixMatch[1].slice(isAngleBracketLink ? 1 : 0);
			if (this.#refLooksLikeUrl(prefix)) {
				return undefined;
			}

			const suffix = lineSuffixText.match(/^[^\)\s][^\)\s\>]*/);
			return {
				kind: CompletionContextKind.Link,
				linkPrefix: tryDecodeUriComponent(prefix),
				linkTextStartPosition: translatePosition(position, { characterDelta: -prefix.length }),
				linkSuffix: suffix ? suffix[0] : '',
				anchorInfo: this.#getAnchorContext(prefix),
				skipEncoding: isAngleBracketLink,
			};
		}

		const definitionLinkPrefixMatch = linePrefixText.match(this.#definitionPattern);
		if (definitionLinkPrefixMatch) {
			const isAngleBracketLink = definitionLinkPrefixMatch[1].startsWith('<');
			const prefix = definitionLinkPrefixMatch[1].slice(isAngleBracketLink ? 1 : 0);
			if (this.#refLooksLikeUrl(prefix)) {
				return undefined;
			}

			const suffix = lineSuffixText.match(/^[^\s]*/);
			return {
				kind: CompletionContextKind.LinkDefinition,
				linkPrefix: tryDecodeUriComponent(prefix),
				linkTextStartPosition: translatePosition(position, { characterDelta: -prefix.length }),
				linkSuffix: suffix ? suffix[0] : '',
				anchorInfo: this.#getAnchorContext(prefix),
				skipEncoding: isAngleBracketLink,
			};
		}

		const referenceLinkPrefixMatch = linePrefixText.match(this.#referenceLinkStartPattern);
		if (referenceLinkPrefixMatch) {
			const prefix = referenceLinkPrefixMatch[2];
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

	/**
	 * Check if {@param ref} looks like a 'http:' style url.
	 */
	#refLooksLikeUrl(prefix: string): boolean {
		return /^\s*[\w\d\-]+:/.test(prefix);
	}

	#getAnchorContext(prefix: string): AnchorContext | undefined {
		const anchorMatch = prefix.match(/^(.*)#([\w\d\-]*)$/);
		if (!anchorMatch) {
			return undefined;
		}
		return {
			beforeAnchor: anchorMatch[1],
			anchorPrefix: anchorMatch[2],
		};
	}

	async *#provideReferenceSuggestions(document: ITextDocument, position: lsp.Position, context: PathCompletionContext, token: CancellationToken): AsyncIterable<lsp.CompletionItem> {
		const insertionRange = makeRange(context.linkTextStartPosition, position);
		const replacementRange = makeRange(insertionRange.start, translatePosition(position, { characterDelta: context.linkSuffix.length }));

		const { definitions } = await this.#linkProvider.getLinks(document);
		if (token.isCancellationRequested) {
			return;
		}

		for (const def of definitions) {
			yield {
				kind: lsp.CompletionItemKind.Reference,
				label: def.ref.text,
				textEdit: {
					newText: def.ref.text,
					insert: insertionRange,
					replace: replacementRange,
				}
			};
		}
	}

	async *#provideHeaderSuggestions(document: ITextDocument, position: lsp.Position, context: PathCompletionContext, insertionRange: lsp.Range, token: CancellationToken): AsyncIterable<lsp.CompletionItem> {
		const toc = await TableOfContents.createForContainingDoc(this.#parser, this.#workspace, document, token);
		if (token.isCancellationRequested) {
			return;
		}

		const replacementRange = makeRange(insertionRange.start, translatePosition(position, { characterDelta: context.linkSuffix.length }));
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
			textEdit: {
				newText,
				insert: insertionRange,
				replace: replacementRange,
			},
		};
	}

	/**
	 * Suggestions for headers across  all md files in the workspace
	 */
	async *#provideWorkspaceHeaderSuggestions(document: ITextDocument, position: lsp.Position, context: PathCompletionContext, insertionRange: lsp.Range, token: CancellationToken): AsyncIterable<lsp.CompletionItem> {
		const tocs = await this.#workspaceTocCache.entries();
		if (token.isCancellationRequested) {
			return;
		}

		const replacementRange = makeRange(insertionRange.start, translatePosition(position, { characterDelta: context.linkSuffix.length }));
		for (const [toDoc, toc] of tocs) {
			const rawPath = toDoc.toString() === getDocUri(document).toString() ? '' : computeRelativePath(getDocUri(document), toDoc);
			if (typeof rawPath === 'undefined') {
				continue;
			}

			const path = context.skipEncoding ? rawPath : encodeURI(rawPath);
			for (const entry of toc.entries) {
				const completionItem = this.#createHeaderCompletion(entry, insertionRange, replacementRange, path);
				completionItem.filterText = '#' + completionItem.label;
				if (path) {
					completionItem.detail = l10n.t(`Link to '# {0}' in '{1}'`, entry.text, path);
					completionItem.labelDetails = { description: path };
				}
				yield completionItem;
			}
		}
	}

	async *#providePathSuggestions(document: ITextDocument, position: lsp.Position, context: PathCompletionContext, token: CancellationToken): AsyncIterable<lsp.CompletionItem> {
		const valueBeforeLastSlash = context.linkPrefix.substring(0, context.linkPrefix.lastIndexOf('/') + 1); // keep the last slash

		const parentDir = this.#resolveReference(document, valueBeforeLastSlash || '.');
		if (!parentDir) {
			return;
		}

		const pathSegmentStart = translatePosition(position, { characterDelta: valueBeforeLastSlash.length - context.linkPrefix.length });
		const insertRange = makeRange(pathSegmentStart, position);

		const pathSegmentEnd = translatePosition(position, { characterDelta: context.linkSuffix.length });
		const replacementRange = makeRange(pathSegmentStart, pathSegmentEnd);

		let dirInfo: Iterable<readonly [string, FileStat]>;
		try {
			dirInfo = await this.#workspace.readDirectory(parentDir);
		} catch {
			return;
		}

		if (token.isCancellationRequested) {
			return;
		}

		for (const [name, type] of dirInfo) {
			const uri = Utils.joinPath(parentDir, name);
			if (isExcludedPath(this.#configuration, uri)) {
				continue;
			}

			const isDir = type.isDirectory;
			const newText = (context.skipEncoding ? name : encodeURIComponent(name)) + (isDir ? '/' : '');
			yield {
				label: isDir ? name + '/' : name,
				kind: isDir ? lsp.CompletionItemKind.Folder : lsp.CompletionItemKind.File,
				textEdit: {
					newText,
					insert: insertRange,
					replace: replacementRange,
				},
				command: isDir ? { command: 'editor.action.triggerSuggest', title: '' } : undefined,
			};
		}
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
