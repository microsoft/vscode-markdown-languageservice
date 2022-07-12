/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, Emitter } from 'vscode-languageserver';

export const noopToken = new class implements CancellationToken {
	_onCancellationRequestedEmitter = new Emitter<void>();
	onCancellationRequested = this._onCancellationRequestedEmitter.event;

	get isCancellationRequested() { return false; }
};
