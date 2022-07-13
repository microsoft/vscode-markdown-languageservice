/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as MarkdownIt from 'markdown-it';
import { IMdParser } from '../parser';
import { githubSlugifier } from '../slugify';

export function createNewMarkdownEngine(): IMdParser {
	const md = MarkdownIt({ html: true, });
	return {
		slugifier: githubSlugifier,
		async tokenize(document) {
			return md.parse(document.getText(), {});
		},
	};
}
