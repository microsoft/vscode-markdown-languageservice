/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface Lazy<T> {
	readonly value: T;
	readonly hasValue: boolean;
	map<R>(f: (x: T) => R): Lazy<R>;
}

class LazyValue<T> implements Lazy<T> {
	#hasValue = false;
	#value?: T;

	readonly #getValue: () => T;

	constructor(getValue: () => T) {
		this.#getValue = getValue;
	}

	get value(): T {
		if (!this.#hasValue) {
			this.#hasValue = true;
			this.#value = this.#getValue();
		}
		return this.#value!;
	}

	get hasValue(): boolean {
		return this.#hasValue;
	}

	public map<R>(f: (x: T) => R): Lazy<R> {
		return new LazyValue(() => f(this.value));
	}
}

export function lazy<T>(getValue: () => T): Lazy<T> {
	return new LazyValue<T>(getValue);
}