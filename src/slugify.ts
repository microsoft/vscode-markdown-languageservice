/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface ISlug {
	readonly value: string;
	equals(other: ISlug): boolean;
}

export class GithubSlug implements ISlug {
	public constructor(
		public readonly value: string
	) { }

	public equals(other: ISlug): boolean {
		return other instanceof GithubSlug && this.value.toLowerCase() === other.value.toLowerCase();
	}
}

/**
 * Generates unique ids for headers in the Markdown.
 */
export interface ISlugifier {
	/**
	 * Create a new slug from the text of a markdown heading.
	 * 
	 * For a heading such as `# Header`, this will be called with `Header`
	 */
	fromHeading(headingText: string): ISlug;

	/**
	 * Create a slug from a link fragment.
	 * 
	 * For a link such as `[text](#header)`, this will be called with `header`
	 */
	fromFragment(fragmentText: string): ISlug;

	/**
	 * Creates a stateful object that can be used to build slugs incrementally.
	 * 
	 * This should be used when getting all slugs in a document as it handles duplicate headings
	 */
	createBuilder(): {
		add(headingText: string): ISlug;
	}
}

/**
 * A {@link ISlugifier slugifier} that approximates how GitHub's slugifier works.
 */
export const githubSlugifier: ISlugifier = new class implements ISlugifier {
	fromHeading(heading: string): ISlug {
		const slugifiedHeading = encodeURI(
			heading.trim()
				.toLowerCase()
				.replace(/\s+/g, '-') // Replace whitespace with -
				// allow-any-unicode-next-line
				.replace(/[\]\[\!\/\'\"\#\$\%\&\(\)\*\+\,\.\/\:\;\<\=\>\?\@\\\^\{\|\}\~\`。，、；：？！…—·ˉ¨‘’“”々～‖∶＂＇｀｜〃〔〕〈〉《》「」『』．〖〗【】（）［］｛｝]/g, '') // Remove known punctuators
				.replace(/^-+/, '') // Remove leading -
				.replace(/-+$/, '') // Remove trailing -
		);
		return new GithubSlug(slugifiedHeading);
	}

	fromFragment(fragmentText: string): ISlug {
		return new GithubSlug(fragmentText.toLowerCase());
	}

	createBuilder() {
		const entries = new Map<string, { count: number }>();
		return {
			add: (heading: string): ISlug => {
				const slug = this.fromHeading(heading);
				const existingSlugEntry = entries.get(slug.value);
				if (existingSlugEntry) {
					++existingSlugEntry.count;
					return this.fromHeading(slug.value + '-' + existingSlugEntry.count);
				}

				entries.set(slug.value, { count: 0 });
				return slug;
			}
		};
	}
};
