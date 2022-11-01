/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { dirname, resolve } from 'path';
import type { CancellationToken, CompletionContext } from 'vscode-languageserver-protocol';
import * as lsp from 'vscode-languageserver-types';
import { URI, Utils } from 'vscode-uri';
import { isExcludedPath, LsConfiguration } from '../config';
import { IMdParser } from '../parser';
import { TableOfContents } from '../tableOfContents';
import { translatePosition } from '../types/position';
import { makeRange } from '../types/range';
import { getDocUri, getLine, ITextDocument } from '../types/textDocument';
import { Schemes } from '../util/schemes';
import { r } from '../util/string';
import { FileStat, getWorkspaceFolder, IWorkspace, openLinkToMarkdownFile } from '../workspace';
import { MdLinkProvider } from './documentLinks';

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
 * Adds path completions in markdown files.
 */
export class MdPathCompletionProvider {

	constructor(
		private readonly _configuration: LsConfiguration,
		private readonly _workspace: IWorkspace,
		private readonly _parser: IMdParser,
		private readonly _linkProvider: MdLinkProvider,
	) { }

	public async provideCompletionItems(document: ITextDocument, position: lsp.Position, _context: CompletionContext, token: CancellationToken): Promise<lsp.CompletionItem[]> {
		const context = this._getPathCompletionContext(document, position);
		if (!context) {
			return [];
		}

		const items: lsp.CompletionItem[] = [];
		for await (const item of this._provideCompletionItems(document, position, context, token)) {
			items.push(item);
		}
		return items;
	}

	private async *_provideCompletionItems(document: ITextDocument, position: lsp.Position, context: PathCompletionContext, token: CancellationToken): AsyncIterable<lsp.CompletionItem> {
		switch (context.kind) {
			case CompletionContextKind.ReferenceLink: {
				yield* this._provideReferenceSuggestions(document, position, context, token);
				return;
			}
			case CompletionContextKind.LinkDefinition:
			case CompletionContextKind.Link: {
				const isAnchorInCurrentDoc = context.anchorInfo && context.anchorInfo.beforeAnchor.length === 0;

				// Add anchor #links in current doc
				if (context.linkPrefix.length === 0 || isAnchorInCurrentDoc) {
					const insertRange = makeRange(context.linkTextStartPosition, position);
					yield* this._provideHeaderSuggestions(document, position, context, insertRange, token);
				}

				if (token.isCancellationRequested) {
					return;
				}

				if (!isAnchorInCurrentDoc) {
					if (context.anchorInfo) { // Anchor to a different document
						const rawUri = this._resolveReference(document, context.anchorInfo.beforeAnchor);
						if (rawUri) {
							const otherDoc = await openLinkToMarkdownFile(this._configuration, this._workspace, rawUri);
							if (token.isCancellationRequested) {
								return;
							}

							if (otherDoc) {
								const anchorStartPosition = translatePosition(position, { characterDelta: -(context.anchorInfo.anchorPrefix.length + 1) });
								const range = makeRange(anchorStartPosition, position);
								yield* this._provideHeaderSuggestions(otherDoc, position, context, range, token);
							}
						}
					} else { // Normal path suggestions
						yield* this._providePathSuggestions(document, position, context, token);
					}
				}

				return;
			}
		}
	}

	/// [...](...|
	private readonly _linkStartPattern = new RegExp(
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
	private readonly _referenceLinkStartPattern = /\[([^\]]*?)\]\[\s*([^\s\(\)]*)$/;

	/// [id]: |
	private readonly _definitionPattern = /^\s*\[[\w\-]+\]:\s*([^\s]*)$/m;

	private _getPathCompletionContext(document: ITextDocument, position: lsp.Position): PathCompletionContext | undefined {
		const line = getLine(document, position.line);

		const linePrefixText = line.slice(0, position.character);
		const lineSuffixText = line.slice(position.character);

		const linkPrefixMatch = linePrefixText.match(this._linkStartPattern);
		if (linkPrefixMatch) {
			const isAngleBracketLink = linkPrefixMatch[1].startsWith('<');
			const prefix = linkPrefixMatch[1].slice(isAngleBracketLink ? 1 : 0);
			if (this._refLooksLikeUrl(prefix)) {
				return undefined;
			}

			const suffix = lineSuffixText.match(/^[^\)\s][^\)\s\>]*/);
			return {
				kind: CompletionContextKind.Link,
				linkPrefix: tryDecodeUriComponent(prefix),
				linkTextStartPosition: translatePosition(position, { characterDelta: -prefix.length }),
				linkSuffix: suffix ? suffix[0] : '',
				anchorInfo: this._getAnchorContext(prefix),
				skipEncoding: isAngleBracketLink,
			};
		}

