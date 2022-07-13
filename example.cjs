//@ts-check
const md = require('.');
const MarkdownIt = require('markdown-it');
const { URI } = require('vscode-uri');
const { CancellationTokenSource, Emitter, Event } = require('vscode-languageserver');
const { CancellationToken } = require('vscode-languageserver');
const { TextDocument } = require('vscode-languageserver-textdocument');

const mdIt = MarkdownIt({ html: true });

/**
 * @type {md.IMdParser}
 * */
const parser = new class {
	slugifier = md.githubSlugifier

	async tokenize(document) {
		return mdIt.parse(document.getText(), {});
	}
}

// Create the
const myDocument = TextDocument.create('/path/to/file.md', 'markdown', 1, '# Header 1');

/** @type {md.IWorkspace} */
const workspace = new class {
	/**
	 * @returns {readonly URI[]}
	 */
	get workspaceFolders() {
		return [];
	}

	/**
	 * @returns { Promise<Iterable<md.ITextDocument>>}
	 */
	async getAllMarkdownDocuments() {
		return [myDocument];
	}

	hasMarkdownDocument(/** @type {URI} */ resource) {
		return resource.toString() === myDocument.uri;
	}

	/**
	 * @returns {Promise<md.ITextDocument | undefined>}
	 */
	async getOrLoadMarkdownDocument(/** @type {URI} */resource) {
		if (resource.toString() === myDocument.uri) {
			return myDocument;
		}
		return undefined;
	}

	/**
	 * @returns {Promise<md.FileStat | undefined>}
	 */
	async stat(/** @type {URI} */ resource) {
		if (resource.toString() === myDocument.uri) {
			return {};
		}
	}

	/** @type {Emitter<md.ITextDocument>} */
	_onDidChangeMarkdownDocument = new Emitter();
	onDidChangeMarkdownDocument = this._onDidChangeMarkdownDocument.event;

	/** @type {Emitter<md.ITextDocument>} */
	_onDidCreateMarkdownDocument = new Emitter();
	onDidCreateMarkdownDocument = this._onDidCreateMarkdownDocument.event;

	/** @type {Emitter<URI>} */
	_onDidDeleteMarkdownDocument = new Emitter();
	onDidDeleteMarkdownDocument = this._onDidDeleteMarkdownDocument.event;
};

/** @type { md.ILogger} */
const consoleLogger = {
	verbose(title, message, data) {
		console.log(title, message, data);
	}
};

async function main() {
	const languageService = md.createLanguageService({ workspace, parser, logger: consoleLogger });

	const cts = new CancellationTokenSource();
	const symbols = await languageService.provideDocumentSymbols(myDocument, cts.token);

	console.log(symbols)
}

main();