/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as path from 'path';
import { CancellationToken } from 'vscode-languageserver';
import * as lsp from 'vscode-languageserver-types';
import { URI, Utils } from 'vscode-uri';
import { isExcludedPath, LsConfiguration } from '../config';
import { ITextDocument } from '../types/textDocument';
import { Disposable } from '../util/dispose';
import { WorkspaceEditBuilder } from '../util/editBuilder';
import { looksLikeMarkdownPath } from '../util/file';
import { isParentDir } from '../util/path';
import { IWorkspace } from '../workspace';
import { MdWorkspaceInfoCache } from '../workspaceCache';
import { HrefKind, MdLink, resolveInternalDocumentLink } from './documentLinks';
import { MdReferenceKind, MdReferencesProvider } from './references';
import { getFilePathRange, getLinkRenameText } from './rename';


export interface FileRename {
	readonly oldUri: URI;
	readonly newUri: URI;
}

export interface FileRenameResponse {
	participatingRenames: readonly FileRename[];
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
		const participatingRenames: FileRename[] = [];

		for (const edit of edits) {
			const stat = await this.workspace.stat(edit.newUri);
			if (token.isCancellationRequested) {
				return undefined;
			}

			if (await (stat?.isDirectory ? this.addDirectoryRenameEdits(edit, builder, token) : this.addSingleFileRenameEdits(edit, edits, builder, token))) {
				participatingRenames.push(edit);
			}

			if (token.isCancellationRequested) {
				return undefined;
			}
		}

		return { participatingRenames, edit: builder.getEdit() };
	}

	private async addSingleFileRenameEdits(edit: FileRename, allEdits: readonly FileRename[], builder: WorkspaceEditBuilder, token: CancellationToken): Promise<boolean> {
		let didParticipate = false;

		// Update all references to the file
		if (await this.addEditsForReferencesToFile(edit, builder, token)) {
			didParticipate = true;
		}

		if (token.isCancellationRequested) {
			return false;
		}

		// If the file moved was markdown, we also need to update links in the file itself
		if (await this.tryAddEditsInSelf(edit, allEdits, builder)) {
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
					const newDocUri = Utils.joinPath(edit.newUri, path.posix.relative(edit.oldUri.path, docUri.path));
					if (await this.addLinkRenameEdit(newDocUri, link, newUri, builder)) {
						didParticipate = true;
					}
				}

				// If the link was within a file in the moved dir but traversed out of it, we also need to update the path
				if (link.source.pathText.startsWith('..') && isParentDir(edit.newUri, docUri)) {
					// Resolve the link relative to the old file path
					const oldDocUri = docUri.with({
						path: Utils.joinPath(edit.oldUri, path.posix.relative(edit.newUri.path, docUri.path)).path
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
	private async tryAddEditsInSelf(edit: FileRename, allEdits: readonly FileRename[], builder: WorkspaceEditBuilder): Promise<boolean> {
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
			if (await this.addEditsForLinksInSelf(doc, link, edit, allEdits, builder)) {
				didParticipate = true;
			}
		}
		return didParticipate;
	}

	private async addEditsForLinksInSelf(doc: ITextDocument, link: MdLink, edit: FileRename, allEdits: readonly FileRename[], builder: WorkspaceEditBuilder): Promise<boolean> {
		if (link.href.kind !== HrefKind.Internal) {
			return false;
		}

		if (link.source.hrefText.startsWith('/')) {
			// We likely don't need to update anything since an absolute path is used
			return false;
		}

		// Resolve the link relative to the old file path
		let oldLink = resolveInternalDocumentLink(edit.oldUri, link.source.hrefText, this.workspace);
		if (!oldLink) {
			return false;
		}

		// See if the old link was effected by one of the renames
		for (const edit of allEdits) {
			if (edit.oldUri.toString() === oldLink.resource.toString() || isParentDir(edit.oldUri, oldLink.resource)) {
				oldLink = { resource: Utils.joinPath(edit.newUri, path.posix.relative(edit.oldUri.path, oldLink.resource.path)), linkFragment: oldLink.linkFragment };
				break;
			}
		}

		return this.addLinkRenameEdit(URI.parse(doc.uri), link, oldLink.resource, builder);
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
