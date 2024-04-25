/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as lsp from 'vscode-languageserver-protocol';
import { URI } from 'vscode-uri';
import { LsConfiguration } from '../config';
import { HrefKind, LinkDefinitionSet, MdLinkDefinition } from '../types/documentLink';
import { InMemoryDocument } from '../types/inMemoryDocument';
import { isBefore, isBeforeOrEqual } from '../types/position';
import { rangeContains } from '../types/range';
import { getDocUri, ITextDocument } from '../types/textDocument';
import { removeNewUriExtIfNeeded } from '../util/mdLinks';
import { computeRelativePath, isSameResource } from '../util/path';
import { createAddDefinitionEdit } from './codeActions/extractLinkDef';
import { MdLinkProvider } from './documentLinks';

class PasteLinksCopyMetadata {

    static fromJSON(json: string): PasteLinksCopyMetadata {
        const obj = JSON.parse(json);
        return new PasteLinksCopyMetadata(URI.parse(obj.source), new LinkDefinitionSet(obj.links));
    }

    constructor(
        readonly source: URI,
        readonly links: LinkDefinitionSet | undefined,
    ) { }

    toJSON(): string {
        return JSON.stringify({
            source: this.source.toString(),
            links: this.links ? Array.from(this.links) : undefined,
        });
    }
}

export class MdUpdatePastedLinksProvider {

    readonly #config: LsConfiguration;
    readonly #linkProvider: MdLinkProvider;

    constructor(
        config: LsConfiguration,
        linkProvider: MdLinkProvider,
    ) {
        this.#config = config;
        this.#linkProvider = linkProvider;
    }

    async prepareDocumentPaste(document: ITextDocument, _ranges: readonly lsp.Range[], token: lsp.CancellationToken): Promise<string> {
        const linkInfo = await this.#linkProvider.getLinks(document);
        if (token.isCancellationRequested) {
            return '';
        }

        const metadata = new PasteLinksCopyMetadata(getDocUri(document), linkInfo.definitions);
        return metadata.toJSON();
    }

