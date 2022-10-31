/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

interface ILimitedTaskFactory<T> {
	factory: ITask<Promise<T>>;
	c: (value: T | Promise<T>) => void;
	e: (error?: unknown) => void;
}

interface ITask<T> {
	(): T;
}

/**
 * A helper to queue N promises and run them all with a max degree of parallelism. The helper
 * ensures that at any time no more than M promises are running at the same time.
 *
 * Taken from 'src/vs/base/common/async.ts'
 */
export class Limiter<T> {

	private _size = 0;
	private _runningPromises: number;
	private readonly _maxDegreeOfParalellism: number;
	private readonly _outstandingPromises: ILimitedTaskFactory<T>[];

	constructor(maxDegreeOfParalellism: number) {
		this._maxDegreeOfParalellism = maxDegreeOfParalellism;
		this._outstandingPromises = [];
		this._runningPromises = 0;
	}

	get size(): number {
		return this._size;
	}

	queue(factory: ITask<Promise<T>>): Promise<T> {
		this._size++;

		return new Promise<T>((c, e) => {
			this._outstandingPromises.push({ factory, c, e });
			this._consume();
		});
	}

	private _consume(): void {
		while (this._outstandingPromises.length && this._runningPromises < this._maxDegreeOfParalellism) {
			const iLimitedTask = this._outstandingPromises.shift()!;
			this._runningPromises++;

			const promise = iLimitedTask.factory();
			promise.then(iLimitedTask.c, iLimitedTask.e);
			promise.then(() => this._consumed(), () => this._consumed());
		}
	}

	private _consumed(): void {
		this._size--;
		this._runningPromises--;

		if (this._outstandingPromises.length > 0) {
			this._consume();
		}
	}
}
