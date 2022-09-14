# Changelog

## 0.1.0-alpha.3 — September 13, 2022
- Fix detection of image reference links.
- Use custom command name for triggering rename.

## 0.1.0-alpha.2 — September 7, 2022
- Make document links use more generic commands instead of internal VS Code commands.
- Fix document links within notebooks.
- Add a `resolveLinkTarget` method which can be used to figure out where a link points based on its text and containing document.

## 0.1.0-alpha.1 — August 30, 2022
- `getDocumentSymbols` now takes an optional `includeLinkDefinitions` option to also include link definitions in the document symbols.
- Added `organizeLinkDefinitions` which sorts link definitions to the bottom of the file and also optionally removes unused definitions.
- Added `organizeLinkDefinitions` which sorts link definitions to the bottom of the file and also optionally removes unused definitions.
- Added `getCodeActions` to get code actions
- Added a code action to extract all occurrences of a link in a file to a link definition at the bottom.

## 0.0.1 — August 26, 2022
- Set explicit editor group when opening document links.

## 0.0.0 — August 16, 2022
- Initial beta release!
