/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vscode-uri';


type ResourceToKey = (uri: URI) => string;

const defaultResourceToKey = (resource: URI): string => resource.toString();

export class ResourceMap<T> {

	private readonly _map = new Map<string, { readonly uri: URI; readonly value: T }>();

	private readonly _toKey: ResourceToKey;

	constructor(toKey: ResourceToKey = defaultResourceToKey) {
		this._toKey = toKey;
	}

	public set(uri: URI, value: T): this {
		this._map.set(this._toKey(uri), { uri, value });
		return this;
	}

	public get(resource: URI): T | undefined {
		return this._map.get(this._toKey(resource))?.value;
	}

	public has(resource: URI): boolean {
		return this._map.has(this._toKey(resource));
	}

	public get size(): number {
		return this._map.size;
	}

	public clear(): void {
		this._map.clear();
	}

	public delete(resource: URI): boolean {
		return this._map.delete(this._toKey(resource));
	}

	public *values(): IterableIterator<T> {
		for (const entry of this._map.values()) {
			yield entry.value;
		}
	}

	public *keys(): IterableIterator<URI> {
		for (const entry of this._map.values()) {
			yield entry.uri;
		}
	}

	public *entries(): IterableIterator<[URI, T]> {
		for (const entry of this._map.values()) {
			yield [entry.uri, entry.value];
		}
	}

	public [Symbol.iterator](): IterableIterator<[URI, T]> {
		return this.entries();
	}
}
