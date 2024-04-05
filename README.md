# VS Code Markdown Language Service

The language service that powers VS Code's Markdown support, extracted so that it can be reused by other editors and tools.


## Features

This library targets [CommonMark](https://commonmark.org). Support for other Markdown dialects and extensions is not within the scope of this project.

Currently supported language features:

- Document links (clickable spans in the editor)

	Supported links include:

	- Links to headers within the current file: `[text](#header)`
	- Absolute and relative links to files: `[text](path/to/file.md)`
	- Reference links: `[text][link-name]`

- Document symbols

	Finds all headers within a markdown file

- Workspace symbols

	Find all headers across all markdown files in the workspace.

- Folding ranges

	Folding ranges are computed for:

	- Header sections
	- Region sections
	- Lists
	- Block elements

- Smart select (expand selection)

- Completions

	Supports completions for:

	- Links to headers
	- Path links
	- Reference links

- Hover previews for images and videos

- Find all references

	Supports finding references to:

	- Headers
	- Path links
	- Fragments in links
	- Reference links

- Definitions

	Supports finding definitions headers and reference links.

- Renames

	Supports renaming of headers and links.

- Organize link definitions.

	Groups and sorts link definitions in a file, optionally also removing unused definitions.

-  Code actions

	- Extract all occurrences of a link in a file to a link definition at the bottom of the file.
	- Quick fixes for removing duplicated or unused link definitions.

- Diagnostics (error reporting)

	Supports generating diagnostics for invalid links to:

	- References.
	- Header within the current file.
	- Files in the workspace.
	- Headers in other files.
	
	Also can generate diagnostics for:

	- Unused link definitions.
	- Duplicate link definitions.

- Update links on file rename

	Generate an edit that updates all links when a file/directory in the workspace is renamed or moved.

- (experimental) Update links when coping and pasting text between files.


## Usage

To get started using this library, first install it into your workspace:

```bash
npm install vscode-markdown-languageservice
```

To use the language service, first you need to create an instance of it using `createLanguageService`. We use dependency injection to allow the language service to be used in as many contexts as possible.

```ts
import * as md from 'vscode-markdown-languageservice';

// Implement these
const parser: md.IMdParser = ...;
const workspace: md.IWorkspace = ...;
const logger: md.ILogger = ...;

const languageService = md.createLanguageService({ workspace, parser, logger });
```

After creating the service, you can ask it for the language features it supports:

```ts
// We're using the vscode-language types in this demo
// If you want to use them, make sure to run:
//
//     npm install vscode-languageserver vscode-languageserver-textdocument
//
// However you can also bring your own types if you want to instead.

import { CancellationTokenSource } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';

const cts = new CancellationTokenSource();

// Create a virtual document that holds our file content
const myDocument = TextDocument.create(
	URI.file('/path/to/file.md').toString(), // file path
	'markdown', // file language
	1, // version
	[ // File contents
		'# Hello',
		'from **Markdown**',
		'',
		'## World!',
	].join('\n')
);

const symbols = await languageService.getDocumentSymbols(myDocument, { includeLinkDefinitions: true }, cts.token);
```

See [example.cjs](./example.cjs) for complete, minimal example of using the language service. You can run in using `node example.cjs`.


## Additional Links

- [VS Code's Markdown language server](https://github.com/microsoft/vscode/blob/main/extensions/markdown-language-features/server/)
- [The TextMate grammar VS Code uses for Markdown syntax highlighting](https://github.com/microsoft/vscode-markdown-tm-grammar)


## Contributing

If you're interested in contributing

1. Clone this repo
1. Install dependencies using `npm install`
1. Start compilation using `npm run watch`

You can run the unit tests using `npm test` or by opening the project in VS Code and pressing `F5` to debug.
