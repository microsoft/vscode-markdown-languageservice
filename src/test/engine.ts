/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as MarkdownIt from 'markdown-it';
import { IMdParser } from '../parser';
import { githubSlugifier } from '../slugify';

export function createNewMarkdownEngine(): IMdParser {
	const md = MarkdownIt({ html: true, });

	// Allow file links
	const validateLink = md.validateLink.bind(md);
	md.validateLink = (link: string) => {
		return validateLink(link) || link.startsWith('file://');
	};

	return {
		slugifier: githubSlugifier,
		async tokenize(document) {
			return md.parse(document.getText(), {});
		},
	};
}
