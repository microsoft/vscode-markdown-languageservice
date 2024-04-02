/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/
import * as lsp from 'vscode-languageserver-protocol';
import { URI } from 'vscode-uri';
import { IMdParser } from '../parser';
import { InMemoryDocument } from '../types/inMemoryDocument';
import { rangeContains } from '../types/range';
import { getDocUri, ITextDocument } from '../types/textDocument';
import { computeRelativePath } from '../util/path';
import { IWorkspace } from '../workspace';
import { createAddDefinitionEdit } from './codeActions/extractLinkDef';
import { HrefKind, LinkDefinitionSet, MdLinkComputer, MdLinkDefinition } from './documentLinks';

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

    readonly #linkComputer: MdLinkComputer;

    constructor(
        tokenizer: IMdParser,
        workspace: IWorkspace,
    ) {
        this.#linkComputer = new MdLinkComputer(tokenizer, workspace);
    }

    async prepareDocumentPaste(document: ITextDocument, _ranges: readonly lsp.Range[], token: lsp.CancellationToken): Promise<string> {
        const links = await this.#linkComputer.getAllLinks(document, token);
        if (token.isCancellationRequested) {
            return '';
        }

        const metadata = new PasteLinksCopyMetadata(getDocUri(document), new LinkDefinitionSet(links));
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
        if (getDocUri(targetDocument).toString() === metadata.toString()) {
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
        editedDoc.updateContent(editedDoc.applyEdits(sortedPastes));

        const allLinks = await this.#linkComputer.getAllLinks(editedDoc, token);
        if (token.isCancellationRequested) {
            return;
        }

        const pastedRanges = this.#computedPastedRanges(sortedPastes, targetDocument, editedDoc);

        const currentDefinitionSet = new LinkDefinitionSet(allLinks);
        const linksToRewrite = allLinks
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
                if (currentDefinitionSet.lookup(link.href.ref)?.source.hrefText === originalRef.source.hrefText) {
                    continue;
                }

                newDefinitionsToAdd.push(originalRef);

            } else if (link.href.kind === HrefKind.Internal) {
                const newPathText = computeRelativePath(getDocUri(targetDocument), link.href.path);
                if (!newPathText) {
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
        
        // Plus add an edit that inserts new definitions
        if (newDefinitionsToAdd.length) {
            rewriteLinksEdits.push(createAddDefinitionEdit(editedDoc, [...currentDefinitionSet], newDefinitionsToAdd.map(def => ({ placeholder: def.ref.text, definitionText: def.source.hrefText }))));
        }

        // If nothing was rewritten we can just use normal text paste.
        if (!rewriteLinksEdits.length) {
            return;
        }

        // Generate the final edits by grabbing text from the edited document
        const finalDoc = new InMemoryDocument(editedDoc.$uri, editedDoc.applyEdits(rewriteLinksEdits));

        // TODO: generate more minimal edit
        return [
            lsp.TextEdit.replace(lsp.Range.create(0, 0, 100_000, 0), finalDoc.getText()),
        ];
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