# Contributing

Thanks for your interest in contributing to the VS Code Markdown Language Service! This file covers the basics of how to get started with it.

## Building and running

### Prerequisites

- Node.js 22 or newer
- npm

Install dependencies from the repository root:

```sh
npm install
```

### Build

This project is written in TypeScript:

```sh
npm run compile
```

For active development, run the compiler in watch mode:

```sh
npm run watch
```

If you change the public API, update the generated API report:

```sh
npm run api-extractor
```

## Testing

Tests run against the compiled output in `out/`, so compile before testing if needed:

```sh
npm run compile
npm test
```

If you're using VS Code, you can also use the `Mocha` debug configuration to run and debug these tests.

### Linting

You can run the lint checks with:

```sh
npm run lint
```

Before opening a pull request, run:

```sh
npm run compile
npm test
npm run lint
```

### Shipping (for maintainers only)

This project is shipped using the `vscode-markdown-languageservice` pipeline. To ship a new version:

- Make sure `main` has the latest changes including the version bump.
- Run `vscode-markdown-languageservice`. You'll need an approval for this.
- Once the build is complete, approve the release.

This should automatically create tags and a release once the package is published.

After publishing this package, you'll also likely want to publish the [`vscode-markdown-languageserver` package](https://github.com/microsoft/vscode-markdown-languageserver).


## General Project Guidelines

- We target [CommonMark](https://commonmark.org/) for our Markdown.

	We have made some exceptions to support features from [GitHub Flavored Markdown](https://github.github.com/gfm/) (which is built on CommonMark), as this includes widely used features such as tables.

	In addition, we have some limited code to make sure we don't interfere with a few popular Markdown extensions, such as task lists. Without this, many task lists would be reported as missing links. However, we do not offer extensive support for these features.

- We use dependency injection heavily to make sure this library is extensible and that our tests can run quickly and reliably.

	For example, instead of using `fs`, file operations go through `IWorkspace`.

- The tests must run quickly and reliably.

	The entire test suite should take under a second to run and the tests must always be reliable. This means no state, no file system interaction, no randomness. We achieve this largely using dependency injection.

- Compose basic language features to build more advanced language features.

	For example, link validation uses the basic link detector support to find links in a Markdown file. This means that when we fix bugs with link detection, the validator also picks up those fixes automatically.