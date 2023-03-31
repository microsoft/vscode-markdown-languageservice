/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export class Slug {
	public constructor(
		public readonly value: string
	) { }

	public equals(other: Slug): boolean {
		return this.value === other.value;
	}
}

/**
 * Generates unique ids for headers in the Markdown.
 */
export interface ISlugifier {
	fromHeading(heading: string): Slug;
}

/**
 * A {@link ISlugifier slugifier} that approximates how GitHub's slugifier works.
 */
export const githubSlugifier: ISlugifier = new class implements ISlugifier {
	fromHeading(heading: string): Slug {
		const slugifiedHeading = encodeURI(
			heading.trim()
				.toLowerCase()
				.replace(/\s+/g, '-') // Replace whitespace with -
				// allow-any-unicode-next-line
				.replace(/[\]\[\!\/\'\"\#\$\%\&\(\)\*\+\,\.\/\:\;\<\=\>\?\@\\\^\{\|\}\~\`。，、；：？！…—·ˉ¨‘’“”々～‖∶＂＇｀｜〃〔〕〈〉《》「」『』．〖〗【】（）［］｛｝]/g, '') // Remove known punctuators
				.replace(/^-+/, '') // Remove leading -
				.replace(/-+$/, '') // Remove trailing -
		);
		return new Slug(slugifiedHeading);
	}
};
