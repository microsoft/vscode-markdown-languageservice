/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The level of verbosity that the language service logs at.
 */
export enum LogLevel {
	/** Disable logging */
	Off,

	/** Log verbose info about language server operation, such as when references are re-computed for a md file. */
	Debug,

	/** Log extremely verbose info about language server operation, such as calls into the file system */
	Trace,
}

/**
 * Logs debug messages from the language service
 */
export interface ILogger {
	/**
	 * Get the current log level. 
	 */
	get level(): LogLevel; 

	/**
	 * Log a message at a given log level.
	 * 
	 * @param level The level the message should be logged at. 
	 * @param message The main text of the log.
	 * @param data Additional information about what is being logged.
	 */
	log(level: LogLevel, message: string, data?: Record<string, unknown>): void;
}
