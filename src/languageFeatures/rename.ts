/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as path from 'path';
import { CancellationToken } from 'vscode-languageserver';
import * as lsp from 'vscode-languageserver-types';
import { URI, Utils } from 'vscode-uri';
import { ISlugifier } from '../slugify';
import { arePositionsEqual, translatePosition } from '../types/position';
import { modifyRange, rangeContains } from '../types/range';
import { ITextDocument } from '../types/textDocument';
import { Disposable } from '../util/dispose';
import { IWorkspace, statLinkToMarkdownFile } from '../workspace';
import { InternalHref, resolveDocumentLink } from './documentLinks';
import { MdHeaderReference, MdLinkReference, MdReference, MdReferencesProvider } from './references';


export interface MdReferencesResponse {
	references: MdReference[];
	triggerRef: MdReference;
}

interface MdFileRenameEdit {
	readonly from: URI;
	readonly to: URI;
}

/**
 * Type with additional metadata about the edits for testing
 *
 * This is needed since `lsp.WorkspaceEdit` does not expose info on file renames.
 */
export interface MdWorkspaceEdit {
	readonly edit: lsp.WorkspaceEdit;

	readonly fileRenames?: ReadonlyArray<MdFileRenameEdit>;
}

function tryDecodeUri(str: string): string {
	try {
		return decodeURI(str);
	} catch {
		return str;
	}
}

export class MdRenameProvider extends Disposable {

	private cachedRefs?: {
		readonly resource: URI;
		readonly version: number;
		readonly position: lsp.Position;
		readonly triggerRef: MdReference;
		readonly references: MdReference[];
	} | undefined;

	private readonly renameNotSupportedText = "Rename not supported at location";

	public constructor(
		private readonly workspace: IWorkspace,
		private readonly referencesProvider: MdReferencesProvider,
		private readonly slugifier: ISlugifier,
	) {
		super();
	}

	public async prepareRename(document: ITextDocument, position: lsp.Position, token: CancellationToken): Promise<undefined | { range: lsp.Range; placeholder: string }> {
		const allRefsInfo = await this.getAllReferences(document, position, token);
		if (token.isCancellationRequested) {
			return undefined;
		}

		if (!allRefsInfo || !allRefsInfo.references.length) {
			throw new Error(this.renameNotSupportedText);
		}

		const triggerRef = allRefsInfo.triggerRef;
		switch (triggerRef.kind) {
			case 'header': {
				return { range: triggerRef.headerTextLocation.range, placeholder: triggerRef.headerText };
			}
			case 'link': {
				if (triggerRef.link.kind === 'definition') {
					// We may have been triggered on the ref or the definition itself
					if (rangeContains(triggerRef.link.ref.range, position)) {
						return { range: triggerRef.link.ref.range, placeholder: triggerRef.link.ref.text };
					}
				}

				if (triggerRef.link.href.kind === 'external') {
					return { range: triggerRef.link.source.hrefRange, placeholder: document.getText(triggerRef.link.source.hrefRange) };
				}

				// See if we are renaming the fragment or the path
				const { fragmentRange } = triggerRef.link.source;
				if (fragmentRange && rangeContains(fragmentRange, position)) {
					const declaration = this.findHeaderDeclaration(allRefsInfo.references);
					if (declaration) {
						return { range: fragmentRange, placeholder: declaration.headerText };
					}
					return { range: fragmentRange, placeholder: document.getText(fragmentRange) };
				}

				const range = this.getFilePathRange(triggerRef);
				if (!range) {
					throw new Error(this.renameNotSupportedText);
				}
				return { range, placeholder: tryDecodeUri(document.getText(range)) };
			}
		}
	}

	private getFilePathRange(ref: MdLinkReference): lsp.Range {
		if (ref.link.source.fragmentRange) {
			return modifyRange(ref.link.source.hrefRange, undefined, translatePosition(ref.link.source.fragmentRange.start, { characterDelta: -1 }));
		}
		return ref.link.source.hrefRange;
	}

	private findHeaderDeclaration(references: readonly MdReference[]): MdHeaderReference | undefined {
		return references.find(ref => ref.isDefinition && ref.kind === 'header') as MdHeaderReference | undefined;
	}

	public async provideRenameEdits(document: ITextDocument, position: lsp.Position, newName: string, token: CancellationToken): Promise<lsp.WorkspaceEdit | undefined> {
		return (await this.provideRenameEditsImpl(document, position, newName, token))?.edit;
	}

	public async provideRenameEditsImpl(document: ITextDocument, position: lsp.Position, newName: string, token: CancellationToken): Promise<MdWorkspaceEdit | undefined> {
		const allRefsInfo = await this.getAllReferences(document, position, token);
		if (token.isCancellationRequested || !allRefsInfo || !allRefsInfo.references.length) {
			return undefined;
		}

		const triggerRef = allRefsInfo.triggerRef;

		if (triggerRef.kind === 'link' && (
			(triggerRef.link.kind === 'definition' && rangeContains(triggerRef.link.ref.range, position)) || triggerRef.link.href.kind === 'reference'
		)) {
			return this.renameReferenceLinks(allRefsInfo, newName);
		} else if (triggerRef.kind === 'link' && triggerRef.link.href.kind === 'external') {
			return this.renameExternalLink(allRefsInfo, newName);
		} else if (triggerRef.kind === 'header' || (triggerRef.kind === 'link' && triggerRef.link.source.fragmentRange && rangeContains(triggerRef.link.source.fragmentRange, position) && (triggerRef.link.kind === 'definition' || triggerRef.link.kind === 'link' && triggerRef.link.href.kind === 'internal'))) {
			return this.renameFragment(allRefsInfo, newName);
		} else if (triggerRef.kind === 'link' && !(triggerRef.link.source.fragmentRange && rangeContains(triggerRef.link.source.fragmentRange, position)) && (triggerRef.link.kind === 'link' || triggerRef.link.kind === 'definition') && triggerRef.link.href.kind === 'internal') {
			return this.renameFilePath(triggerRef.link.source.resource, triggerRef.link.href, allRefsInfo, newName);
		}

		return undefined;
	}

