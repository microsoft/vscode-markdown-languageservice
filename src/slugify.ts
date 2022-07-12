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

export interface ISlugifier {
	fromHeading(heading: string): Slug;
}

export const githubSlugifier: ISlugifier = new class implements ISlugifier {
	fromHeading(heading: string): Slug {
		const slugifiedHeading = encodeURI(
			heading.trim()
				.toLowerCase()
				.replace(/\s+/g, '-') // Replace whitespace with -
				// allow-any-unicode-next-line
				.replace(/[\]\[\!\/\'\"\#\$\%\&\(\)\*\+\,\.\/\:\;\<\=\>\?\@\\\^\_\{\|\}\~\`。，、；：？！…—·ˉ¨‘’“”々～‖∶＂＇｀｜〃〔〕〈〉《》「」『』．〖〗【】（）［］｛｝]/g, '') // Remove known punctuators
				.replace(/^-+/, '') // Remove leading -
				.replace(/-+$/, '') // Remove trailing -
		);
		return new Slug(slugifiedHeading);
	}
};
