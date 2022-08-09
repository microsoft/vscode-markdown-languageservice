/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import path = require('path');
import { CancellationToken } from 'vscode-languageserver';
import * as lsp from 'vscode-languageserver-types';
import { URI, Utils } from 'vscode-uri';
import { LsConfiguration } from '../config';
import { Disposable } from '../util/dispose';
import { WorkspaceEditBuilder } from '../util/editBuilder';
import { looksLikeMarkdownPath } from '../util/file';
import { IWorkspace } from '../workspace';
import { MdWorkspaceInfoCache } from '../workspaceCache';
import { MdLink, resolveDocumentLink } from './documentLinks';
import { MdReferencesProvider } from './references';
import { getFilePathRange, getLinkRenameText } from './rename';


export class MdFileRenameProvider extends Disposable {

	public constructor(
		private readonly config: LsConfiguration,
		private readonly workspace: IWorkspace,
		private readonly linkCache: MdWorkspaceInfoCache<readonly MdLink[]>,
		private readonly referencesProvider: MdReferencesProvider,
	) {
		super();
	}

	async getRenameFilesInWorkspaceEdit(edits: Iterable<{ readonly oldUri: URI; readonly newUri: URI }>, token: CancellationToken): Promise<lsp.WorkspaceEdit | undefined> {
		const builder = new WorkspaceEditBuilder();

		for (const edit of edits) {
			// Update all references to the file
			await this.addEditsForReferencesToFile(edit, builder, token);
			if (token.isCancellationRequested) {
				return undefined;
			}

			// If the file moved was markdown, we also need to update links in the file itself
			await this.tryAddEditsInSelf(edit, builder);
			if (token.isCancellationRequested) {
				return undefined;
			}
		}

		return builder.getEdit();
	}

	/**
	 * Try to add edits for when a markdown file has been renamed.
	 * In this case we also need to update links within the file.
	 */
	private async tryAddEditsInSelf(edit: { readonly oldUri: URI; readonly newUri: URI; }, builder: WorkspaceEditBuilder) {
		if (!looksLikeMarkdownPath(this.config, edit.newUri)) {
			return;
		}

		const doc = await this.workspace.openMarkdownDocument(edit.newUri);
		if (!doc) {
			return;
		}

		const links = (await this.linkCache.getForDocs([doc]))[0];
		for (const link of links) {
			if (link.href.kind === 'internal') {
				if (link.source.hrefText.startsWith('/')) {
					// We likely don't need to update anything since an absolute path is used
				} else {
					const rootDir = Utils.dirname(edit.newUri);
					// Resolve the link relative to the old file path
					const oldLink = resolveDocumentLink(edit.oldUri, link.source.hrefText, this.workspace);
					if (oldLink) {
						const newPath = path.relative(rootDir.toString(true), oldLink.path.toString(true));
						builder.replace(edit.newUri, getFilePathRange(link), encodeURI(newPath.replace(/\\/g, '/')));
					}
				}
			}
		}
	}

	/**
	 * Update links across the workspace for the new file name
	 */
	private async addEditsForReferencesToFile(edit: { readonly oldUri: URI; readonly newUri: URI; }, builder: WorkspaceEditBuilder, token: CancellationToken): Promise<void> {
		const refs = await this.referencesProvider.getReferencesToFileInWorkspace(edit.oldUri, token);
		if (token.isCancellationRequested) {
			return undefined;
		}

		// TODO: this is very similar to the code in 'rename.ts'
		for (const ref of refs) {
			if (ref.kind !== 'link' || ref.link.href.kind !== 'internal') {
				continue;
			}

			let newFilePath = edit.newUri;

			// If the original markdown link did not use a file extension, remove ours too
			if (!Utils.extname(ref.link.href.path)) {
				const editExt = Utils.extname(edit.newUri);
				if (this.config.markdownFileExtensions.includes(editExt.replace('.', ''))) {
					newFilePath = edit.newUri.with({
						path: edit.newUri.path.slice(0, edit.newUri.path.length - editExt.length)
					});
				}
			}

			const newLinkText = getLinkRenameText(this.workspace, ref.link.source, newFilePath, ref.link.source.pathText.startsWith('.'));
			if (typeof newLinkText === 'string') {
				builder.replace(URI.parse(ref.location.uri), getFilePathRange(ref.link), encodeURI(newLinkText.replace(/\\/g, '/')));
			}
		}
	}
}
