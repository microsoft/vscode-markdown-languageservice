/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IDisposable {
	dispose(): void;
}

export class MultiDisposeError extends Error {
	constructor(
		public readonly errors: any[]
	) {
		super(`Encountered errors while disposing of store. Errors: [${errors.join(', ')}]`);
	}
}

export function disposeAll(disposables: Iterable<IDisposable>) {
	const errors: any[] = [];

	for (const disposable of disposables) {
		try {
			disposable.dispose();
		} catch (e) {
			errors.push(e);
		}
	}

	if (errors.length === 1) {
		throw errors[0];
	} else if (errors.length > 1) {
		throw new MultiDisposeError(errors);
	}
}

export interface IDisposable {
	dispose(): void;
}

export abstract class Disposable {
	#isDisposed = false;

	protected _disposables: IDisposable[] = [];

	public dispose(): any {
		if (this.#isDisposed) {
			return;
		}
		this.#isDisposed = true;
		disposeAll(this._disposables);
	}

	protected _register<T extends IDisposable>(value: T): T {
		if (this.#isDisposed) {
			value.dispose();
		} else {
			this._disposables.push(value);
		}
		return value;
	}

	protected get isDisposed() {
		return this.#isDisposed;
	}
}

export class DisposableStore extends Disposable {
	readonly #items = new Set<IDisposable>();

	public override dispose() {
		super.dispose();
		disposeAll(this.#items);
		this.#items.clear();
	}

	public add<T extends IDisposable>(item: T): T {
		if (this.isDisposed) {
			console.warn('Adding to disposed store. Item will be leaked');
		}

		this.#items.add(item);
		return item;
	}
}
