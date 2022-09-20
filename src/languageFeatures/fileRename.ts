/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { CancellationToken } from 'vscode-languageserver';
import * as lsp from 'vscode-languageserver-types';
import { URI, Utils } from 'vscode-uri';
import { isExcludedPath, LsConfiguration } from '../config';
import { Disposable } from '../util/dispose';
import { WorkspaceEditBuilder } from '../util/editBuilder';
import { looksLikeMarkdownPath } from '../util/file';
import { isParentDir } from '../util/path';
import { IWorkspace } from '../workspace';
import { MdWorkspaceInfoCache } from '../workspaceCache';
import { HrefKind, MdLink, resolveInternalDocumentLink } from './documentLinks';
import { MdReferenceKind, MdReferencesProvider } from './references';
import { getFilePathRange, getLinkRenameText } from './rename';
import path = require('path');


interface FileRename {
	readonly oldUri: URI;
	readonly newUri: URI;
}

export interface FileRenameResponse {
	participatingOldUris: URI[];
	edit: lsp.WorkspaceEdit;
}

export class MdFileRenameProvider extends Disposable {

	public constructor(
		private readonly config: LsConfiguration,
		private readonly workspace: IWorkspace,
		private readonly linkCache: MdWorkspaceInfoCache<readonly MdLink[]>,
		private readonly referencesProvider: MdReferencesProvider,
	) {
		super();
	}

	async getRenameFilesInWorkspaceEdit(edits: readonly FileRename[], token: CancellationToken): Promise<FileRenameResponse | undefined> {
		const builder = new WorkspaceEditBuilder();
		const participatingOldUris: URI[] = [];

		for (const edit of edits) {
			const stat = await this.workspace.stat(edit.newUri);
			if (token.isCancellationRequested) {
				return undefined;
			}

			if (await (stat?.isDirectory ? this.addDirectoryRenameEdits(edit, builder, token) : this.addSingleFileRenameEdits(edit, builder, token))) {
				participatingOldUris.push(edit.oldUri);
			}

			if (token.isCancellationRequested) {
				return undefined;
			}
		}

		return { participatingOldUris, edit: builder.getEdit() };
	}

	private async addSingleFileRenameEdits(edit: FileRename, builder: WorkspaceEditBuilder, token: CancellationToken): Promise<boolean> {
		let didParticipate = false;

		// Update all references to the file
		if (await this.addEditsForReferencesToFile(edit, builder, token)) {
			didParticipate = true;
		}

		if (token.isCancellationRequested) {
			return false;
		}

		// If the file moved was markdown, we also need to update links in the file itself
		if (await this.tryAddEditsInSelf(edit, builder)) {
			didParticipate = true;
		}

		return didParticipate;
	}

	private async addDirectoryRenameEdits(edit: FileRename, builder: WorkspaceEditBuilder, token: CancellationToken): Promise<boolean> {
		// First update every link that points to something in the moved dir
		const allLinksInWorkspace = await this.linkCache.entries();
		if (token.isCancellationRequested) {
			return false;
		}

		let didParticipate = false;
		for (const [docUri, links] of allLinksInWorkspace) {
			for (const link of links) {
				if (link.href.kind !== HrefKind.Internal) {
					continue;
				}

				// Update links to the moved dir
				if (isParentDir(edit.oldUri, link.href.path)) {
					const relative = path.relative(edit.oldUri.path, link.href.path.path);
					const newUri = edit.newUri.with({
						path: path.join(edit.newUri.path, relative)
					});
					if (await this.addLinkRenameEdit(docUri, link, newUri, builder)) {
						didParticipate = true;
					}
				}

				// If the link was within a file in the moved dir but traversed out of it, we also need to update the path
				if (link.source.pathText.startsWith('..') && isParentDir(edit.newUri, docUri)) {
					// Resolve the link relative to the old file path
					const oldDocUri = docUri.with({
						path: Utils.joinPath(edit.oldUri, path.relative(edit.newUri.path, docUri.path)).path
					});

					const oldLink = resolveInternalDocumentLink(oldDocUri, link.source.hrefText, this.workspace);
					if (oldLink && !isParentDir(edit.oldUri, oldLink.resource)) {
						const rootDir = Utils.dirname(docUri);
						const newPath = path.relative(rootDir.path, oldLink.resource.path);

						didParticipate = true;
						builder.replace(docUri, getFilePathRange(link), encodeURI(newPath.replace(/\\/g, '/')));
					}
				}
			}
		}

		return didParticipate;
	}