    async provideDocumentPasteEdits(
        targetDocument: ITextDocument,
        pastes: readonly lsp.TextEdit[],
        rawCopyMetadata: string,
        token: lsp.CancellationToken,
    ): Promise<lsp.TextEdit[] | undefined> {
        const metadata = this.#parseMetadata(rawCopyMetadata);
        if (!metadata) {
            return;
        }

        // If pasting into same doc copied from, there's no need to rewrite anything
        if (isSameResource(getDocUri(targetDocument), metadata.source)) {
            return;
        }

        // Bail early if there's nothing that looks like it could be a link in the pasted text
        if (!pastes.some(p => p.newText.includes(']') || p.newText.includes('<'))) {
            return undefined;
        }

        const sortedPastes = Array.from(pastes).sort((a, b) => targetDocument.offsetAt(a.range.start) - targetDocument.offsetAt(b.range.start));

        // Find the links in the pasted text by applying the paste edits to an in-memory document.
        // Use `copySource` as the doc uri to make sure links are resolved in its context
        const editedDoc = new InMemoryDocument(metadata.source, targetDocument.getText());
        editedDoc.replaceContents(editedDoc.previewEdits(sortedPastes));

        const allLinks = await this.#linkProvider.getLinksWithoutCaching(editedDoc, token);
        if (token.isCancellationRequested) {
            return;
        }

        const pastedRanges = this.#computedPastedRanges(sortedPastes, targetDocument, editedDoc);

        const linksToRewrite = allLinks.links
            // We only rewrite relative links and references
            .filter(link => {
                if (link.href.kind === HrefKind.Reference) {
                    return true;
                }
                return link.href.kind === HrefKind.Internal
                    && !link.source.hrefText.startsWith('/') // No need to rewrite absolute paths
                    && link.href.path.scheme === metadata.source.scheme && link.href.path.authority === metadata.source.authority; // Only rewrite links that are in the same workspace
            })
            // And the link be newly added (i.e. in one of the pasted ranges)
            .filter(link => pastedRanges.some(range => rangeContains(range, link.source.range)));

        // Generate edits
        const newDefinitionsToAdd: MdLinkDefinition[] = [];
        const rewriteLinksEdits: lsp.TextEdit[] = [];
        for (const link of linksToRewrite) {
            if (link.href.kind === HrefKind.Reference) {
                // See if we've already added the def
                if (new LinkDefinitionSet(newDefinitionsToAdd).lookup(link.href.ref)) {
                    continue;
                }

                const originalRef = metadata.links?.lookup(link.href.ref);
                if (!originalRef) {
                    continue;
                }

                // If there's an existing definition with the same exact ref, we don't need to add it again
                if (allLinks.definitions.lookup(link.href.ref)?.source.hrefText === originalRef.source.hrefText) {
                    continue;
                }

                newDefinitionsToAdd.push(originalRef);

            } else if (link.href.kind === HrefKind.Internal) {
                const targetDocUri = getDocUri(targetDocument);
                const newPathText = isSameResource(targetDocUri, link.href.path)
                    ? ''
                    : computeRelativePath(targetDocUri, removeNewUriExtIfNeeded(this.#config, link.href, link.href.path));

                if (typeof newPathText === 'undefined') {
                    continue;
                }

                let newHrefText = newPathText;
                if (link.source.fragmentRange) {
                    newHrefText += '#' + link.href.fragment;
                }

                if (link.source.hrefText !== newHrefText) {
                    rewriteLinksEdits.push(lsp.TextEdit.replace(link.source.hrefRange, newHrefText));
                }
            }
        }

        // If nothing was rewritten we can just use normal text paste
        if (!rewriteLinksEdits.length && !newDefinitionsToAdd.length) {
            return;
        }

        // Generate a minimal set of edits for the pastes
        const outEdits: lsp.TextEdit[] = [];
        const finalDoc = new InMemoryDocument(editedDoc.$uri, editedDoc.previewEdits(rewriteLinksEdits));

        let offsetAdjustment = 0;
        for (let i = 0; i < pastedRanges.length; ++i) {
            const pasteRange = pastedRanges[i];
            const originalPaste = sortedPastes[i];

            // Adjust the range to account for the `rewriteLinksEdits`
            for (
                let edit: lsp.TextEdit | undefined;
                (edit = rewriteLinksEdits[0]) && isBefore(edit.range.start, pasteRange.start);
                rewriteLinksEdits.shift()
            ) {
                offsetAdjustment += computeEditLengthChange(edit, editedDoc);
            }
            const startOffset = editedDoc.offsetAt(pasteRange.start) + offsetAdjustment;

            for (
                let edit: lsp.TextEdit | undefined;
                (edit = rewriteLinksEdits[0]) && isBeforeOrEqual(edit.range.end, pasteRange.end);
                rewriteLinksEdits.shift()
            ) {
                offsetAdjustment += computeEditLengthChange(edit, editedDoc);
            }
            const endOffset = editedDoc.offsetAt(pasteRange.end) + offsetAdjustment;

            const range = lsp.Range.create(finalDoc.positionAt(startOffset), finalDoc.positionAt(endOffset));
            outEdits.push(lsp.TextEdit.replace(originalPaste.range, finalDoc.getText(range)));
        }

        // Add an edit that inserts new definitions
        if (newDefinitionsToAdd.length) {
            const targetLinks = await this.#linkProvider.getLinks(targetDocument);
            if (token.isCancellationRequested) {
                return;
            }
            outEdits.push(createAddDefinitionEdit(targetDocument, Array.from(targetLinks.definitions), newDefinitionsToAdd.map(def => ({ placeholder: def.ref.text, definitionText: def.source.hrefText }))));
        }

        return outEdits;
    }

    #parseMetadata(rawCopyMetadata: string): PasteLinksCopyMetadata | undefined {
        try {
            return PasteLinksCopyMetadata.fromJSON(rawCopyMetadata);
        } catch {
            return undefined;
        }
    }

    #computedPastedRanges(sortedPastes: lsp.TextEdit[], targetDocument: ITextDocument, editedDoc: InMemoryDocument) {
        const pastedRanges: lsp.Range[] = [];

        let offsetAdjustment = 0;
        for (const paste of sortedPastes) {
            const originalStartOffset = targetDocument.offsetAt(paste.range.start);
            const originalEndOffset = targetDocument.offsetAt(paste.range.end);

            pastedRanges.push(lsp.Range.create(
                editedDoc.positionAt(originalStartOffset + offsetAdjustment),
                editedDoc.positionAt(originalStartOffset + offsetAdjustment + paste.newText.length)));

            offsetAdjustment += paste.newText.length - (originalEndOffset - originalStartOffset);
        }

        return pastedRanges;
    }
}

function computeEditLengthChange(edit: lsp.TextEdit, editedDoc: InMemoryDocument) {
    return edit.newText.length - (editedDoc.offsetAt(edit.range.end) - editedDoc.offsetAt(edit.range.start));
}
