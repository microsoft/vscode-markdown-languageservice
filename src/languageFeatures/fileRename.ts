/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as path from 'path';
import { CancellationToken } from 'vscode-languageserver';
import * as lsp from 'vscode-languageserver-types';
import { URI, Utils } from 'vscode-uri';
import { isExcludedPath, LsConfiguration } from '../config';
import { getDocUri, ITextDocument } from '../types/textDocument';
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
		private readonly _config: LsConfiguration,
		private readonly _workspace: IWorkspace,
		private readonly _linkCache: MdWorkspaceInfoCache<readonly MdLink[]>,
		private readonly _referencesProvider: MdReferencesProvider,
	) {
		super();
	}

	async getRenameFilesInWorkspaceEdit(edits: readonly FileRename[], token: CancellationToken): Promise<FileRenameResponse | undefined> {
		const builder = new WorkspaceEditBuilder();
		const participatingRenames: FileRename[] = [];

		for (const edit of edits) {
			const stat = await this._workspace.stat(edit.newUri);
			if (token.isCancellationRequested) {
				return undefined;
			}

			if (await (stat?.isDirectory ? this._addDirectoryRenameEdits(edit, builder, token) : this._addSingleFileRenameEdits(edit, edits, builder, token))) {
				participatingRenames.push(edit);
			}

			if (token.isCancellationRequested) {
				return undefined;
			}
		}

		return { participatingRenames, edit: builder.renameFragment() };
	}

	private async _addSingleFileRenameEdits(edit: FileRename, allEdits: readonly FileRename[], builder: WorkspaceEditBuilder, token: CancellationToken): Promise<boolean> {
		let didParticipate = false;

		// Update all references to the file
		if (await this._addEditsForReferencesToFile(edit, builder, token)) {
			didParticipate = true;
		}

		if (token.isCancellationRequested) {
			return false;
		}

		// If the file moved was markdown, we also need to update links in the file itself
		if (await this._tryAddEditsInSelf(edit, allEdits, builder)) {
			didParticipate = true;
		}

		return didParticipate;
	}

	private async _addDirectoryRenameEdits(edit: FileRename, builder: WorkspaceEditBuilder, token: CancellationToken): Promise<boolean> {
		// First update every link that points to something in the moved dir
		const allLinksInWorkspace = await this._linkCache.entries();
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
					const relative = path.posix.relative(edit.oldUri.path, link.href.path.path);
					const newUri = edit.newUri.with({
						path: path.posix.join(edit.newUri.path, relative)
					});

					if (this._addLinkRenameEdit(docUri, link, newUri, builder)) {
						didParticipate = true;
						continue;
					}
				}

				// If the link was within a file in the moved dir but traversed out of it, we also need to update the path
				if (link.source.pathText.startsWith('..') && isParentDir(edit.newUri, docUri)) {
					// Resolve the link relative to the old file path
					const oldDocUri = docUri.with({
						path: Utils.joinPath(edit.oldUri, path.posix.relative(edit.newUri.path, docUri.path)).path
					});

					const oldLink = resolveInternalDocumentLink(oldDocUri, link.source.hrefText, this._workspace);
					if (oldLink) {
						let newPathText: string;
						if (isParentDir(edit.oldUri, oldLink.resource)) {
							// The link still points within the directory being moved.
							// This means we just need to normalize the path it in case it was referencing any old names.
							const rootDir = Utils.dirname(oldDocUri);
							newPathText = './' + path.posix.relative(rootDir.path, oldLink.resource.path);
						} else {
							const rootDir = Utils.dirname(docUri);
							newPathText = path.posix.relative(rootDir.path, oldLink.resource.path);
						}

						didParticipate = true;
						builder.replace(docUri, getFilePathRange(link), encodeURI(newPathText));
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
	private async _tryAddEditsInSelf(edit: FileRename, allEdits: readonly FileRename[], builder: WorkspaceEditBuilder): Promise<boolean> {
		if (!looksLikeMarkdownPath(this._config, edit.newUri)) {
			return false;
		}

		if (isExcludedPath(this._config, edit.newUri)) {
			return false;
		}

		const doc = await this._workspace.openMarkdownDocument(edit.newUri);
		if (!doc) {
			return false;
		}

		const links = (await this._linkCache.getForDocs([doc]))[0];

		let didParticipate = false;
		for (const link of links) {
			if (await this._addEditsForLinksInSelf(doc, link, edit, allEdits, builder)) {
				didParticipate = true;
			}
		}
		return didParticipate;
	}

	private async _addEditsForLinksInSelf(doc: ITextDocument, link: MdLink, edit: FileRename, allEdits: readonly FileRename[], builder: WorkspaceEditBuilder): Promise<boolean> {
		if (link.href.kind !== HrefKind.Internal) {
			return false;
		}
		
		if (link.source.hrefText.startsWith('#')) {
			// No rewrite needed as we are referencing the current doc implicitly
			return false;
		}

		if (link.source.hrefText.startsWith('/')) {
			// We likely don't need to update anything since an absolute path is used
			return false;
		}

		// Resolve the link relative to the old file path
		let oldLink = resolveInternalDocumentLink(edit.oldUri, link.source.hrefText, this._workspace);
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

		return this._addLinkRenameEdit(getDocUri(doc), link, oldLink.resource, builder);
	}

	/**
	 * Update links across the workspace for the new file name
	 */
	private async _addEditsForReferencesToFile(edit: FileRename, builder: WorkspaceEditBuilder, token: CancellationToken): Promise<boolean> {
		if (isExcludedPath(this._config, edit.newUri)) {
			return false;
		}

		const refs = await this._referencesProvider.getReferencesToFileInWorkspace(edit.oldUri, token);
		if (token.isCancellationRequested) {
			return false;
		}

		let didParticipate = false;
		for (const ref of refs) {
			if (ref.kind === MdReferenceKind.Link) {
				if (this._addLinkRenameEdit(URI.parse(ref.location.uri), ref.link, edit.newUri, builder)) {
					didParticipate = true;
				}
			}
		}
		return didParticipate;
	}

	private _addLinkRenameEdit(doc: URI, link: MdLink, newUri: URI, builder: WorkspaceEditBuilder): boolean {
		if (link.href.kind !== HrefKind.Internal) {
			return false;
		}

		let newFilePath = newUri;

		// If the original markdown link did not use a file extension, remove ours too
		if (!Utils.extname(link.href.path)) {
			const editExt = Utils.extname(newUri);
			if (this._config.markdownFileExtensions.includes(editExt.replace('.', ''))) {
				newFilePath = newUri.with({
					path: newUri.path.slice(0, newUri.path.length - editExt.length)
				});
			}
		}

		const newLinkText = getLinkRenameText(this._workspace, link.source, newFilePath, link.source.pathText.startsWith('.'));
		if (typeof newLinkText === 'string') {
			builder.replace(doc, getFilePathRange(link), encodeURI(newLinkText));
			return true;
		}
		return false;
	}
}
