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

diff --git a/.vscode/launch.json b/.vscode/launch.json
index a1df503..5f10a9c 100644
--- a/.vscode/launch.json
+++ b/.vscode/launch.json
@@ -1,6 +1,21 @@
-{
-	// Use IntelliSense to learn about possible attributes.
-	// Hover to view descriptions of existing attributes.
+"branches" :"-[ZachryTylerWood]" :\
+"GLOW7:":,
+"BEGINS:":,
+"!#/Users/Bin/Bash/":,
+"#*//Commits" :"*Use:*Excalidraw.yml;/*to start traning..., gIntelliSense to learn about possible attributes.'"''
+"//*Hover to view descriptions of existing attributes.":,
+"//*For" :"more" :"information" :"'#'Visit" :"https://go.microsoft.com/fwlink/?linkid=830387":\
+"versionings" :"Checks'-out'@"v" :"10.2.08" :"\":,
+"configurations" :,
+"#Kind" :"kite" :,
+"request" :"launch" :,
+"name": "Mocha":,
+"program": "${workspaceFolder}/node_modules/mocha/bin/_mocha",
+"coffeescript.md" :"#Create" :"item("{% "$'' 'Obj" %}")" :"'='"'='' )is'='"'"'' 'yargs(AGS)).);     \" :")'='"'='('_'?'_''))'.)';"''     '/'' '::     
+"console": "integratedTerminal",
+"internalConsoleOptions": "OPEN(API)'@package.json]" :
+"*//Use IntelliSense to learn about possible attributes." :
+	// Hover to view descriptions of existing attributes." :
 	// For more information, visit: https://go.microsoft.com/fwlink/?linkid=830387
 	"version": "0.2.0",
 	"configurations": [
@@ -15,7 +30,11 @@
 				"--ui=tdd"
 			],
 			"console": "integratedTerminal",
-			"internalConsoleOptions": "neverOpen"
+			"internalConsoleOptions": "OPEN(A.P.I):\pkg.js'@package.json" :\
+      "branches :'-'' '["' 'trunk'' ']'"'':
+  Push: push_request
+  push_request: branches
+  'Branch: '-'' '['' 'main'' ']'"'' :
 		},
 	]
