/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TextDocument } from 'vscode-languageserver-textdocument';
import * as lsp from 'vscode-languageserver-types';
import { URI } from 'vscode-uri';
import { ITextDocument } from '../types/textDocument';

export class InMemoryDocument implements ITextDocument {

	private _doc: TextDocument;

	public readonly $uri: URI;
	public readonly uri: string;

	constructor(
		uri: URI,
		contents: string,
		public version = 0,
	) {
		this.$uri = uri;
		this.uri = uri.toString();

		this._doc = TextDocument.create(this.uri, 'markdown', version, contents);
	}

	get lineCount(): number {
		return this._doc.lineCount;
	}

	positionAt(offset: number): lsp.Position {
		return this._doc.positionAt(offset);
	}

	getText(range?: lsp.Range): string {
		return this._doc.getText(range);
	}

	updateContent(newContent: string) {
		++this.version;
		this._doc = TextDocument.create(this.uri, 'markdown', this.version, newContent);
	}

	applyEdits(textEdits: lsp.TextEdit[]): string {
		return TextDocument.applyEdits(this._doc, textEdits);
	}
}
