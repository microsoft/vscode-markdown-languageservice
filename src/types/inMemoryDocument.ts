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

	replaceContents(newContent: string): this {
		++this.version;
		TextDocument.update(this.#doc, [{ text: newContent }], this.version);
		return this;
	}

	applyEdits(textEdits: readonly lsp.TextEdit[]): this {
		++this.version;
		TextDocument.update(this.#doc, textEdits.map(x => ({ range: x.range, text: x.newText })), this.version);
		return this;
	}

	previewEdits(textEdits: lsp.TextEdit[]): string {
		return TextDocument.applyEdits(this.#doc, textEdits);
	}
}
