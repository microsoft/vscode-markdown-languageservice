# Changelog

## 0.2.0-alpha.2 October 13, 2022
- Fix reference links shorthand for names with spaces.
- Fix reference links references should be case in-sensitive.
- Fix reference links should resolve to first matching link definition.

## 0.2.0-alpha.1 October 5, 2022
- Added diagnostics for unused link definitions.
- Added diagnostics for duplicated link definitions.
- Added quick fixes for removing duplicate / unused link definitions.
- Added document highlight provider.

## 0.1.0 September 28, 2022
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
