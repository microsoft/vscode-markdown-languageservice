# VS Code Markdown Language Service

> ❗ Note this project is actively being developed and not yet ready for production use!

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


## Usage

To get started using this library, first install it into your workspace:

```bash
npm install vcode-markdown-languageservice
```


## Additional Links

- [VS Code's Markdown language server](https://github.com/microsoft/vscode/blob/main/extensions/markdown-language-features/server/)


## Contributing

If you're interested in contributing

1. Clone this repo
1. Install dependencies using `npm install`
1. Start compilation using `npm run watch`

You can run the unit tests using `npm test` or by opening the project in VS Code and pressing `F5` to debug.