		const definitionLinkPrefixMatch = linePrefixText.match(this._definitionPattern);
		if (definitionLinkPrefixMatch) {
			const isAngleBracketLink = definitionLinkPrefixMatch[1].startsWith('<');
			const prefix = definitionLinkPrefixMatch[1].slice(isAngleBracketLink ? 1 : 0);
			if (this._refLooksLikeUrl(prefix)) {
				return undefined;
			}

			const suffix = lineSuffixText.match(/^[^\s]*/);
			return {
				kind: CompletionContextKind.LinkDefinition,
				linkPrefix: tryDecodeUriComponent(prefix),
				linkTextStartPosition: translatePosition(position, { characterDelta: -prefix.length }),
				linkSuffix: suffix ? suffix[0] : '',
				anchorInfo: this._getAnchorContext(prefix),
				skipEncoding: isAngleBracketLink,
			};
		}

		const referenceLinkPrefixMatch = linePrefixText.match(this._referenceLinkStartPattern);
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
	private _refLooksLikeUrl(prefix: string): boolean {
		return /^\s*[\w\d\-]+:/.test(prefix);
	}

	private _getAnchorContext(prefix: string): AnchorContext | undefined {
		const anchorMatch = prefix.match(/^(.*)#([\w\d\-]*)$/);
		if (!anchorMatch) {
			return undefined;
		}
		return {
			beforeAnchor: anchorMatch[1],
			anchorPrefix: anchorMatch[2],
		};
	}

	private async *_provideReferenceSuggestions(document: ITextDocument, position: lsp.Position, context: PathCompletionContext, token: CancellationToken): AsyncIterable<lsp.CompletionItem> {
		const insertionRange = makeRange(context.linkTextStartPosition, position);
		const replacementRange = makeRange(insertionRange.start, translatePosition(position, { characterDelta: context.linkSuffix.length }));

		const { definitions } = await this._linkProvider.getLinks(document);
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

	private async *_provideHeaderSuggestions(document: ITextDocument, position: lsp.Position, context: PathCompletionContext, insertionRange: lsp.Range, token: CancellationToken): AsyncIterable<lsp.CompletionItem> {
		const toc = await TableOfContents.createForContainingDoc(this._parser, this._workspace, document, token);
		if (token.isCancellationRequested) {
			return;
		}

		for (const entry of toc.entries) {
			const replacementRange = makeRange(insertionRange.start, translatePosition(position, { characterDelta: context.linkSuffix.length }));
			const label = '#' + decodeURIComponent(entry.slug.value);
			yield {
				kind: lsp.CompletionItemKind.Reference,
				label,
				textEdit: {
					newText: label,
					insert: insertionRange,
					replace: replacementRange,
				},
			};
		}
	}

	private async *_providePathSuggestions(document: ITextDocument, position: lsp.Position, context: PathCompletionContext, token: CancellationToken): AsyncIterable<lsp.CompletionItem> {
		const valueBeforeLastSlash = context.linkPrefix.substring(0, context.linkPrefix.lastIndexOf('/') + 1); // keep the last slash

		const parentDir = this._resolveReference(document, valueBeforeLastSlash || '.');
		if (!parentDir) {
			return;
		}

		const pathSegmentStart = translatePosition(position, { characterDelta: valueBeforeLastSlash.length - context.linkPrefix.length });
		const insertRange = makeRange(pathSegmentStart, position);

		const pathSegmentEnd = translatePosition(position, { characterDelta: context.linkSuffix.length });
		const replacementRange = makeRange(pathSegmentStart, pathSegmentEnd);

		let dirInfo: Iterable<readonly [string, FileStat]>;
		try {
			dirInfo = await this._workspace.readDirectory(parentDir);
		} catch {
			return;
		}

		if (token.isCancellationRequested) {
			return;
		}

		for (const [name, type] of dirInfo) {
			const uri = Utils.joinPath(parentDir, name);
			if (isExcludedPath(this._configuration, uri)) {
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

	private _resolveReference(document: ITextDocument, ref: string): URI | undefined {
		const docUri = this._getFileUriOfTextDocument(document);

		if (ref.startsWith('/')) {
			const workspaceFolder = getWorkspaceFolder(this._workspace, docUri);
			if (workspaceFolder) {
				return Utils.joinPath(workspaceFolder, ref);
			} else {
				return this._resolvePath(docUri, ref.slice(1));
			}
		}

		return this._resolvePath(docUri, ref);
	}

	private _resolvePath(root: URI, ref: string): URI | undefined {
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

	private _getFileUriOfTextDocument(document: ITextDocument): URI {
		return this._workspace.getContainingDocument?.(getDocUri(document))?.uri ?? getDocUri(document);
	}
}
