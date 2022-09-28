/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as lsp from 'vscode-languageserver-types';
import * as nls from 'vscode-nls';
import { URI } from 'vscode-uri';
import { makeRange, rangeIntersects } from '../../types/range';
import { ITextDocument } from '../../types/textDocument';
import { WorkspaceEditBuilder } from '../../util/editBuilder';
import { DiagnosticCode } from '../diagnostics';
import { MdLinkDefinition } from '../documentLinks';
import { codeActionKindContains } from './util';

const localize = nls.loadMessageBundle();

export class MdRemoveLinkDefinitionCodeActionProvider {

	private static readonly removeUnusedDefTitle = localize('removeUnusedTitle', 'Remove unused link definition');
	private static readonly removeDuplicateDefTitle = localize('removeDuplicateTitle', 'Remove duplicate link definition');

	*getActions(doc: ITextDocument, range: lsp.Range, context: lsp.CodeActionContext): Iterable<lsp.CodeAction> {
		if (!this.isEnabled(context)) {
			return;
		}

		for (const diag of context.diagnostics) {
			if (diag.data && rangeIntersects(diag.range, range)) {
				if (diag.code === DiagnosticCode.link_unusedDefinition) {
					yield this.getRemoveDefinitionAction(doc, diag.data as MdLinkDefinition, MdRemoveLinkDefinitionCodeActionProvider.removeUnusedDefTitle);
				} else if (diag.code === DiagnosticCode.link_duplicateDefinition) {
					yield this.getRemoveDefinitionAction(doc, diag.data as MdLinkDefinition, MdRemoveLinkDefinitionCodeActionProvider.removeDuplicateDefTitle);
				}
			}
		}
	}

	private isEnabled(context: lsp.CodeActionContext): boolean {
		if (typeof context.only === 'undefined') {
			return true;
		}

		return context.only.some(kind => codeActionKindContains(lsp.CodeActionKind.QuickFix, kind));
	}

	private getRemoveDefinitionAction(doc: ITextDocument, definition: MdLinkDefinition, title: string): lsp.CodeAction {
		const builder = new WorkspaceEditBuilder();

		const range = definition.source.range;
		builder.replace(URI.parse(doc.uri), makeRange(range.start.line, 0, range.start.line, Number.MAX_VALUE), '');

		return { title, kind: lsp.CodeActionKind.QuickFix, edit: builder.getEdit() };
	}
}
