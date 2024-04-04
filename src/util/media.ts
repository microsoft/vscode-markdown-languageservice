/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI, Utils } from 'vscode-uri';

export enum MediaType {
    Image,
    Video
}

/**
 * List of common file extensions that can be previewed.
 */
const previewableMediaFileExtension = new Map<string, MediaType>([
    // Image
    ['.bmp', MediaType.Image],
    ['.gif', MediaType.Image],
    ['.jpg', MediaType.Image],
    ['.jpeg', MediaType.Image],
    ['.png', MediaType.Image],
    ['.svg', MediaType.Image],
    ['.webp', MediaType.Image],
    ['.ico', MediaType.Image],
    ['.tiff', MediaType.Image],
    ['.tif', MediaType.Image],

    // Video
    ['.mp4', MediaType.Video],
]);

export function getMediaPreviewType(uri: URI): MediaType | undefined {
    const ext = Utils.extname(uri).toLowerCase();
    return previewableMediaFileExtension.get(ext);
}