	/**
	 * Try to add edits for when a markdown file has been renamed.
	 * In this case we also need to update links within the file.
	 */
	private async tryAddEditsInSelf(edit: FileRename, builder: WorkspaceEditBuilder): Promise<boolean> {
		if (!looksLikeMarkdownPath(this.config, edit.newUri)) {
			return false;
		}

		if (isExcludedPath(this.config, edit.newUri)) {
			return false;
		}

		const doc = await this.workspace.openMarkdownDocument(edit.newUri);
		if (!doc) {
			return false;
		}

		const links = (await this.linkCache.getForDocs([doc]))[0];

		let didParticipate = false;
		for (const link of links) {
			if (this.addEditsForLinksInSelf(link, edit, builder)) {
				didParticipate = true;
			}
		}
		return didParticipate;
	}

	private addEditsForLinksInSelf(link: MdLink, edit: FileRename, builder: WorkspaceEditBuilder): boolean {
		if (link.href.kind !== HrefKind.Internal) {
			return false;
		}

		if (link.source.hrefText.startsWith('/')) {
			// We likely don't need to update anything since an absolute path is used
			return false;
		} else {
			// Resolve the link relative to the old file path
			const oldLink = resolveInternalDocumentLink(edit.oldUri, link.source.hrefText, this.workspace);
			if (oldLink) {
				const rootDir = Utils.dirname(edit.newUri);
				const newPath = path.relative(rootDir.toString(true), oldLink.resource.toString(true));
				builder.replace(edit.newUri, getFilePathRange(link), encodeURI(newPath.replace(/\\/g, '/')));
				return true;
			}
		}
		return false;
	}

	/**
	 * Update links across the workspace for the new file name
	 */
	private async addEditsForReferencesToFile(edit: FileRename, builder: WorkspaceEditBuilder, token: CancellationToken): Promise<boolean> {
		if (isExcludedPath(this.config, edit.newUri)) {
			return false;
		}

		const refs = await this.referencesProvider.getReferencesToFileInWorkspace(edit.oldUri, token);
		if (token.isCancellationRequested) {
			return false;
		}

		let didParticipate = false;
		for (const ref of refs) {
			if (ref.kind === MdReferenceKind.Link) {
				if (await this.addLinkRenameEdit(URI.parse(ref.location.uri), ref.link, edit.newUri, builder)) {
					didParticipate = true;
				}
			}
		}
		return didParticipate;
	}

	private async addLinkRenameEdit(doc: URI, link: MdLink, newUri: URI, builder: WorkspaceEditBuilder): Promise<boolean> {
		if (link.href.kind !== HrefKind.Internal) {
			return false;
		}

		let newFilePath = newUri;

		// If the original markdown link did not use a file extension, remove ours too
		if (!Utils.extname(link.href.path)) {
			const editExt = Utils.extname(newUri);
			if (this.config.markdownFileExtensions.includes(editExt.replace('.', ''))) {
				newFilePath = newUri.with({
					path: newUri.path.slice(0, newUri.path.length - editExt.length)
				});
			}
		}

		const newLinkText = getLinkRenameText(this.workspace, link.source, newFilePath, link.source.pathText.startsWith('.'));
		if (typeof newLinkText === 'string') {
			builder.replace(doc, getFilePathRange(link), encodeURI(newLinkText.replace(/\\/g, '/')));
			return true;
		}
		return false;
	}
}
