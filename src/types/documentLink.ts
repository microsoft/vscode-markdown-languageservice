/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as lsp from 'vscode-languageserver-protocol';
import { URI } from 'vscode-uri';

export enum HrefKind {
    External,
    Internal,
    Reference
}

export interface ExternalHref {
    readonly kind: HrefKind.External;
    readonly uri: URI;
}

export interface InternalHref {
    readonly kind: HrefKind.Internal;
    readonly path: URI;
    readonly fragment: string;
}

export interface ReferenceHref {
    readonly kind: HrefKind.Reference;
    readonly ref: string;
}

export type LinkHref = ExternalHref | InternalHref | ReferenceHref;

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
     * The range of the entire link target.
     *
     * This includes the opening `(`/`[` and closing `)`/`]`.
     *
     * For `[boris](/cat.md#siberian "title")` this would be the range of `(/cat.md#siberian "title")`
     */
    readonly targetRange: lsp.Range;

    /**
     * The original text of the link destination in code.
     *
     * For `[boris](/cat.md#siberian "title")` this would be `/cat.md#siberian`
     *
     */
    readonly hrefText: string;

    /**
     * The original text of just the link's path in code.
     *
     * For `[boris](/cat.md#siberian "title")` this would be `/cat.md`
     */
    readonly hrefPathText: string;

    /**
     * The range of the path in this link.
     *
     * Does not include whitespace or the link title.
     *
     * For `[boris](/cat.md#siberian "title")` this would be the range of `/cat.md#siberian`
     */
    readonly hrefRange: lsp.Range;

    /**
     * The range of the fragment within the path.
     *
     * For `[boris](/cat.md#siberian "title")` this would be the range of `#siberian`
     */
    readonly hrefFragmentRange: lsp.Range | undefined;

    readonly isAngleBracketLink: boolean;

    /**
     * The range of the link title if there is one
     * 
     * For `[boris](/cat.md#siberian "title")` this would be `"title"`
     */
    readonly titleRange: lsp.Range | undefined;
}

export enum MdLinkKind {
    /** Standard Markdown link syntax: `[text][ref]` or `[text](http://example.com)` */
    Link = 1,

    /** Link definition: `[def]: http://example.com` */
    Definition = 2,

    /** Auto link: `<http://example.com>` */
    AutoLink = 3,
}

export interface MdInlineLink<HrefType = LinkHref> {
    readonly kind: MdLinkKind.Link;
    readonly source: MdLinkSource;
    readonly href: HrefType;
}

export interface MdLinkDefinition {
    readonly kind: MdLinkKind.Definition;
    readonly source: MdLinkSource;
    readonly ref: {
        readonly range: lsp.Range;
        readonly text: string;
    };
    readonly href: ExternalHref | InternalHref;
}

export interface MdAutoLink {
    readonly kind: MdLinkKind.AutoLink;
    readonly source: MdLinkSource;
    readonly href: ExternalHref;
}

export type MdLink = MdInlineLink | MdLinkDefinition | MdAutoLink;


/**
 * A map that lets you look up definitions by reference name.
 */
export class LinkDefinitionSet implements Iterable<MdLinkDefinition> {
    readonly #map = new ReferenceLinkMap<MdLinkDefinition>();

    constructor(links: Iterable<MdLink>) {
        for (const link of links) {
            if (link.kind === MdLinkKind.Definition) {
                if (!this.#map.has(link.ref.text)) {
                    this.#map.set(link.ref.text, link);
                }
            }
        }
    }

    public [Symbol.iterator](): Iterator<MdLinkDefinition> {
        return this.#map[Symbol.iterator]();
    }

    public lookup(ref: string): MdLinkDefinition | undefined {
        return this.#map.lookup(ref);
    }
}

/**
 * A store of link reference names.
 * 
 * Correctly normalizes reference names.
 */
export class ReferenceLinkMap<T> {
    readonly #map = new Map</* normalized ref */ string, T>();

    public set(ref: string, link: T) {
        this.#map.set(this.#normalizeRefName(ref), link);
    }

    public lookup(ref: string): T | undefined {
        return this.#map.get(this.#normalizeRefName(ref));
    }

    public has(ref: string): boolean {
        return this.#map.has(this.#normalizeRefName(ref));
    }

    public [Symbol.iterator](): Iterator<T> {
        return this.#map.values();
    }

    /**
     * Normalizes a link reference. Link references are case-insensitive, so this lowercases the reference so you can
     * correctly compare two normalized references.
     */
    #normalizeRefName(ref: string): string {
        return ref.normalize().trim().toLowerCase();
    }
}
