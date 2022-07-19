/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export enum LogLevel {
	Debug = 'Debug',
	Trace = 'Trace',
}

export interface ILogger {
	log(level: LogLevel, title: string, message: string, data?: any): void;
}