	private async renameFilePath(triggerDocument: URI, triggerHref: InternalHref, allRefsInfo: MdReferencesResponse, newName: string): Promise<MdWorkspaceEdit> {
		const builder = new WorkspaceEditBuilder();
		const fileRenames: MdFileRenameEdit[] = [];

		const targetUri = await statLinkToMarkdownFile(this.workspace, triggerHref.path) ?? triggerHref.path;

		const rawNewFilePath = resolveDocumentLink(triggerDocument, newName, this.workspace);
		if (!rawNewFilePath) {
			return { edit: builder.getEdit() };
		}

		let resolvedNewFilePath = rawNewFilePath.path;
		if (!Utils.extname(resolvedNewFilePath)) {
			// If the newly entered path doesn't have a file extension but the original file did
			// tack on a .md file extension
			if (Utils.extname(targetUri)) {
				resolvedNewFilePath = resolvedNewFilePath.with({
					path: resolvedNewFilePath.path + '.md'
				});
			}
		}

		// First rename the file
		if (await this.workspace.stat(targetUri)) {
			fileRenames.push({ from: targetUri, to: resolvedNewFilePath });
			builder.renameFile(targetUri, resolvedNewFilePath);
		}

		// Then update all refs to it
		for (const ref of allRefsInfo.references) {
			if (ref.kind === 'link') {
				// Try to preserve style of existing links
				let newPath: string;
				if (ref.link.source.hrefText.startsWith('/')) {
					const root = resolveDocumentLink(ref.link.source.resource, '/', this.workspace);
					if (!root) {
						continue;
					}
					newPath = '/' + path.relative(root.path.toString(true), rawNewFilePath.path.toString(true));
				} else {
					const rootDir = Utils.dirname(ref.link.source.resource);
					if (rootDir.scheme === rawNewFilePath.path.scheme && rootDir.scheme !== 'untitled') {
						newPath = path.relative(rootDir.toString(true), rawNewFilePath.path.toString(true));
						if (newName.startsWith('./') && !newPath.startsWith('../') || newName.startsWith('.\\') && !newPath.startsWith('..\\')) {
							newPath = './' + newPath;
						}
					} else {
						newPath = newName;
					}
				}
				builder.replace(ref.link.source.resource, this.getFilePathRange(ref), encodeURI(newPath.replace(/\\/g, '/')));
			}
		}

		return { edit: builder.getEdit(), fileRenames };
	}

	private renameFragment(allRefsInfo: MdReferencesResponse, newName: string): MdWorkspaceEdit {
		const slug = this.slugifier.fromHeading(newName).value;

		const builder = new WorkspaceEditBuilder();
		for (const ref of allRefsInfo.references) {
			switch (ref.kind) {
				case 'header':
					builder.replace(URI.parse(ref.location.uri), ref.headerTextLocation.range, newName);
					break;

				case 'link':
					builder.replace(ref.link.source.resource, ref.link.source.fragmentRange ?? ref.location.range, !ref.link.source.fragmentRange || ref.link.href.kind === 'external' ? newName : slug);
					break;
			}
		}
		return { edit: builder.getEdit() };
	}

	private renameExternalLink(allRefsInfo: MdReferencesResponse, newName: string): MdWorkspaceEdit {
		const builder = new WorkspaceEditBuilder();
		for (const ref of allRefsInfo.references) {
			if (ref.kind === 'link') {
				builder.replace(ref.link.source.resource, ref.location.range, newName);
			}
		}
		return { edit: builder.getEdit() };
	}

	private renameReferenceLinks(allRefsInfo: MdReferencesResponse, newName: string): MdWorkspaceEdit {

		const builder = new WorkspaceEditBuilder();

		for (const ref of allRefsInfo.references) {
			if (ref.kind === 'link') {
				if (ref.link.kind === 'definition') {
					builder.replace(ref.link.source.resource, ref.link.ref.range, newName);
				} else {
					builder.replace(ref.link.source.resource, ref.link.source.fragmentRange ?? ref.location.range, newName);
				}
			}
		}

		return { edit: builder.getEdit() };
	}

	private async getAllReferences(document: ITextDocument, position: lsp.Position, token: CancellationToken): Promise<MdReferencesResponse | undefined> {
		const version = document.version;

		if (this.cachedRefs
			&& this.cachedRefs.resource.fsPath === URI.parse(document.uri).fsPath
			&& this.cachedRefs.version === document.version
			&& arePositionsEqual(this.cachedRefs.position, position)
		) {
			return this.cachedRefs;
		}

		const references = await this.referencesProvider.getReferencesAtPosition(document, position, token);
		const triggerRef = references.find(ref => ref.isTriggerLocation);
		if (!triggerRef) {
			return undefined;
		}

		this.cachedRefs = {
			resource: URI.parse(document.uri),
			version,
			position,
			references,
			triggerRef
		};
		return this.cachedRefs;
	}
}

class WorkspaceEditBuilder {

	private edit: lsp.WorkspaceEdit = {
		changes: {},
	};

	replace(resource: URI, range: lsp.Range, newText: string) {
		const resourceKey = resource.toString();
		let edits = this.edit.changes![resourceKey];
		if (!edits) {
			edits = []
			this.edit.changes![resourceKey] = edits;
		}

		edits.push(lsp.TextEdit.replace(range, newText))
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