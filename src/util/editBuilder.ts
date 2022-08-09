/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as lsp from 'vscode-languageserver-types';
import { URI } from 'vscode-uri';

export class WorkspaceEditBuilder {

	private edit: lsp.WorkspaceEdit = {
		changes: {},
	};

	replace(resource: URI, range: lsp.Range, newText: string) {
		const resourceKey = resource.toString();
		let edits = this.edit.changes![resourceKey];
		if (!edits) {
			edits = [];
			this.edit.changes![resourceKey] = edits;
		}

		edits.push(lsp.TextEdit.replace(range, newText));
	}

	getEdit(): lsp.WorkspaceEdit {
		return this.edit;
	}

	renameFile(targetUri: URI, resolvedNewFilePath: URI) {
		if (!this.edit.documentChanges) {
			this.edit.documentChanges = [];
		}
		this.edit.documentChanges.push(lsp.RenameFile.create(targetUri.toString(), resolvedNewFilePath.toString()));
	}
}