/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { URI } from 'vscode-uri';

export function isParentDir(parent: URI, maybeChild: URI): boolean {
	if (parent.scheme === maybeChild.scheme && parent.authority === maybeChild.authority) {
		const relative = path.relative(parent.path, maybeChild.path);
		return !relative.startsWith('..');
	}
	return false;
}