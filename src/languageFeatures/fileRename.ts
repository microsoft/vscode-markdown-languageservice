/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import path = require('path');
import { CancellationToken } from 'vscode-languageserver';
import * as lsp from 'vscode-languageserver-types';
import { URI, Utils } from 'vscode-uri';
import { Disposable } from '../util/dispose';
import { WorkspaceEditBuilder } from '../util/editBuilder';
import { Schemes } from '../util/schemes';
import { IWorkspace } from '../workspace';
import { resolveDocumentLink } from './documentLinks';
import { MdReferencesProvider } from './references';


export class MdFileRenameProvider extends Disposable {

	public constructor(
		private readonly workspace: IWorkspace,
		private readonly referencesProvider: MdReferencesProvider,
	) {
		super();
	}

	async getRenameFilesInWorkspaceEdit(edits: Iterable<{ readonly oldUri: URI; readonly newUri: URI }>, token: CancellationToken): Promise<lsp.WorkspaceEdit | undefined> {
		const builder = new WorkspaceEditBuilder();

		for (const edit of edits) {
			if (token.isCancellationRequested) {
				return undefined;
			}

			const refs = await this.referencesProvider.getReferencesToFileInWorkspace(edit.oldUri, token);
			if (token.isCancellationRequested) {
				return undefined;
			}

			for (const ref of refs) {
				if (ref.kind === 'link') {
					let newPath: string | undefined;
					if (ref.link.source.hrefText.startsWith('/')) {
						const root = resolveDocumentLink(ref.link.source.resource, '/', this.workspace);
						if (!root) {
							continue;
						}
						newPath = '/' + path.relative(root.path.toString(true), edit.newUri.toString(true));
					} else {
						const rootDir = Utils.dirname(ref.link.source.resource);
						if (rootDir.scheme === edit.newUri.scheme && rootDir.scheme !== Schemes.untitled) {
							newPath = path.relative(rootDir.toString(true), edit.newUri.toString(true));

							if (ref.link.source.hrefText.startsWith('./') && !newPath.startsWith('../') || ref.link.source.hrefText.startsWith('.\\') && !newPath.startsWith('..\\')) {
								newPath = './' + newPath;
							}
						} else {
							newPath = edit.newUri.toString(true);
						}
					}

					if (typeof newPath === 'string') {
						builder.replace(URI.parse(ref.location.uri), ref.link.source.hrefRange, encodeURI(newPath.replace(/\\/g, '/')));
					}
				}
			}
		}

		return builder.getEdit();
	}
}