-}
From b059d7fac5db5ea9954cf1726c396cb46faf1e81 Mon Sep 17 00:00:00 2001
From: ZACHRY T WOOD <124041561+mowjoejoejoejoe@users.noreply.github.com>
Date: Fri, 31 Mar 2023 18:10:30 -0500
Subject: [PATCH 1/3] Dev/mjbvz/rename not supported at location error (#1)

* Don't validate line number links

Stops us from trying to check if there is a heading `#L123` for links such as `[text](#L123)` which are links to line numbers

* Update `getRenameFilesInWorkspaceEdit` to also return the files that effect the edit

* Return full edits

* Add export

* Add `RenameNotSupportedAtLocationError`

Fixes https://github.com/microsoft/vscode/issues/148149

---------
author: ZachrzTylerWood/.Vscode
Co-authored-by: Matt Bierner <matb@microsoft.com>
---
 CHANGELOG.md                          |  6 ++
 package-lock.json                     |  4 +-
 package.json                          |  2 +-
 src/index.ts                          |  9 +--
 src/languageFeatures/diagnostics.ts   | 13 +++-
 src/languageFeatures/documentLinks.ts | 29 ++++++---
 src/languageFeatures/fileRename.ts    | 94 ++++++++++++++++++---------
 src/languageFeatures/rename.ts        | 19 ++++--
 src/test/diagnostic.test.ts           | 13 ++++
 src/test/fileRename.test.ts           | 85 +++++++++++++++++-------
 src/test/rename.test.ts               |  1 +
 11 files changed, 201 insertions(+), 74 deletions(-)

diff --git a/CHANGELOG.md b/CHANGELOG.md
index 76ad78e..f25ddbd 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -1,5 +1,11 @@
 # Changelog
 
+## 0.1.0-alpha.8 — September 20, 2022
+- Make `getRenameFilesInWorkspaceEdit` return full sets of participating edits instead of participating old uris.
+
+## 0.1.0-alpha.7 — September 20, 2022
+- Update `getRenameFilesInWorkspaceEdit` to also return the files that effect the edit.
+
 ## 0.1.0-alpha.6 — September 16, 2022
 - Use parsed markdown to generate header slugs instead of using the original text.
 
diff --git a/package-lock.json b/package-lock.json
index f86286c..e7e8ed9 100644
--- a/package-lock.json
+++ b/package-lock.json
@@ -1,12 +1,12 @@
 {
   "name": "vscode-markdown-languageservice",
-  "version": "0.1.0-alpha.6",
+  "version": "0.1.0-alpha.8",
   "lockfileVersion": 2,
   "requires": true,
   "packages": {
     "": {
       "name": "vscode-markdown-languageservice",
-      "version": "0.1.0-alpha.6",
+      "version": "0.1.0-alpha.8",
       "license": "MIT",
       "dependencies": {
         "picomatch": "^2.3.1",
diff --git a/package.json b/package.json
index 8aedf37..1eff4e8 100644
--- a/package.json
+++ b/package.json
@@ -1,7 +1,7 @@
 {
   "name": "vscode-markdown-languageservice",
   "description": "Markdown language service",
-  "version": "0.1.0-alpha.6",
+  "version": "0.1.0-alpha.8",
   "author": "Microsoft Corporation",
   "license": "MIT",
   "engines": {
diff --git a/src/index.ts b/src/index.ts
index 219333b..eb7ce72 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -12,7 +12,7 @@ import { MdDefinitionProvider } from './languageFeatures/definitions';
 import { DiagnosticComputer, DiagnosticOptions, DiagnosticsManager, IPullDiagnosticsManager } from './languageFeatures/diagnostics';
 import { createWorkspaceLinkCache, MdLinkProvider, ResolvedDocumentLinkTarget } from './languageFeatures/documentLinks';
 import { MdDocumentSymbolProvider } from './languageFeatures/documentSymbols';
-import { MdFileRenameProvider } from './languageFeatures/fileRename';
+import { FileRename, MdFileRenameProvider } from './languageFeatures/fileRename';
 import { MdFoldingProvider } from './languageFeatures/folding';
 import { MdOrganizeLinkDefinitionProvider } from './languageFeatures/organizeLinkDefs';
 import { MdPathCompletionProvider } from './languageFeatures/pathCompletions';
@@ -28,12 +28,13 @@ import { isWorkspaceWithFileWatching, IWorkspace, IWorkspaceWithWatching } from
 
 export { DiagnosticCode, DiagnosticLevel, DiagnosticOptions } from './languageFeatures/diagnostics';
 export { ResolvedDocumentLinkTarget } from './languageFeatures/documentLinks';
+export { RenameNotSupportedAtLocationError } from './languageFeatures/rename';
 export { ILogger, LogLevel } from './logging';
 export { IMdParser, Token } from './parser';
 export { githubSlugifier, ISlugifier } from './slugify';
 export { ITextDocument } from './types/textDocument';
 export { FileStat, FileWatcherOptions, IWorkspace } from './workspace';
-export { IWorkspaceWithWatching };
+export { IWorkspaceWithWatching, FileRename };
 
 /**
  * Provides language tooling methods for working with markdown.
@@ -150,9 +151,9 @@ export interface IMdLanguageService {
 	 *
 	 * You can pass in uris to resources or directories. However if you pass in multiple edits, these edits must not overlap/conflict.
 	 *
-	 * @returns A workspace edit that performs the rename or undefined if the rename cannot be performed.
+	 * @returns An object with a workspace edit that performs the rename and a list of old file uris that effected the edit. Returns undefined if the rename cannot be performed. 
 	 */
-	getRenameFilesInWorkspaceEdit(edits: ReadonlyArray<{ readonly oldUri: URI; readonly newUri: URI }>, token: CancellationToken): Promise<lsp.WorkspaceEdit | undefined>;
+	getRenameFilesInWorkspaceEdit(edits: readonly FileRename[], token: CancellationToken): Promise<{ participatingRenames: readonly FileRename[]; edit: lsp.WorkspaceEdit } | undefined>;
 
 	/**
 	 * Get code actions for a selection in a file.
diff --git a/src/languageFeatures/diagnostics.ts b/src/languageFeatures/diagnostics.ts
index cf1d842..6637a02 100644
--- a/src/languageFeatures/diagnostics.ts
+++ b/src/languageFeatures/diagnostics.ts
@@ -18,7 +18,7 @@ import { looksLikeMarkdownPath } from '../util/file';
 import { Limiter } from '../util/limiter';
 import { ResourceMap } from '../util/resourceMap';
 import { FileStat, IWorkspace, IWorkspaceWithWatching as IWorkspaceWithFileWatching, statLinkToMarkdownFile } from '../workspace';
-import { HrefKind, InternalHref, LinkDefinitionSet, MdLink, MdLinkProvider, MdLinkSource } from './documentLinks';
+import { HrefKind, InternalHref, LinkDefinitionSet, MdLink, MdLinkProvider, MdLinkSource, parseLocationInfoFromFragment } from './documentLinks';
 
 const localize = nls.loadMessageBundle();
 
@@ -141,12 +141,18 @@ export class DiagnosticComputer {
 
 		const diagnostics: lsp.Diagnostic[] = [];
 		for (const link of links) {
+
 			if (link.href.kind === HrefKind.Internal
 				&& link.source.hrefText.startsWith('#')
 				&& link.href.path.toString() === doc.uri.toString()
 				&& link.href.fragment
 				&& !toc.lookup(link.href.fragment)
 			) {
+				// Don't validate line number links
+				if (parseLocationInfoFromFragment(link.href.fragment)) {
+					continue;
+				}
+				
 				if (!this.isIgnoredLink(options, link.source.hrefText)) {
 					diagnostics.push({
 						code: DiagnosticCode.link_noSuchHeaderInOwnFile,
@@ -235,6 +241,11 @@ export class DiagnosticComputer {
 						if (fragmentLinks.length) {
 							const toc = await this.tocProvider.get(resolvedHrefPath);
 							for (const link of fragmentLinks) {
+								// Don't validate line number links
+								if (parseLocationInfoFromFragment(link.fragment)) {
+									continue;
+								}
+
 								if (!toc.lookup(link.fragment) && !this.isIgnoredLink(options, link.source.pathText) && !this.isIgnoredLink(options, link.source.hrefText)) {
 									const range = (link.source.fragmentRange && modifyRange(link.source.fragmentRange, translatePosition(link.source.fragmentRange.start, { characterDelta: -1 }), undefined)) ?? link.source.hrefRange;
 									diagnostics.push({
diff --git a/src/languageFeatures/documentLinks.ts b/src/languageFeatures/documentLinks.ts
index f39d880..bba2721 100644
--- a/src/languageFeatures/documentLinks.ts
+++ b/src/languageFeatures/documentLinks.ts
@@ -724,14 +724,9 @@ export class MdLinkProvider extends Disposable {
 		}
 
 		// Try navigating with fragment that sets line number
-		const lineNumberFragment = linkFragment.match(/^L(\d+)(?:,(\d+))?$/i);
-		if (lineNumberFragment) {
-			const line = +lineNumberFragment[1] - 1;
-			if (!isNaN(line)) {
-				const char = +lineNumberFragment[2] - 1;
-				const position: lsp.Position = { line, character: isNaN(char) ? 0 : char };
-				return { kind: 'file', uri: target, position };
-			}
+		const locationLinkPosition = parseLocationInfoFromFragment(linkFragment);
+		if (locationLinkPosition) {
+			return { kind: 'file', uri: target, position: locationLinkPosition };
 		}
 
 		// Try navigating to header in file
@@ -815,6 +810,24 @@ export class MdLinkProvider extends Disposable {
 	}
 }
 
+/**
+ * Extract position info from link fragments that look like `#L5,3`
+ */
+export function parseLocationInfoFromFragment(fragment: string): lsp.Position | undefined {
+	const match = fragment.match(/^L(\d+)(?:,(\d+))?$/i);
+	if (!match) {
+		return undefined;
+	}
+
+	const line = +match[1] - 1;
+	if (isNaN(line)) {
+		return undefined;
+	}
+
+	const column = +match[2] - 1;
+	return { line, character: isNaN(column) ? 0 : column };
+}
+
 export function createWorkspaceLinkCache(
 	parser: IMdParser,
 	workspace: IWorkspace,
diff --git a/src/languageFeatures/fileRename.ts b/src/languageFeatures/fileRename.ts
index 5618f23..db36061 100644
--- a/src/languageFeatures/fileRename.ts
+++ b/src/languageFeatures/fileRename.ts
@@ -18,11 +18,16 @@ import { getFilePathRange, getLinkRenameText } from './rename';
 import path = require('path');
 
 
-interface FileRename {
+export interface FileRename {
 	readonly oldUri: URI;
 	readonly newUri: URI;
 }
 
+export interface FileRenameResponse {
+	participatingRenames: readonly FileRename[];
+	edit: lsp.WorkspaceEdit;
+}
+
 export class MdFileRenameProvider extends Disposable {
 
 	public constructor(
@@ -34,45 +39,56 @@ export class MdFileRenameProvider extends Disposable {
 		super();
 	}
 
-	async getRenameFilesInWorkspaceEdit(edits: readonly FileRename[], token: CancellationToken): Promise<lsp.WorkspaceEdit | undefined> {
+	async getRenameFilesInWorkspaceEdit(edits: readonly FileRename[], token: CancellationToken): Promise<FileRenameResponse | undefined> {
 		const builder = new WorkspaceEditBuilder();
+		const participatingRenames: FileRename[] = [];
 
 		for (const edit of edits) {
 			const stat = await this.workspace.stat(edit.newUri);
-			if (stat?.isDirectory) {
-				await this.addDirectoryRenameEdits(edit, builder, token);
-			} else {
-				await this.addSingleFileRenameEdits(edit, builder, token);
+			if (token.isCancellationRequested) {
+				return undefined;
 			}
+
+			if (await (stat?.isDirectory ? this.addDirectoryRenameEdits(edit, builder, token) : this.addSingleFileRenameEdits(edit, builder, token))) {
+				participatingRenames.push(edit);
+			}
+
 			if (token.isCancellationRequested) {
 				return undefined;
 			}
 		}
 
-		return builder.getEdit();
+		return { participatingRenames, edit: builder.getEdit() };
 	}
 
-	private async addSingleFileRenameEdits(edit: FileRename, builder: WorkspaceEditBuilder, token: CancellationToken) {
+	private async addSingleFileRenameEdits(edit: FileRename, builder: WorkspaceEditBuilder, token: CancellationToken): Promise<boolean> {
+		let didParticipate = false;
+
 		// Update all references to the file
-		await this.addEditsForReferencesToFile(edit, builder, token);
+		if (await this.addEditsForReferencesToFile(edit, builder, token)) {
+			didParticipate = true;
+		}
+
 		if (token.isCancellationRequested) {
-			return;
+			return false;
 		}
 
 		// If the file moved was markdown, we also need to update links in the file itself
-		await this.tryAddEditsInSelf(edit, builder);
-		if (token.isCancellationRequested) {
-			return;
+		if (await this.tryAddEditsInSelf(edit, builder)) {
+			didParticipate = true;
 		}
+
+		return didParticipate;
 	}
 
-	private async addDirectoryRenameEdits(edit: FileRename, builder: WorkspaceEditBuilder, token: CancellationToken) {
+	private async addDirectoryRenameEdits(edit: FileRename, builder: WorkspaceEditBuilder, token: CancellationToken): Promise<boolean> {
 		// First update every link that points to something in the moved dir
 		const allLinksInWorkspace = await this.linkCache.entries();
 		if (token.isCancellationRequested) {
-			return;
+			return false;
 		}
 
+		let didParticipate = false;
 		for (const [docUri, links] of allLinksInWorkspace) {
 			for (const link of links) {
 				if (link.href.kind !== HrefKind.Internal) {
@@ -85,7 +101,9 @@ export class MdFileRenameProvider extends Disposable {
 					const newUri = edit.newUri.with({
 						path: path.join(edit.newUri.path, relative)
 					});
-					this.addLinkRenameEdit(docUri, link, newUri, builder);
+					if (await this.addLinkRenameEdit(docUri, link, newUri, builder)) {
+						didParticipate = true;
+					}
 				}
 
 				// If the link was within a file in the moved dir but traversed out of it, we also need to update the path
@@ -99,44 +117,54 @@ export class MdFileRenameProvider extends Disposable {
 					if (oldLink && !isParentDir(edit.oldUri, oldLink.resource)) {
 						const rootDir = Utils.dirname(docUri);
 						const newPath = path.relative(rootDir.path, oldLink.resource.path);
+
+						didParticipate = true;
 						builder.replace(docUri, getFilePathRange(link), encodeURI(newPath.replace(/\\/g, '/')));
 					}
 				}
 			}
 		}
+
+		return didParticipate;
 	}
 
 	/**
 	 * Try to add edits for when a markdown file has been renamed.
 	 * In this case we also need to update links within the file.
 	 */
-	private async tryAddEditsInSelf(edit: FileRename, builder: WorkspaceEditBuilder) {
+	private async tryAddEditsInSelf(edit: FileRename, builder: WorkspaceEditBuilder): Promise<boolean> {
 		if (!looksLikeMarkdownPath(this.config, edit.newUri)) {
-			return;
+			return false;
 		}
 
 		if (isExcludedPath(this.config, edit.newUri)) {
-			return;
+			return false;
 		}
 
 		const doc = await this.workspace.openMarkdownDocument(edit.newUri);
 		if (!doc) {
-			return;
+			return false;
 		}
 
 		const links = (await this.linkCache.getForDocs([doc]))[0];
+
+		let didParticipate = false;
 		for (const link of links) {
-			this.addEditsForLinksInSelf(link, edit, builder);
+			if (this.addEditsForLinksInSelf(link, edit, builder)) {
+				didParticipate = true;
+			}
 		}
+		return didParticipate;
 	}
 
-	private addEditsForLinksInSelf(link: MdLink, edit: FileRename, builder: WorkspaceEditBuilder) {
+	private addEditsForLinksInSelf(link: MdLink, edit: FileRename, builder: WorkspaceEditBuilder): boolean {
 		if (link.href.kind !== HrefKind.Internal) {
-			return;
+			return false;
 		}
 
 		if (link.source.hrefText.startsWith('/')) {
 			// We likely don't need to update anything since an absolute path is used
+			return false;
 		} else {
 			// Resolve the link relative to the old file path
 			const oldLink = resolveInternalDocumentLink(edit.oldUri, link.source.hrefText, this.workspace);
@@ -144,33 +172,39 @@ export class MdFileRenameProvider extends Disposable {
 				const rootDir = Utils.dirname(edit.newUri);
 				const newPath = path.relative(rootDir.toString(true), oldLink.resource.toString(true));
 				builder.replace(edit.newUri, getFilePathRange(link), encodeURI(newPath.replace(/\\/g, '/')));
+				return true;
 			}
 		}
+		return false;
 	}
 
 	/**
 	 * Update links across the workspace for the new file name
 	 */
-	private async addEditsForReferencesToFile(edit: FileRename, builder: WorkspaceEditBuilder, token: CancellationToken): Promise<void> {
+	private async addEditsForReferencesToFile(edit: FileRename, builder: WorkspaceEditBuilder, token: CancellationToken): Promise<boolean> {
 		if (isExcludedPath(this.config, edit.newUri)) {
-			return;
+			return false;
 		}
 
 		const refs = await this.referencesProvider.getReferencesToFileInWorkspace(edit.oldUri, token);
 		if (token.isCancellationRequested) {
-			return undefined;
+			return false;
 		}
 
+		let didParticipate = false;
 		for (const ref of refs) {
 			if (ref.kind === MdReferenceKind.Link) {
-				this.addLinkRenameEdit(URI.parse(ref.location.uri), ref.link, edit.newUri, builder);
+				if (await this.addLinkRenameEdit(URI.parse(ref.location.uri), ref.link, edit.newUri, builder)) {
+					didParticipate = true;
+				}
 			}
 		}
+		return didParticipate;
 	}
 
-	private async addLinkRenameEdit(doc: URI, link: MdLink, newUri: URI, builder: WorkspaceEditBuilder) {
+	private async addLinkRenameEdit(doc: URI, link: MdLink, newUri: URI, builder: WorkspaceEditBuilder): Promise<boolean> {
 		if (link.href.kind !== HrefKind.Internal) {
-			return;
+			return false;
 		}
 
 		let newFilePath = newUri;
@@ -188,6 +222,8 @@ export class MdFileRenameProvider extends Disposable {
 		const newLinkText = getLinkRenameText(this.workspace, link.source, newFilePath, link.source.pathText.startsWith('.'));
 		if (typeof newLinkText === 'string') {
 			builder.replace(doc, getFilePathRange(link), encodeURI(newLinkText.replace(/\\/g, '/')));
+			return true;
 		}
+		return false;
 	}
 }
diff --git a/src/languageFeatures/rename.ts b/src/languageFeatures/rename.ts
index 1cfa7ca..bf01136 100644
--- a/src/languageFeatures/rename.ts
+++ b/src/languageFeatures/rename.ts
@@ -28,6 +28,12 @@ export interface MdReferencesResponse {
 	readonly triggerRef: MdReference;
 }
 
+export class RenameNotSupportedAtLocationError extends Error {
+	constructor() {
+		super(localize('rename.notSupported', 'Renaming is not supported here. Try renaming a header or link.'));
+	}
+}
+
 export class MdRenameProvider extends Disposable {
 
 	private cachedRefs?: {
@@ -38,7 +44,6 @@ export class MdRenameProvider extends Disposable {
 		readonly references: MdReference[];
 	} | undefined;
 
-	private readonly renameNotSupportedText = localize('rename.notSupported', 'Rename not supported at location');
 
 	public constructor(
 		private readonly configuration: LsConfiguration,
@@ -59,7 +64,7 @@ export class MdRenameProvider extends Disposable {
 		}
 
 		if (!allRefsInfo || !allRefsInfo.references.length) {
-			throw new Error(this.renameNotSupportedText);
+			throw new RenameNotSupportedAtLocationError();
 		}
 
 		const triggerRef = allRefsInfo.triggerRef;
@@ -83,15 +88,15 @@ export class MdRenameProvider extends Disposable {
 				const { fragmentRange } = triggerRef.link.source;
 				if (fragmentRange && rangeContains(fragmentRange, position)) {
 					const declaration = this.findHeaderDeclaration(allRefsInfo.references);
-					if (declaration) {
-						return { range: fragmentRange, placeholder: declaration.headerText };
-					}
-					return { range: fragmentRange, placeholder: document.getText(fragmentRange) };
+					return {
+						range: fragmentRange,
+						placeholder: declaration ? declaration.headerText : document.getText(fragmentRange),
+					};
 				}
 
 				const range = getFilePathRange(triggerRef.link);
 				if (!range) {
-					throw new Error(this.renameNotSupportedText);
+					throw new RenameNotSupportedAtLocationError();
 				}
 				return { range, placeholder: tryDecodeUri(document.getText(range)) };
 			}
diff --git a/src/test/diagnostic.test.ts b/src/test/diagnostic.test.ts
index f7faad3..a6b51b8 100644
--- a/src/test/diagnostic.test.ts
+++ b/src/test/diagnostic.test.ts
@@ -385,6 +385,19 @@ suite('Diagnostic Computer', () => {
 		assert.strictEqual(diag1.data.fsPath, workspacePath('no such.md').fsPath);
 		assert.strictEqual(diag2.data.fsPath, workspacePath('no such.md').fsPath);
 	}));
+
+	test('Should not validate line number links', withStore(async (store) => {
+		const doc = new InMemoryDocument(workspacePath('doc1.md'), joinLines(
+			`[link](#L1)`,
+			`[link](doc1.md#L1)`,
+			`[link](#L1,2)`,
+			`[link](doc1.md#L1,2)`,
+		));
+		const workspace = store.add(new InMemoryWorkspace([doc]));
+
+		const diagnostics = await getComputedDiagnostics(store, doc, workspace);
+		assertDiagnosticsEqual(diagnostics, []);
+	}));
 });
 
 
diff --git a/src/test/fileRename.test.ts b/src/test/fileRename.test.ts
index fa0f8f4..77715da 100644
--- a/src/test/fileRename.test.ts
+++ b/src/test/fileRename.test.ts
@@ -8,7 +8,7 @@ import * as lsp from 'vscode-languageserver-types';
 import { URI } from 'vscode-uri';
 import { getLsConfiguration } from '../config';
 import { createWorkspaceLinkCache } from '../languageFeatures/documentLinks';
-import { MdFileRenameProvider } from '../languageFeatures/fileRename';
+import { FileRenameResponse, MdFileRenameProvider } from '../languageFeatures/fileRename';
 import { MdReferencesProvider } from '../languageFeatures/references';
 import { MdTableOfContentsProvider } from '../tableOfContents';
 import { makeRange } from '../types/range';
@@ -24,7 +24,7 @@ import { assertRangeEqual, joinLines, withStore, workspacePath } from './util';
 /**
  * Get all the edits for a file rename.
  */
-function getFileRenameEdits(store: DisposableStore, edits: ReadonlyArray<{ oldUri: URI, newUri: URI }>, workspace: IWorkspace): Promise<lsp.WorkspaceEdit | undefined> {
+function getFileRenameEdits(store: DisposableStore, edits: ReadonlyArray<{ oldUri: URI, newUri: URI }>, workspace: IWorkspace): Promise<FileRenameResponse | undefined> {
 	const config = getLsConfiguration({});
 	const engine = createNewMarkdownEngine();
 	const tocProvider = store.add(new MdTableOfContentsProvider(engine, workspace, nulLogger));
@@ -79,8 +79,8 @@ suite('File Rename', () => {
 		const oldUri = workspacePath('old.md');
 		const newUri = workspacePath('new.md');
 
-		const edit = await getFileRenameEdits(store, [{ oldUri, newUri }], workspace);
-		assertEditsEqual(edit!, {
+		const response = await getFileRenameEdits(store, [{ oldUri, newUri }], workspace);
+		assertEditsEqual(response!.edit, {
 			uri, edits: [
 				lsp.TextEdit.replace(makeRange(0, 6, 0, 13), '/new.md'),
 				lsp.TextEdit.replace(makeRange(1, 6, 1, 12), 'new.md'),
@@ -103,8 +103,8 @@ suite('File Rename', () => {
 		const oldUri = workspacePath('old.md');
 		const newUri = workspacePath('new.md');
 
-		const edit = await getFileRenameEdits(store, [{ oldUri, newUri }], workspace);
-		assertEditsEqual(edit!, {
+		const response = await getFileRenameEdits(store, [{ oldUri, newUri }], workspace);
+		assertEditsEqual(response!.edit, {
 			uri, edits: [
 				lsp.TextEdit.replace(makeRange(0, 6, 0, 13), '/new.md'),
 				lsp.TextEdit.replace(makeRange(1, 6, 1, 12), 'new.md'),
@@ -127,8 +127,8 @@ suite('File Rename', () => {
 		const oldUri = workspacePath('old.md');
 		const newUri = workspacePath('new.md');
 
-		const edit = await getFileRenameEdits(store, [{ oldUri, newUri }], workspace);
-		assertEditsEqual(edit!, {
+		const response = await getFileRenameEdits(store, [{ oldUri, newUri }], workspace);
+		assertEditsEqual(response!.edit, {
 			uri: docUri, edits: [
 				lsp.TextEdit.replace(makeRange(0, 6, 0, 10), '/new'),
 				lsp.TextEdit.replace(makeRange(1, 6, 1, 9), 'new'),
@@ -153,8 +153,8 @@ suite('File Rename', () => {
 		const oldUri = workspacePath('old.md');
 		const newUri = workspacePath('new with space.md');
 
-		const edit = await getFileRenameEdits(store, [{ oldUri, newUri }], workspace);
-		assertEditsEqual(edit!, {
+		const response = await getFileRenameEdits(store, [{ oldUri, newUri }], workspace);
+		assertEditsEqual(response!.edit, {
 			uri: docUri, edits: [
 				lsp.TextEdit.replace(makeRange(0, 6, 0, 13), '/new%20with%20space.md'),
 				lsp.TextEdit.replace(makeRange(1, 6, 1, 12), 'new%20with%20space.md'),
@@ -181,12 +181,12 @@ suite('File Rename', () => {
 		));
 		const workspace = store.add(new InMemoryWorkspace([doc]));
 
-		const edit = await getFileRenameEdits(store, [
+		const response = await getFileRenameEdits(store, [
 			{ oldUri: workspacePath('cat.png'), newUri: workspacePath('kitty.png') },
 			{ oldUri: workspacePath('dog.png'), newUri: workspacePath('hot', 'doggo.png') },
 		], workspace);
 
-		assertEditsEqual(edit!, {
+		assertEditsEqual(response!.edit, {
 			uri, edits: [
 				lsp.TextEdit.replace(makeRange(0, 6, 0, 14), '/kitty.png'),
 				lsp.TextEdit.replace(makeRange(2, 6, 2, 13), 'kitty.png'),
@@ -214,8 +214,8 @@ suite('File Rename', () => {
 		));
 		const workspace = store.add(new InMemoryWorkspace([doc]));
 
-		const edit = await getFileRenameEdits(store, [{ oldUri: oldUri, newUri }], workspace);
-		assertEditsEqual(edit!, {
+		const response = await getFileRenameEdits(store, [{ oldUri: oldUri, newUri }], workspace);
+		assertEditsEqual(response!.edit, {
 			uri: newUri, edits: [
 				lsp.TextEdit.replace(makeRange(1, 6, 1, 14), '../other.md'),
 				lsp.TextEdit.replace(makeRange(2, 6, 2, 16), '../other.md'),
@@ -237,8 +237,8 @@ suite('File Rename', () => {
 		));
 		const workspace = store.add(new InMemoryWorkspace([doc]));
 
-		const edit = await getFileRenameEdits(store, [{ oldUri: oldUri, newUri }], workspace);
-		assertEditsEqual(edit!, {
+		const response = await getFileRenameEdits(store, [{ oldUri: oldUri, newUri }], workspace);
+		assertEditsEqual(response!.edit, {
 			uri: newUri, edits: [
 				lsp.TextEdit.replace(makeRange(1, 6, 1, 11), '../other'),
 				lsp.TextEdit.replace(makeRange(2, 6, 2, 13), '../other'),
@@ -270,8 +270,8 @@ suite('File Rename', () => {
 		const oldUri = workspacePath('old');
 		const newUri = workspacePath('new');
 
-		const edit = await getFileRenameEdits(store, [{ oldUri, newUri }], workspace);
-		assertEditsEqual(edit!, {
+		const response = await getFileRenameEdits(store, [{ oldUri, newUri }], workspace);
+		assertEditsEqual(response!.edit, {
 			uri, edits: [
 				lsp.TextEdit.replace(makeRange(0, 6, 0, 15), '/new/a.md'),
 				lsp.TextEdit.replace(makeRange(1, 6, 1, 15), '/new/b.md'),
@@ -313,8 +313,8 @@ suite('File Rename', () => {
 		const oldUri = workspacePath('old');
 		const newUri = workspacePath('new');
 
-		const edit = await getFileRenameEdits(store, [{ oldUri: oldUri, newUri }], workspace);
-		assertEditsEqual(edit!, {
+		const response = await getFileRenameEdits(store, [{ oldUri: oldUri, newUri }], workspace);
+		assertEditsEqual(response!.edit, {
 			uri: uri, edits: [
 				lsp.TextEdit.replace(makeRange(0, 6, 0, 15), '/new/a.md'),
 				lsp.TextEdit.replace(makeRange(1, 6, 1, 15), '/new/b.md'),
@@ -342,12 +342,53 @@ suite('File Rename', () => {
 		const oldUri = workspacePath('old');
 		const newUri = workspacePath('new', 'sub');
 
-		const edit = await getFileRenameEdits(store, [{ oldUri: oldUri, newUri }], workspace);
-		assertEditsEqual(edit!, {
+		const response = await getFileRenameEdits(store, [{ oldUri: oldUri, newUri }], workspace);
+		assertEditsEqual(response!.edit, {
 			uri: uri, edits: [
 				lsp.TextEdit.replace(makeRange(2, 6, 2, 13), '../../a.md'),
 				lsp.TextEdit.replace(makeRange(3, 6, 3, 13), '../../b.md'),
 			]
 		});
 	}));
+
+	test('Should update links when renaming multiple files', withStore(async (store) => {
+		const uri = workspacePath('doc.md');
+		const doc = new InMemoryDocument(uri, joinLines(
+			`[abc](/old1.md)`,
+			`[abc](old2.md)`,
+			`[abc](./old1.md)`,
+			`[xyz]: ./old2.md`,
+			`[abc](/other1.md)`,
+			`[xyz1]: ./other1.md`,
+		));
+		const workspace = store.add(new InMemoryWorkspace([doc]));
+
+		const old1Uri = workspacePath('old1.md');
+		const new1Uri = workspacePath('new1.md');
+
+		const old2Uri = workspacePath('old2.md');
+		const new2Uri = workspacePath('new2.md');
+
+		const response = await getFileRenameEdits(store, [
+			{ oldUri: old1Uri, newUri: new1Uri },
+			{ oldUri: old2Uri, newUri: new2Uri },
+			// And create an edit that does not effect the result
+			{
+				oldUri: workspacePath('uninvolved.md'), 
+				newUri: workspacePath('uninvolved-new.md')
+			}
+		], workspace);
+		assertEditsEqual(response!.edit, {
+			uri, edits: [
+				lsp.TextEdit.replace(makeRange(0, 6, 0, 14), '/new1.md'),
+				lsp.TextEdit.replace(makeRange(2, 6, 2, 15), './new1.md'),
+				lsp.TextEdit.replace(makeRange(1, 6, 1, 13), 'new2.md'),
+				lsp.TextEdit.replace(makeRange(3, 7, 3, 16), './new2.md'),
+			]
+		});
+
+		assert.strictEqual(response?.participatingRenames.length, 2);
+		assert.strictEqual(response?.participatingRenames[0].oldUri.toString(), old1Uri.toString());
+		assert.strictEqual(response?.participatingRenames[1].oldUri.toString(), old2Uri.toString());
+	}));
 });
\ No newline at end of file
diff --git a/src/test/rename.test.ts b/src/test/rename.test.ts
index c8dac1f..50b62cb 100644
--- a/src/test/rename.test.ts
+++ b/src/test/rename.test.ts
@@ -721,3 +721,4 @@ suite('Rename', () => {
 		});
 	}));
 });
+ 
\ No newline at end of file

From 3752702186d388a0c1ad2781668e0014fdfcbbfa Mon Sep 17 00:00:00 2001
From: ZACHRY T WOOD <124041561+mowjoejoejoejoe@users.noreply.github.com>
Date: Fri, 31 Mar 2023 18:10:51 -0500
Subject: [PATCH 2/3] Revert "Dev/mjbvz/rename not supported at location error
 (#1)"

This reverts commit b059d7fac5db5ea9954cf1726c396cb46faf1e81.
---
 CHANGELOG.md                          |  6 --
 package-lock.json                     |  4 +-
 package.json                          |  2 +-
 src/index.ts                          |  9 ++-
 src/languageFeatures/diagnostics.ts   | 13 +---
 src/languageFeatures/documentLinks.ts | 29 +++------
 src/languageFeatures/fileRename.ts    | 94 +++++++++------------------
 src/languageFeatures/rename.ts        | 19 ++----
 src/test/diagnostic.test.ts           | 13 ----
 src/test/fileRename.test.ts           | 85 +++++++-----------------
 src/test/rename.test.ts               |  1 -
 11 files changed, 74 insertions(+), 201 deletions(-)

diff --git a/CHANGELOG.md b/CHANGELOG.md
index f25ddbd..76ad78e 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -1,11 +1,5 @@
 # Changelog
 
-## 0.1.0-alpha.8 — September 20, 2022
-- Make `getRenameFilesInWorkspaceEdit` return full sets of participating edits instead of participating old uris.
-
-## 0.1.0-alpha.7 — September 20, 2022
-- Update `getRenameFilesInWorkspaceEdit` to also return the files that effect the edit.
-
 ## 0.1.0-alpha.6 — September 16, 2022
 - Use parsed markdown to generate header slugs instead of using the original text.
 
diff --git a/package-lock.json b/package-lock.json
index e7e8ed9..f86286c 100644
--- a/package-lock.json
+++ b/package-lock.json
@@ -1,12 +1,12 @@
 {
   "name": "vscode-markdown-languageservice",
-  "version": "0.1.0-alpha.8",
+  "version": "0.1.0-alpha.6",
   "lockfileVersion": 2,
   "requires": true,
   "packages": {
     "": {
       "name": "vscode-markdown-languageservice",
-      "version": "0.1.0-alpha.8",
+      "version": "0.1.0-alpha.6",
       "license": "MIT",
       "dependencies": {
         "picomatch": "^2.3.1",
diff --git a/package.json b/package.json
index 1eff4e8..8aedf37 100644
--- a/package.json
+++ b/package.json
@@ -1,7 +1,7 @@
 {
   "name": "vscode-markdown-languageservice",
   "description": "Markdown language service",
-  "version": "0.1.0-alpha.8",
+  "version": "0.1.0-alpha.6",
   "author": "Microsoft Corporation",
   "license": "MIT",
   "engines": {
diff --git a/src/index.ts b/src/index.ts
index eb7ce72..219333b 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -12,7 +12,7 @@ import { MdDefinitionProvider } from './languageFeatures/definitions';
 import { DiagnosticComputer, DiagnosticOptions, DiagnosticsManager, IPullDiagnosticsManager } from './languageFeatures/diagnostics';
 import { createWorkspaceLinkCache, MdLinkProvider, ResolvedDocumentLinkTarget } from './languageFeatures/documentLinks';
 import { MdDocumentSymbolProvider } from './languageFeatures/documentSymbols';
-import { FileRename, MdFileRenameProvider } from './languageFeatures/fileRename';
+import { MdFileRenameProvider } from './languageFeatures/fileRename';
 import { MdFoldingProvider } from './languageFeatures/folding';
 import { MdOrganizeLinkDefinitionProvider } from './languageFeatures/organizeLinkDefs';
 import { MdPathCompletionProvider } from './languageFeatures/pathCompletions';
@@ -28,13 +28,12 @@ import { isWorkspaceWithFileWatching, IWorkspace, IWorkspaceWithWatching } from
 
 export { DiagnosticCode, DiagnosticLevel, DiagnosticOptions } from './languageFeatures/diagnostics';
 export { ResolvedDocumentLinkTarget } from './languageFeatures/documentLinks';
-export { RenameNotSupportedAtLocationError } from './languageFeatures/rename';
 export { ILogger, LogLevel } from './logging';
 export { IMdParser, Token } from './parser';
 export { githubSlugifier, ISlugifier } from './slugify';
 export { ITextDocument } from './types/textDocument';
 export { FileStat, FileWatcherOptions, IWorkspace } from './workspace';
-export { IWorkspaceWithWatching, FileRename };
+export { IWorkspaceWithWatching };
 
 /**
  * Provides language tooling methods for working with markdown.
@@ -151,9 +150,9 @@ export interface IMdLanguageService {
 	 *
 	 * You can pass in uris to resources or directories. However if you pass in multiple edits, these edits must not overlap/conflict.
 	 *
-	 * @returns An object with a workspace edit that performs the rename and a list of old file uris that effected the edit. Returns undefined if the rename cannot be performed. 
+	 * @returns A workspace edit that performs the rename or undefined if the rename cannot be performed.
 	 */
-	getRenameFilesInWorkspaceEdit(edits: readonly FileRename[], token: CancellationToken): Promise<{ participatingRenames: readonly FileRename[]; edit: lsp.WorkspaceEdit } | undefined>;
+	getRenameFilesInWorkspaceEdit(edits: ReadonlyArray<{ readonly oldUri: URI; readonly newUri: URI }>, token: CancellationToken): Promise<lsp.WorkspaceEdit | undefined>;
 
 	/**
 	 * Get code actions for a selection in a file.
diff --git a/src/languageFeatures/diagnostics.ts b/src/languageFeatures/diagnostics.ts
index 6637a02..cf1d842 100644
--- a/src/languageFeatures/diagnostics.ts
+++ b/src/languageFeatures/diagnostics.ts
@@ -18,7 +18,7 @@ import { looksLikeMarkdownPath } from '../util/file';
 import { Limiter } from '../util/limiter';
 import { ResourceMap } from '../util/resourceMap';
 import { FileStat, IWorkspace, IWorkspaceWithWatching as IWorkspaceWithFileWatching, statLinkToMarkdownFile } from '../workspace';
-import { HrefKind, InternalHref, LinkDefinitionSet, MdLink, MdLinkProvider, MdLinkSource, parseLocationInfoFromFragment } from './documentLinks';
+import { HrefKind, InternalHref, LinkDefinitionSet, MdLink, MdLinkProvider, MdLinkSource } from './documentLinks';
 
 const localize = nls.loadMessageBundle();
 
@@ -141,18 +141,12 @@ export class DiagnosticComputer {
 
 		const diagnostics: lsp.Diagnostic[] = [];
 		for (const link of links) {
-
 			if (link.href.kind === HrefKind.Internal
 				&& link.source.hrefText.startsWith('#')
 				&& link.href.path.toString() === doc.uri.toString()
 				&& link.href.fragment
 				&& !toc.lookup(link.href.fragment)
 			) {
-				// Don't validate line number links
-				if (parseLocationInfoFromFragment(link.href.fragment)) {
-					continue;
-				}
-				
 				if (!this.isIgnoredLink(options, link.source.hrefText)) {
 					diagnostics.push({
 						code: DiagnosticCode.link_noSuchHeaderInOwnFile,
@@ -241,11 +235,6 @@ export class DiagnosticComputer {
 						if (fragmentLinks.length) {
 							const toc = await this.tocProvider.get(resolvedHrefPath);
 							for (const link of fragmentLinks) {
-								// Don't validate line number links
-								if (parseLocationInfoFromFragment(link.fragment)) {
-									continue;
-								}
-
 								if (!toc.lookup(link.fragment) && !this.isIgnoredLink(options, link.source.pathText) && !this.isIgnoredLink(options, link.source.hrefText)) {
 									const range = (link.source.fragmentRange && modifyRange(link.source.fragmentRange, translatePosition(link.source.fragmentRange.start, { characterDelta: -1 }), undefined)) ?? link.source.hrefRange;
 									diagnostics.push({
diff --git a/src/languageFeatures/documentLinks.ts b/src/languageFeatures/documentLinks.ts
index bba2721..f39d880 100644
--- a/src/languageFeatures/documentLinks.ts
+++ b/src/languageFeatures/documentLinks.ts
@@ -724,9 +724,14 @@ export class MdLinkProvider extends Disposable {
 		}
 
 		// Try navigating with fragment that sets line number
-		const locationLinkPosition = parseLocationInfoFromFragment(linkFragment);
-		if (locationLinkPosition) {
-			return { kind: 'file', uri: target, position: locationLinkPosition };
+		const lineNumberFragment = linkFragment.match(/^L(\d+)(?:,(\d+))?$/i);
+		if (lineNumberFragment) {
+			const line = +lineNumberFragment[1] - 1;
+			if (!isNaN(line)) {
+				const char = +lineNumberFragment[2] - 1;
+				const position: lsp.Position = { line, character: isNaN(char) ? 0 : char };
+				return { kind: 'file', uri: target, position };
+			}
 		}
 
 		// Try navigating to header in file
@@ -810,24 +815,6 @@ export class MdLinkProvider extends Disposable {
 	}
 }
 
-/**
- * Extract position info from link fragments that look like `#L5,3`
- */
-export function parseLocationInfoFromFragment(fragment: string): lsp.Position | undefined {
-	const match = fragment.match(/^L(\d+)(?:,(\d+))?$/i);
-	if (!match) {
-		return undefined;
-	}
-
-	const line = +match[1] - 1;
-	if (isNaN(line)) {
-		return undefined;
-	}
-
-	const column = +match[2] - 1;
-	return { line, character: isNaN(column) ? 0 : column };
-}
-
 export function createWorkspaceLinkCache(
 	parser: IMdParser,
 	workspace: IWorkspace,
diff --git a/src/languageFeatures/fileRename.ts b/src/languageFeatures/fileRename.ts
index db36061..5618f23 100644
--- a/src/languageFeatures/fileRename.ts
+++ b/src/languageFeatures/fileRename.ts
@@ -18,16 +18,11 @@ import { getFilePathRange, getLinkRenameText } from './rename';
 import path = require('path');
 
 
-export interface FileRename {
+interface FileRename {
 	readonly oldUri: URI;
 	readonly newUri: URI;
 }
 
-export interface FileRenameResponse {
-	participatingRenames: readonly FileRename[];
-	edit: lsp.WorkspaceEdit;
-}
-
 export class MdFileRenameProvider extends Disposable {
 
 	public constructor(
@@ -39,56 +34,45 @@ export class MdFileRenameProvider extends Disposable {
 		super();
 	}
 
-	async getRenameFilesInWorkspaceEdit(edits: readonly FileRename[], token: CancellationToken): Promise<FileRenameResponse | undefined> {
+	async getRenameFilesInWorkspaceEdit(edits: readonly FileRename[], token: CancellationToken): Promise<lsp.WorkspaceEdit | undefined> {
 		const builder = new WorkspaceEditBuilder();
-		const participatingRenames: FileRename[] = [];
 
 		for (const edit of edits) {
 			const stat = await this.workspace.stat(edit.newUri);
-			if (token.isCancellationRequested) {
-				return undefined;
+			if (stat?.isDirectory) {
+				await this.addDirectoryRenameEdits(edit, builder, token);
+			} else {
+				await this.addSingleFileRenameEdits(edit, builder, token);
 			}
-
-			if (await (stat?.isDirectory ? this.addDirectoryRenameEdits(edit, builder, token) : this.addSingleFileRenameEdits(edit, builder, token))) {
-				participatingRenames.push(edit);
-			}
-
 			if (token.isCancellationRequested) {
 				return undefined;
 			}
 		}
 
-		return { participatingRenames, edit: builder.getEdit() };
+		return builder.getEdit();
 	}
 
-	private async addSingleFileRenameEdits(edit: FileRename, builder: WorkspaceEditBuilder, token: CancellationToken): Promise<boolean> {
-		let didParticipate = false;
-
+	private async addSingleFileRenameEdits(edit: FileRename, builder: WorkspaceEditBuilder, token: CancellationToken) {
 		// Update all references to the file
-		if (await this.addEditsForReferencesToFile(edit, builder, token)) {
-			didParticipate = true;
-		}
-
+		await this.addEditsForReferencesToFile(edit, builder, token);
 		if (token.isCancellationRequested) {
-			return false;
+			return;
 		}
 
 		// If the file moved was markdown, we also need to update links in the file itself
-		if (await this.tryAddEditsInSelf(edit, builder)) {
-			didParticipate = true;
+		await this.tryAddEditsInSelf(edit, builder);
+		if (token.isCancellationRequested) {
+			return;
 		}
-
-		return didParticipate;
 	}
 
-	private async addDirectoryRenameEdits(edit: FileRename, builder: WorkspaceEditBuilder, token: CancellationToken): Promise<boolean> {
+	private async addDirectoryRenameEdits(edit: FileRename, builder: WorkspaceEditBuilder, token: CancellationToken) {
 		// First update every link that points to something in the moved dir
 		const allLinksInWorkspace = await this.linkCache.entries();
 		if (token.isCancellationRequested) {
-			return false;
+			return;
 		}
 
-		let didParticipate = false;
 		for (const [docUri, links] of allLinksInWorkspace) {
 			for (const link of links) {
 				if (link.href.kind !== HrefKind.Internal) {
@@ -101,9 +85,7 @@ export class MdFileRenameProvider extends Disposable {
 					const newUri = edit.newUri.with({
 						path: path.join(edit.newUri.path, relative)
 					});
-					if (await this.addLinkRenameEdit(docUri, link, newUri, builder)) {
-						didParticipate = true;
-					}
+					this.addLinkRenameEdit(docUri, link, newUri, builder);
 				}
 
 				// If the link was within a file in the moved dir but traversed out of it, we also need to update the path
@@ -117,54 +99,44 @@ export class MdFileRenameProvider extends Disposable {
 					if (oldLink && !isParentDir(edit.oldUri, oldLink.resource)) {
 						const rootDir = Utils.dirname(docUri);
 						const newPath = path.relative(rootDir.path, oldLink.resource.path);
-
-						didParticipate = true;
 						builder.replace(docUri, getFilePathRange(link), encodeURI(newPath.replace(/\\/g, '/')));
 					}
 				}
 			}
 		}
-
-		return didParticipate;
 	}
 
 	/**
 	 * Try to add edits for when a markdown file has been renamed.
 	 * In this case we also need to update links within the file.
 	 */
-	private async tryAddEditsInSelf(edit: FileRename, builder: WorkspaceEditBuilder): Promise<boolean> {
+	private async tryAddEditsInSelf(edit: FileRename, builder: WorkspaceEditBuilder) {
 		if (!looksLikeMarkdownPath(this.config, edit.newUri)) {
-			return false;
+			return;
 		}
 
 		if (isExcludedPath(this.config, edit.newUri)) {
-			return false;
+			return;
 		}
 
 		const doc = await this.workspace.openMarkdownDocument(edit.newUri);
 		if (!doc) {
-			return false;
+			return;
 		}
 
 		const links = (await this.linkCache.getForDocs([doc]))[0];
-
-		let didParticipate = false;
 		for (const link of links) {
-			if (this.addEditsForLinksInSelf(link, edit, builder)) {
-				didParticipate = true;
-			}
+			this.addEditsForLinksInSelf(link, edit, builder);
 		}
-		return didParticipate;
 	}
 
-	private addEditsForLinksInSelf(link: MdLink, edit: FileRename, builder: WorkspaceEditBuilder): boolean {
+	private addEditsForLinksInSelf(link: MdLink, edit: FileRename, builder: WorkspaceEditBuilder) {
 		if (link.href.kind !== HrefKind.Internal) {
-			return false;
+			return;
 		}
 
 		if (link.source.hrefText.startsWith('/')) {
 			// We likely don't need to update anything since an absolute path is used
-			return false;
 		} else {
 			// Resolve the link relative to the old file path
 			const oldLink = resolveInternalDocumentLink(edit.oldUri, link.source.hrefText, this.workspace);
@@ -172,39 +144,33 @@ export class MdFileRenameProvider extends Disposable {
 				const rootDir = Utils.dirname(edit.newUri);
 				const newPath = path.relative(rootDir.toString(true), oldLink.resource.toString(true));
 				builder.replace(edit.newUri, getFilePathRange(link), encodeURI(newPath.replace(/\\/g, '/')));
-				return true;
 			}
 		}
-		return false;
 	}
 
 	/**
 	 * Update links across the workspace for the new file name
 	 */
-	private async addEditsForReferencesToFile(edit: FileRename, builder: WorkspaceEditBuilder, token: CancellationToken): Promise<boolean> {
+	private async addEditsForReferencesToFile(edit: FileRename, builder: WorkspaceEditBuilder, token: CancellationToken): Promise<void> {
 		if (isExcludedPath(this.config, edit.newUri)) {
-			return false;
+			return;
 		}
 
 		const refs = await this.referencesProvider.getReferencesToFileInWorkspace(edit.oldUri, token);
 		if (token.isCancellationRequested) {
-			return false;
+			return undefined;
 		}
 
-		let didParticipate = false;
 		for (const ref of refs) {
 			if (ref.kind === MdReferenceKind.Link) {
-				if (await this.addLinkRenameEdit(URI.parse(ref.location.uri), ref.link, edit.newUri, builder)) {
-					didParticipate = true;
-				}
+				this.addLinkRenameEdit(URI.parse(ref.location.uri), ref.link, edit.newUri, builder);
 			}
 		}
-		return didParticipate;
 	}
 
-	private async addLinkRenameEdit(doc: URI, link: MdLink, newUri: URI, builder: WorkspaceEditBuilder): Promise<boolean> {
+	private async addLinkRenameEdit(doc: URI, link: MdLink, newUri: URI, builder: WorkspaceEditBuilder) {
 		if (link.href.kind !== HrefKind.Internal) {
-			return false;
+			return;
 		}
 
 		let newFilePath = newUri;
@@ -222,8 +188,6 @@ export class MdFileRenameProvider extends Disposable {
 		const newLinkText = getLinkRenameText(this.workspace, link.source, newFilePath, link.source.pathText.startsWith('.'));
 		if (typeof newLinkText === 'string') {
 			builder.replace(doc, getFilePathRange(link), encodeURI(newLinkText.replace(/\\/g, '/')));
-			return true;
 		}
-		return false;
 	}
 }
diff --git a/src/languageFeatures/rename.ts b/src/languageFeatures/rename.ts
index bf01136..1cfa7ca 100644
--- a/src/languageFeatures/rename.ts
+++ b/src/languageFeatures/rename.ts
@@ -28,12 +28,6 @@ export interface MdReferencesResponse {
 	readonly triggerRef: MdReference;
 }
 
-export class RenameNotSupportedAtLocationError extends Error {
-	constructor() {
-		super(localize('rename.notSupported', 'Renaming is not supported here. Try renaming a header or link.'));
-	}
-}
-
 export class MdRenameProvider extends Disposable {
 
 	private cachedRefs?: {
@@ -44,6 +38,7 @@ export class MdRenameProvider extends Disposable {
 		readonly references: MdReference[];
 	} | undefined;
 
+	private readonly renameNotSupportedText = localize('rename.notSupported', 'Rename not supported at location');
 
 	public constructor(
 		private readonly configuration: LsConfiguration,
@@ -64,7 +59,7 @@ export class MdRenameProvider extends Disposable {
 		}
 
 		if (!allRefsInfo || !allRefsInfo.references.length) {
-			throw new RenameNotSupportedAtLocationError();
+			throw new Error(this.renameNotSupportedText);
 		}
 
 		const triggerRef = allRefsInfo.triggerRef;
@@ -88,15 +83,15 @@ export class MdRenameProvider extends Disposable {
 				const { fragmentRange } = triggerRef.link.source;
 				if (fragmentRange && rangeContains(fragmentRange, position)) {
 					const declaration = this.findHeaderDeclaration(allRefsInfo.references);
-					return {
-						range: fragmentRange,
-						placeholder: declaration ? declaration.headerText : document.getText(fragmentRange),
-					};
+					if (declaration) {
+						return { range: fragmentRange, placeholder: declaration.headerText };
+					}
+					return { range: fragmentRange, placeholder: document.getText(fragmentRange) };
 				}
 
 				const range = getFilePathRange(triggerRef.link);
 				if (!range) {
-					throw new RenameNotSupportedAtLocationError();
+					throw new Error(this.renameNotSupportedText);
 				}
 				return { range, placeholder: tryDecodeUri(document.getText(range)) };
 			}
diff --git a/src/test/diagnostic.test.ts b/src/test/diagnostic.test.ts
index a6b51b8..f7faad3 100644
--- a/src/test/diagnostic.test.ts
+++ b/src/test/diagnostic.test.ts
@@ -385,19 +385,6 @@ suite('Diagnostic Computer', () => {
 		assert.strictEqual(diag1.data.fsPath, workspacePath('no such.md').fsPath);
 		assert.strictEqual(diag2.data.fsPath, workspacePath('no such.md').fsPath);
 	}));
-
-	test('Should not validate line number links', withStore(async (store) => {
-		const doc = new InMemoryDocument(workspacePath('doc1.md'), joinLines(
-			`[link](#L1)`,
-			`[link](doc1.md#L1)`,
-			`[link](#L1,2)`,
-			`[link](doc1.md#L1,2)`,
-		));
-		const workspace = store.add(new InMemoryWorkspace([doc]));
-
-		const diagnostics = await getComputedDiagnostics(store, doc, workspace);
-		assertDiagnosticsEqual(diagnostics, []);
-	}));
 });
 
 
diff --git a/src/test/fileRename.test.ts b/src/test/fileRename.test.ts
index 77715da..fa0f8f4 100644
--- a/src/test/fileRename.test.ts
+++ b/src/test/fileRename.test.ts
@@ -8,7 +8,7 @@ import * as lsp from 'vscode-languageserver-types';
 import { URI } from 'vscode-uri';
 import { getLsConfiguration } from '../config';
 import { createWorkspaceLinkCache } from '../languageFeatures/documentLinks';
-import { FileRenameResponse, MdFileRenameProvider } from '../languageFeatures/fileRename';
+import { MdFileRenameProvider } from '../languageFeatures/fileRename';
 import { MdReferencesProvider } from '../languageFeatures/references';
 import { MdTableOfContentsProvider } from '../tableOfContents';
 import { makeRange } from '../types/range';
@@ -24,7 +24,7 @@ import { assertRangeEqual, joinLines, withStore, workspacePath } from './util';
 /**
  * Get all the edits for a file rename.
  */
-function getFileRenameEdits(store: DisposableStore, edits: ReadonlyArray<{ oldUri: URI, newUri: URI }>, workspace: IWorkspace): Promise<FileRenameResponse | undefined> {
+function getFileRenameEdits(store: DisposableStore, edits: ReadonlyArray<{ oldUri: URI, newUri: URI }>, workspace: IWorkspace): Promise<lsp.WorkspaceEdit | undefined> {
 	const config = getLsConfiguration({});
 	const engine = createNewMarkdownEngine();
 	const tocProvider = store.add(new MdTableOfContentsProvider(engine, workspace, nulLogger));
@@ -79,8 +79,8 @@ suite('File Rename', () => {
 		const oldUri = workspacePath('old.md');
 		const newUri = workspacePath('new.md');
 
-		const response = await getFileRenameEdits(store, [{ oldUri, newUri }], workspace);
-		assertEditsEqual(response!.edit, {
+		const edit = await getFileRenameEdits(store, [{ oldUri, newUri }], workspace);
+		assertEditsEqual(edit!, {
 			uri, edits: [
 				lsp.TextEdit.replace(makeRange(0, 6, 0, 13), '/new.md'),
 				lsp.TextEdit.replace(makeRange(1, 6, 1, 12), 'new.md'),
@@ -103,8 +103,8 @@ suite('File Rename', () => {
 		const oldUri = workspacePath('old.md');
 		const newUri = workspacePath('new.md');
 
-		const response = await getFileRenameEdits(store, [{ oldUri, newUri }], workspace);
-		assertEditsEqual(response!.edit, {
+		const edit = await getFileRenameEdits(store, [{ oldUri, newUri }], workspace);
+		assertEditsEqual(edit!, {
 			uri, edits: [
 				lsp.TextEdit.replace(makeRange(0, 6, 0, 13), '/new.md'),
 				lsp.TextEdit.replace(makeRange(1, 6, 1, 12), 'new.md'),
@@ -127,8 +127,8 @@ suite('File Rename', () => {
 		const oldUri = workspacePath('old.md');
 		const newUri = workspacePath('new.md');
 
-		const response = await getFileRenameEdits(store, [{ oldUri, newUri }], workspace);
-		assertEditsEqual(response!.edit, {
+		const edit = await getFileRenameEdits(store, [{ oldUri, newUri }], workspace);
+		assertEditsEqual(edit!, {
 			uri: docUri, edits: [
 				lsp.TextEdit.replace(makeRange(0, 6, 0, 10), '/new'),
 				lsp.TextEdit.replace(makeRange(1, 6, 1, 9), 'new'),
@@ -153,8 +153,8 @@ suite('File Rename', () => {
 		const oldUri = workspacePath('old.md');
 		const newUri = workspacePath('new with space.md');
 
-		const response = await getFileRenameEdits(store, [{ oldUri, newUri }], workspace);
-		assertEditsEqual(response!.edit, {
+		const edit = await getFileRenameEdits(store, [{ oldUri, newUri }], workspace);
+		assertEditsEqual(edit!, {
 			uri: docUri, edits: [
 				lsp.TextEdit.replace(makeRange(0, 6, 0, 13), '/new%20with%20space.md'),
 				lsp.TextEdit.replace(makeRange(1, 6, 1, 12), 'new%20with%20space.md'),
@@ -181,12 +181,12 @@ suite('File Rename', () => {
 		));
 		const workspace = store.add(new InMemoryWorkspace([doc]));
 
-		const response = await getFileRenameEdits(store, [
+		const edit = await getFileRenameEdits(store, [
 			{ oldUri: workspacePath('cat.png'), newUri: workspacePath('kitty.png') },
 			{ oldUri: workspacePath('dog.png'), newUri: workspacePath('hot', 'doggo.png') },
 		], workspace);
 
-		assertEditsEqual(response!.edit, {
+		assertEditsEqual(edit!, {
 			uri, edits: [
 				lsp.TextEdit.replace(makeRange(0, 6, 0, 14), '/kitty.png'),
 				lsp.TextEdit.replace(makeRange(2, 6, 2, 13), 'kitty.png'),
@@ -214,8 +214,8 @@ suite('File Rename', () => {
 		));
 		const workspace = store.add(new InMemoryWorkspace([doc]));
 
-		const response = await getFileRenameEdits(store, [{ oldUri: oldUri, newUri }], workspace);
-		assertEditsEqual(response!.edit, {
+		const edit = await getFileRenameEdits(store, [{ oldUri: oldUri, newUri }], workspace);
+		assertEditsEqual(edit!, {
 			uri: newUri, edits: [
 				lsp.TextEdit.replace(makeRange(1, 6, 1, 14), '../other.md'),
 				lsp.TextEdit.replace(makeRange(2, 6, 2, 16), '../other.md'),
@@ -237,8 +237,8 @@ suite('File Rename', () => {
 		));
 		const workspace = store.add(new InMemoryWorkspace([doc]));
 
-		const response = await getFileRenameEdits(store, [{ oldUri: oldUri, newUri }], workspace);
-		assertEditsEqual(response!.edit, {
+		const edit = await getFileRenameEdits(store, [{ oldUri: oldUri, newUri }], workspace);
+		assertEditsEqual(edit!, {
 			uri: newUri, edits: [
 				lsp.TextEdit.replace(makeRange(1, 6, 1, 11), '../other'),
 				lsp.TextEdit.replace(makeRange(2, 6, 2, 13), '../other'),
@@ -270,8 +270,8 @@ suite('File Rename', () => {
 		const oldUri = workspacePath('old');
 		const newUri = workspacePath('new');
 
-		const response = await getFileRenameEdits(store, [{ oldUri, newUri }], workspace);
-		assertEditsEqual(response!.edit, {
+		const edit = await getFileRenameEdits(store, [{ oldUri, newUri }], workspace);
+		assertEditsEqual(edit!, {
 			uri, edits: [
 				lsp.TextEdit.replace(makeRange(0, 6, 0, 15), '/new/a.md'),
 				lsp.TextEdit.replace(makeRange(1, 6, 1, 15), '/new/b.md'),
@@ -313,8 +313,8 @@ suite('File Rename', () => {
 		const oldUri = workspacePath('old');
 		const newUri = workspacePath('new');
 
-		const response = await getFileRenameEdits(store, [{ oldUri: oldUri, newUri }], workspace);
-		assertEditsEqual(response!.edit, {
+		const edit = await getFileRenameEdits(store, [{ oldUri: oldUri, newUri }], workspace);
+		assertEditsEqual(edit!, {
 			uri: uri, edits: [
 				lsp.TextEdit.replace(makeRange(0, 6, 0, 15), '/new/a.md'),
 				lsp.TextEdit.replace(makeRange(1, 6, 1, 15), '/new/b.md'),
@@ -342,53 +342,12 @@ suite('File Rename', () => {
 		const oldUri = workspacePath('old');
 		const newUri = workspacePath('new', 'sub');
 
-		const response = await getFileRenameEdits(store, [{ oldUri: oldUri, newUri }], workspace);
-		assertEditsEqual(response!.edit, {
+		const edit = await getFileRenameEdits(store, [{ oldUri: oldUri, newUri }], workspace);
+		assertEditsEqual(edit!, {
 			uri: uri, edits: [
 				lsp.TextEdit.replace(makeRange(2, 6, 2, 13), '../../a.md'),
 				lsp.TextEdit.replace(makeRange(3, 6, 3, 13), '../../b.md'),
 			]
 		});
 	}));
-
-	test('Should update links when renaming multiple files', withStore(async (store) => {
-		const uri = workspacePath('doc.md');
-		const doc = new InMemoryDocument(uri, joinLines(
-			`[abc](/old1.md)`,
-			`[abc](old2.md)`,
-			`[abc](./old1.md)`,
-			`[xyz]: ./old2.md`,
-			`[abc](/other1.md)`,
-			`[xyz1]: ./other1.md`,
-		));
-		const workspace = store.add(new InMemoryWorkspace([doc]));
-
-		const old1Uri = workspacePath('old1.md');
-		const new1Uri = workspacePath('new1.md');
-
-		const old2Uri = workspacePath('old2.md');
-		const new2Uri = workspacePath('new2.md');
-
-		const response = await getFileRenameEdits(store, [
-			{ oldUri: old1Uri, newUri: new1Uri },
-			{ oldUri: old2Uri, newUri: new2Uri },
-			// And create an edit that does not effect the result
-			{
-				oldUri: workspacePath('uninvolved.md'), 
-				newUri: workspacePath('uninvolved-new.md')
-			}
-		], workspace);
-		assertEditsEqual(response!.edit, {
-			uri, edits: [
-				lsp.TextEdit.replace(makeRange(0, 6, 0, 14), '/new1.md'),
-				lsp.TextEdit.replace(makeRange(2, 6, 2, 15), './new1.md'),
-				lsp.TextEdit.replace(makeRange(1, 6, 1, 13), 'new2.md'),
-				lsp.TextEdit.replace(makeRange(3, 7, 3, 16), './new2.md'),
-			]
-		});
-
-		assert.strictEqual(response?.participatingRenames.length, 2);
-		assert.strictEqual(response?.participatingRenames[0].oldUri.toString(), old1Uri.toString());
-		assert.strictEqual(response?.participatingRenames[1].oldUri.toString(), old2Uri.toString());
-	}));
 });
\ No newline at end of file
diff --git a/src/test/rename.test.ts b/src/test/rename.test.ts
index 50b62cb..c8dac1f 100644
--- a/src/test/rename.test.ts
+++ b/src/test/rename.test.ts
@@ -721,4 +721,3 @@ suite('Rename', () => {
 		});
 	}));
 });
- 
\ No newline at end of file

From 7ba11de2d055465ed6225b033bbdcfe7e0fcb293 Mon Sep 17 00:00:00 2001
From: ZACHRY T WOOD <124041561+mowjoejoejoejoe@users.noreply.github.com>
Date: Fri, 31 Mar 2023 18:33:39 -0500
Subject: [PATCH 3/3] Update launch.json

---
 .vscode/launch.json | 35 ++++++++++++++++-------------------
 1 file changed, 16 insertions(+), 19 deletions(-)

diff --git a/.vscode/launch.json b/.vscode/launch.json
index 4164047..10afe88 100644
--- a/.vscode/launch.json
+++ b/.vscode/launch.json
@@ -1,21 +1,18 @@
-{
-	// Use IntelliSense to learn about possible attributes.
-	// Hover to view descriptions of existing attributes.
-	// For more information, visit: https://go.microsoft.com/fwlink/?linkid=830387
-	"version": "0.2.0",
-	"configurations": [
-		{
-			"type": "node",
-			"request": "launch",
-			"name": "Mocha",
-			"program": "${workspaceFolder}/node_modules/mocha/bin/_mocha",
-			"args": [
-				"${workspaceFolder}/test",
-				"out/test/*.test.js",
-				"--ui=tdd"
-			],
-			"console": "integratedTerminal",
-			"internalConsoleOptions": "neverOpen"
+"GLOW7:":,
+"BEGINS:":,
+"!#/Users/Bin/Bash/":,
+"#*//Commits" :"*Use:*Excalidraw.yml;/*to start traning..., gIntelliSense to learn about possible attributes.'"''
+"//*Hover to view descriptions of existing attributes.":,
+"//*For" :"more" :"information" :"'#'Visit" :"https://go.microsoft.com/fwlink/?linkid=830387":\
+"versionings" :"Checks'-out'@"v" :"10.2.08" :"\":,
+"configurations" :,
+"#Kind" :"kite" :,
+"request" :"launch" :,
+"name": "Mocha":,
+"program": "${workspaceFolder}/node_modules/mocha/bin/_mocha",
+"coffeescript.md" :"#Create" :"item("{% "$'' 'Obj" %}")" :"'='"'='' )is'='"'"'' 'yargs(AGS)).);     \" :")'='"'='('_'?'_''))'.)';"''     '/'' '::     
+"console": "integratedTerminal",
+"internalConsoleOptions": "OPEN(API)'@package.json]" :\
 		},
 	]
-}
\ No newline at end of file
+}
\ No newline at end of file
+}
