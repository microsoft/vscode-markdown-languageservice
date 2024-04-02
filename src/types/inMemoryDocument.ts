/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as lsp from 'vscode-languageserver-protocol';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import { ITextDocument } from './textDocument';

export class InMemoryDocument implements ITextDocument {

	#doc: TextDocument;

	public readonly $uri: URI;
	public readonly uri: string;

	constructor(
		uri: URI,
		contents: string,
		public version = 0,
	) {
		this.$uri = uri;
		this.uri = uri.toString();

		this.#doc = TextDocument.create(this.uri, 'markdown', version, contents);
	}

	get lineCount(): number {
		return this.#doc.lineCount;
	}

	positionAt(offset: number): lsp.Position {
		return this.#doc.positionAt(offset);
	}

	offsetAt(position: lsp.Position): number {
		return this.#doc.offsetAt(position);
	}

	getText(range?: lsp.Range): string {
		return this.#doc.getText(range);
	}

	updateContent(newContent: string) {
		++this.version;
		this.#doc = TextDocument.create(this.uri, 'markdown', this.version, newContent);
	}

	applyEdits(textEdits: lsp.TextEdit[]): string {
		return TextDocument.applyEdits(this.#doc, textEdits);
	}
}
