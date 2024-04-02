/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as os from 'os';
import * as lsp from 'vscode-languageserver-protocol';
import * as URI from 'vscode-uri';
import { DiagnosticLevel, DiagnosticOptions } from '../languageFeatures/diagnostics';
import { InMemoryDocument } from '../types/inMemoryDocument';
import { Disposable, disposeAll, IDisposable } from '../util/dispose';

export const joinLines = (...args: string[]) => args.join('\n');

export const workspaceRoot = URI.URI.file(os.platform() === 'win32' ? 'c:\\workspace' : '/workspace');

export function workspacePath(...segments: string[]): URI.URI {
	return URI.Utils.joinPath(workspaceRoot, ...segments);
}

export function assertRangeEqual(expected: lsp.Range, actual: lsp.Range, message?: string) {
	assert.strictEqual(expected.start.line, actual.start.line, `${message || ''}. Range start line not equal`);
	assert.strictEqual(expected.start.character, actual.start.character, `${message || ''}. Range start character not equal`);
	assert.strictEqual(expected.end.line, actual.end.line, `${message || ''}. Range end line not equal`);
	assert.strictEqual(expected.end.character, actual.end.character, `${message || ''}. Range end character not equal`);
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

export function withStore<R>(fn: (this: Mocha.Context, store: DisposableStore) => Promise<R>) {
	return async function (this: Mocha.Context): Promise<R> {
		const store = new DisposableStore();
		try {
			return await fn.call(this, store);
		} finally {
			store.dispose();
		}
	};
}

export const CURSOR = '$$CURSOR$$';

export function getCursorPositions(contents: string, doc: InMemoryDocument): lsp.Position[] {
	const positions: lsp.Position[] = [];
	let index = 0;
	let wordLength = 0;
	while (index !== -1) {
		index = contents.indexOf(CURSOR, index + wordLength);
		if (index !== -1) {
			positions.push(doc.positionAt(index));
		}
		wordLength = CURSOR.length;
	}
	return positions;
}

export const defaultDiagnosticsOptions = Object.freeze<DiagnosticOptions>({
	validateFileLinks: DiagnosticLevel.warning,
	validateMarkdownFileLinkFragments: undefined,
	validateFragmentLinks: DiagnosticLevel.warning,
	validateReferences: DiagnosticLevel.warning,
	validateUnusedLinkDefinitions: DiagnosticLevel.warning,
	validateDuplicateLinkDefinitions: DiagnosticLevel.warning,
	ignoreLinks: [],
});

export function applyActionEdit(doc: InMemoryDocument, action: lsp.CodeAction): string {
	const edits = (action.edit?.documentChanges?.filter(change => {
		return lsp.TextDocumentEdit.is(change) && change.textDocument.uri === doc.uri;
	}) ?? []) as lsp.TextDocumentEdit[];
	return doc.applyEdits(edits.map(edit => edit.edits).flat());
}
