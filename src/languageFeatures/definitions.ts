/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { ITextDocument } from '../types/textDocument';
import { MdReferencesProvider } from './references';
import * as lsp from 'vscode-languageserver-types';
import { CancellationToken } from 'vscode-languageserver';

export class MdDefinitionProvider {

	constructor(
		private readonly referencesProvider: MdReferencesProvider,
	) { }

	async provideDefinition(document: ITextDocument, position: lsp.Position, token: CancellationToken): Promise<lsp.Definition | undefined> {
		const allRefs = await this.referencesProvider.getReferencesAtPosition(document, position, token);
		return allRefs.find(ref => ref.kind === 'link' && ref.isDefinition)?.location;
	}
}

