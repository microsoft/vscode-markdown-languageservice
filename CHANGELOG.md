# Changelog

## 0.4.0-alpha.5 — June 5, 2023
- Make rename and path completions escape angle brackets when inside of angle bracket links.
- Try removing angle brackets from links if the link no longer requires it.
- Don't encode paths as aggressively on path completions.

## 0.4.0-alpha.4 — June 2, 2023
- Fix link detection for escaped angle brackets.

## 0.4.0-alpha.3 — May 30, 2023
- Fix extra escapes being added in angle bracket links on rename.
- Use angle brackets if new name name needs them on rename.

## 0.4.0-alpha.2 — May 23, 2023
- Add path completions in HTML attributes

## 0.4.0-alpha.1 — May 2, 2023
- Enable document links, references, and rename for HTML fragments in Markdown.

## 0.3.0 — March 16, 2023
- Enabled localization using `@vscode/l10n` package.
- Add support for cross workspace header completions when triggered on `##`.
- Add `preferredMdPathExtensionStyle` configuration option to control if generated paths to Markdown files should include or drop the file extension.
- Add folding of tables and block quotes.
- Clean up internal logging API.

## 0.3.0-alpha.6 — March 6, 2023
- Add folding of tables and block quotes.
- Clean up logging API.

## 0.3.0-alpha.5 — February 20, 2023
- Allow language service configuration to be changed dynamically. 

## 0.3.0-alpha.4 — February 1, 2023
- Add support for cross workspace header completions when triggered on `##`.
- Add `preferredMdPathExtensionStyle` configuration option to control if generated paths to Markdown files should include or drop the file extension.

## 0.3.0-alpha.3 — November 30, 2022
- Republish with missing types files.

## 0.3.0-alpha.2 — November 14, 2022
- Switch to `@vscode/l10n` for localization.

## 0.3.0-alpha.1 — November 4, 2022
- Added optional `$uri` property on `ITextDocument` which lets implementers provide an actual uri instead of a string. This helps reduce the number of calls to `URI.parse`.
- Workspace symbol search should be case insensitive.

## 0.2.0 — October 31, 2022
- Added diagnostics for unused link definitions.
- Added diagnostics for duplicated link definitions.
- Added quick fixes for removing duplicate / unused link definitions.
- Added document highlight provider.
- Polish Update links on file rename.
- Fix detection of reference link shorthand for names with spaces.
- Fix reference links references should be case in-sensitive.
- Fix reference links should resolve to first matching link definition.

## 0.1.0 — September 28, 2022
- Added `getCodeActions` to get code actions.
    - Added a code action to extract all occurrences of a link in a file to a link definition at the bottom.
- Added `organizeLinkDefinitions` which sorts link definitions to the bottom of the file and also optionally removes unused definitions.
- `getDocumentSymbols` now takes an optional `includeLinkDefinitions` option to also include link definitions in the document symbols.
- Added a `resolveLinkTarget` method which can be used to figure out where a link points based on its text and containing document.
- Make document links use more generic commands instead of internal VS Code commands.
- Fix document links within notebooks.
- Fix detection of image reference links.
- Use custom command name for triggering rename.
- Add `IPullDiagnosticsManager.disposeDocumentResources` to clean up watchers when a file is closed in the editor.
- Fix false positive diagnostic with files that link to themselves.
- Use parsed markdown to generate header slugs instead of using the original text.
- Make `getRenameFilesInWorkspaceEdit` return full sets of participating edits. 
- Bundle `d.ts` files using api-extractor.

## 0.0.1 — August 26, 2022
- Set explicit editor group when opening document links.

## 0.0.0 — August 16, 2022
- Initial beta release!
