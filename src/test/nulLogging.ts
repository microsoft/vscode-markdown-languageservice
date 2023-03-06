/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILogger, LogLevel } from '../logging';

export const nulLogger = new class implements ILogger {
	readonly level = LogLevel.Off;

	log(): void {
		// noop
	}
};
