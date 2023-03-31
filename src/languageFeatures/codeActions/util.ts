/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function codeActionKindContains(kindA: string, kindB: string): unknown {
	return kindA === kindB || kindB.startsWith(kindA + '.');
}
