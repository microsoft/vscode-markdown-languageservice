/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as lsp from 'vscode-languageserver-types';
import { URI } from 'vscode-uri';

export class WorkspaceEditBuilder {

	private readonly changes: { [uri: lsp.DocumentUri]: lsp.TextEdit[]; } = {};
	private readonly documentChanges: Array<lsp.CreateFile | lsp.RenameFile | lsp.DeleteFile> = [];

	replace(resource: URI, range: lsp.Range, newText: string): void {
		this.addEdit(resource, lsp.TextEdit.replace(range, newText));
	}

	insert(resource: URI, position: lsp.Position, newText: string): void {
		this.addEdit(resource, lsp.TextEdit.insert(position, newText));
	}

	private addEdit(resource: URI, edit: lsp.TextEdit): void {
		const resourceKey = resource.toString();
		let edits = this.changes![resourceKey];
		if (!edits) {
			edits = [];
			this.changes![resourceKey] = edits;
		}

		edits.push(edit);
	}

	getEdit(): lsp.WorkspaceEdit {
		// We need to convert changes into `documentChanges` or else they get dropped
		const textualChanges = Object.entries(this.changes).map(([uri, edits]): lsp.TextDocumentEdit => {
			return lsp.TextDocumentEdit.create({ uri, version: null }, edits);
		});

		return {
			documentChanges: [...textualChanges, ...this.documentChanges],
		};
	}

	renameFile(targetUri: URI, resolvedNewFilePath: URI) {
		this.documentChanges.push(lsp.RenameFile.create(targetUri.toString(), resolvedNewFilePath.toString()));
	}
}