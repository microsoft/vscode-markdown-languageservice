/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI, Utils } from 'vscode-uri';

export function extname(uri: URI): string {
	return Utils.extname(uri);
}

export function dirname(uri: URI): URI {
	return Utils.dirname(uri);
}

export function joinPath(uri: URI, ...segments: string[]): URI {
	return Utils.joinPath(uri, ...segments);
}
