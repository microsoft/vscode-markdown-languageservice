/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI, Utils } from 'vscode-uri';
import { LsConfiguration } from '../config';

export function looksLikeMarkdownPath(config: LsConfiguration, resolvedHrefPath: URI) {
	return config.markdownFileExtensions.includes(Utils.extname(URI.from(resolvedHrefPath)).toLowerCase().replace('.', ''));
}
