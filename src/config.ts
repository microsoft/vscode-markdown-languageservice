/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface LsConfiguration {
	/**
	 * List of file extensions should be considered markdown.
	 *
	 * These should not include the leading `.`.
	 */
	readonly markdownFileExtensions: readonly string[];

	/**
	 * List of file extension for files that are linked to from markdown .
	 *
	 * These should not include the leading `.`.
	 *
	 * These are used to avoid duplicate checks when resolving links without
	 * a file extension.
	 */
	readonly knownLinkedToFileExtensions: readonly string[];
}

const defaultConfig: LsConfiguration = {
	markdownFileExtensions: ['md'],
	knownLinkedToFileExtensions: [
		'jpg',
		'jpeg',
		'png',
		'gif',
		'webp',
		'bmp',
		'tiff',
	]
};

export function getLsConfiguration(overrides: Partial<LsConfiguration>): LsConfiguration {
	return {
		...defaultConfig,
		...overrides,
	};
}