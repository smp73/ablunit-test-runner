import * as vscode from 'vscode';
import { ABLTestSuiteClass, ABLTestClassNamespace, ABLTestClass, ABLTestProgram, ABLTestMethod, ABLTestProcedure, testData, testCoverage } from './testTree';
import { ABLUnitConfig } from './ABLUnitConfig';
import { outputChannel } from './ABLUnitCommon'

const backgroundExecutable = vscode.window.createTextEditorDecorationType({
	backgroundColor: 'rgba(255,0,0,0.1)',
  })
const backgroundExecuted = vscode.window.createTextEditorDecorationType({
	backgroundColor: 'rgba(0,255,0,0.1)',
})

export async function activate(context: vscode.ExtensionContext) {
	const ctrl = vscode.tests.createTestController('ablunitTestController', 'ABLUnit Test')

	console.log("ACTIVATE!")
	outputChannel.appendLine("ACTIVATE!")

	const cfg = new ABLUnitConfig(context.storageUri!)
	await cfg.setTempDirUri()

	vscode.window.onDidChangeActiveTextEditor(editor => {
		if(editor)
			decorate(editor)
	})

	vscode.workspace.onDidOpenTextDocument(event => {
		const openEditors = vscode.window.visibleTextEditors.filter(
			editor => editor.document.uri === event.uri
		)
		openEditors.forEach(editor => {
			decorate(editor)
		})
	})

	vscode.workspace.onDidChangeTextDocument(event => {
		const openEditor = vscode.window.visibleTextEditors.filter(
			editor => editor.document.uri === event.document.uri
		)[0]
		decorate(openEditor)
	})

	const runAllTestsCommand = () => {
		console.log("TODO - run all tests")
		// runTests(cfg)
	}

	function runActiveTestCommand () {
		console.log("TODO - run active test")
		// runTests()
	}

	function debugActiveTestCommand () { //This already exists as 'Test: Debug Tests in Current Files' and 'Test: Debug Test at Cursor'
		console.log("TODO - debug active test")
		// runTests("")
	}

	context.subscriptions.push(ctrl);
	context.subscriptions.push(vscode.commands.registerCommand('ablunit.test.runAll', runAllTestsCommand))
	context.subscriptions.push(vscode.commands.registerCommand('ablunit.test.runActive', runActiveTestCommand))
	// context.subscriptions.push(vscode.commands.registerCommand('ablunit.test.debugActive', debugActiveTestCommand))
	context.subscriptions.push(vscode.commands.registerCommand('_ablunit.openStackTrace', openStackTrace))

	const fileChangedEmitter = new vscode.EventEmitter<vscode.Uri>();
	const runHandler = (request: vscode.TestRunRequest2, cancellation: vscode.CancellationToken) => {
		if (!request.continuous) {
			return startTestRun(request);
		}

		const l = fileChangedEmitter.event(uri => startTestRun(
			new vscode.TestRunRequest2(
				[getOrCreateFile(ctrl, uri).file!],
				undefined,
				request.profile,
				true
			),
		));
		cancellation.onCancellationRequested(() => l.dispose());
	};

	const startTestRun = (request: vscode.TestRunRequest) => {
		if (cfg.notificationsEnabled()) {
			vscode.window.showInformationMessage("running ablunit tests");
		}

		const queue: { test: vscode.TestItem; data: ABLTestClass | ABLTestSuiteClass | ABLTestClassNamespace | ABLTestMethod | ABLTestProgram | ABLTestProcedure }[] = [];
		const run = ctrl.createTestRun(request);
		// map of file uris to statements on each line:
		// const coveredLines = new Map</* file uri */ string, (vscode.StatementCoverage | undefined)[]>();

		const discoverTests = async (tests: Iterable<vscode.TestItem>) => {
			for (const test of tests) {
				if (request.exclude?.includes(test)) {
					continue;
				}

				const data = testData.get(test);

				if(data instanceof ABLTestSuiteClass)
					console.log(" - ABLTestSuite")
				if(data instanceof ABLTestClassNamespace)
					console.log(" - ABLTestClassNamespace")
				if(data instanceof ABLTestClass)
					console.log(" - ABLTestClass")
				if(data instanceof ABLTestMethod)
					console.log(" - ABLTestMethod")
				if(data instanceof ABLTestProgram)
					console.log(" - ABLTestProgram")
				if(data instanceof ABLTestProcedure)
					console.log(" - ABLTestProcedure")

				if (data instanceof ABLTestClass || data instanceof ABLTestProgram || data instanceof ABLTestMethod || data instanceof ABLTestProcedure || data instanceof ABLTestMethod) {
					run.enqueued(test)
					queue.push({ test, data })
				} else {
					await discoverTests(gatherTestItems(test.children));
				}
			}
		};

		const runTestQueue = async () => {
			for (const { test, data } of queue) {
				run.appendOutput(`Running ${test.id}\r\n`);
				if (run.token.isCancellationRequested) {
					run.skipped(test);
				} else {
					run.started(test);
					await data.run(test, run, cfg)
				}
				run.appendOutput(`Completed ${test.id}\r\n`);
			}
			run.end();
			if (vscode.window.activeTextEditor)
				decorate(vscode.window.activeTextEditor)

			if (cfg.notificationsEnabled()) {
				vscode.window.showInformationMessage("ablunit tests complete");
			}
		};

		run.coverageProvider = {
			provideFileCoverage() {
				console.log("coverageProvider.provideFileCoverage!!!!!")
				return [];
			},
		};

		discoverTests(request.include ?? gatherTestItems(ctrl.items)).then(runTestQueue);
	};

	ctrl.refreshHandler = async () => {
		await Promise.all(getWorkspaceTestPatterns().map(({ includePattern, excludePattern }) => findInitialFiles(ctrl, includePattern, excludePattern)));
	};

	ctrl.createRunProfile('Run Tests', vscode.TestRunProfileKind.Run, runHandler, false, new vscode.TestTag("runnable"), false);
	// ctrl.createRunProfile('Debug Tests', vscode.TestRunProfileKind.Debug, runHandler, false, new vscode.TestTag("runnable"), false);
	// ctrl.createRunProfile('Run Tests with Coverage', vscode.TestRunProfileKind.Coverage, runHandler, true, new vscode.TestTag("runnable"), false);

	ctrl.resolveHandler = async item => {
		if (!item) {
			context.subscriptions.push(...startWatchingWorkspace(ctrl, fileChangedEmitter));
			return;
		}
		const data = testData.get(item);
		if (data instanceof ABLTestClass || data instanceof ABLTestProgram) {
			await data.updateFromDisk(ctrl, item);
		}
	};

	function updateNodeForDocument(e: vscode.TextDocument) {
		if (e.uri.scheme !== 'file') { return }
		if (!e.uri.path.endsWith('.cls') && !e.uri.path.endsWith('.p')) { return }

		const { file, data } = getOrCreateFile(ctrl, e.uri);
		if (file) {
			data.updateFromContents(ctrl, e.getText(), file);
		}
	}

	context.subscriptions.push(
		vscode.workspace.onDidOpenTextDocument(updateNodeForDocument),
		vscode.workspace.onDidChangeTextDocument(e => updateNodeForDocument(e.document)),
	);
}

function getOrCreateFile(controller: vscode.TestController, uri: vscode.Uri) {
	const existing = controller.items.get(uri.toString())
	if (existing) {
		const data = testData.get(existing)
		if (data instanceof ABLTestClass) {
			return { file: existing, data: data as ABLTestClass }
		} else {
			return { file: existing, data: data as ABLTestProgram }
		}
	}

	//TODO: this is a hack to prevent the builder from trying to parse the ablunit files
	//TODO: this should use the exclude pattern instead
	if (uri.toString().indexOf("/.builder/") != -1) {
		return { file: undefined, data: undefined }
	}

	const file = controller.createTestItem(uri.toString(), vscode.workspace.asRelativePath(uri.fsPath), uri);
	file.tags = [ new vscode.TestTag("runnable") ]
	controller.items.add(file);
	const data = createTopNode(file);
	testData.set(file, data);
	file.canResolveChildren = true;
	return { file, data };
}

function createTopNode(file: vscode.TestItem) {
	if (file.uri?.toString().endsWith(".cls")) {
		return new ABLTestClass()
	} else if (file.uri?.toString().endsWith(".p")) {
		return new ABLTestProgram()
	}
	throw(new Error("invalid file extension. file='" + file.uri?.toString))
}

function gatherTestItems(collection: vscode.TestItemCollection) {
	const items: vscode.TestItem[] = [];
	collection.forEach(item => items.push(item));
	return items;
}

function getWorkspaceTestPatterns() {
	if (!vscode.workspace.workspaceFolders) { return [] }

	return vscode.workspace.workspaceFolders.map(workspaceFolder => ({
		workspaceFolder,
		includePattern: new vscode.RelativePattern(workspaceFolder, vscode.workspace.getConfiguration("ablunit").get("files.include") ?? ''),
		excludePattern: new vscode.RelativePattern(workspaceFolder, vscode.workspace.getConfiguration("ablunit").get("files.exclude") ?? '')
	}));
}

async function findInitialFiles(controller: vscode.TestController, includePattern: vscode.GlobPattern, excludePattern: vscode.GlobPattern) {
	const findAllFilesAtStartup = vscode.workspace.getConfiguration('ablunit').get('findAllFilesAtStartup');

	if (findAllFilesAtStartup) {
		for (const wsFile of await vscode.workspace.findFiles(includePattern, excludePattern)) {
			const { file, data } = getOrCreateFile(controller, wsFile);
			if(file) {
				await data.updateFromDisk(controller, file);
			}
		}
	}
}

function startWatchingWorkspace(controller: vscode.TestController, fileChangedEmitter: vscode.EventEmitter<vscode.Uri> ) {
	return getWorkspaceTestPatterns().map(({ workspaceFolder, includePattern, excludePattern }) => {
		const watcher = vscode.workspace.createFileSystemWatcher(includePattern);

		watcher.onDidCreate(uri => {
			getOrCreateFile(controller, uri);
			fileChangedEmitter.fire(uri);
		});
		watcher.onDidChange(async uri => {
			const { file, data } = getOrCreateFile(controller, uri);
			if (data?.didResolve) {
				await data.updateFromDisk(controller, file);
			}
			fileChangedEmitter.fire(uri);
		});
		watcher.onDidDelete(uri => controller.items.delete(uri.toString()));

		findInitialFiles(controller, includePattern, excludePattern);

		return watcher;
	});
}

function decorate(editor: vscode.TextEditor) {
	const executedArray: vscode.DecorationOptions[] = []
	const executableArray: vscode.DecorationOptions[] = []
	const tc = testCoverage.get(editor.document.uri.fsPath)
	if (tc) {
		//TODO
		// if (tc[0]) {
			tc.detailedCoverage?.forEach(element => {
				const range = <vscode.Range> element.location;
				const decoration = { range }
				if (element.executionCount > 0) {
					executedArray.push(decoration)
				} else {
					executableArray.push(decoration)
				}
			});
		// }
	}

	editor.setDecorations(backgroundExecuted, executedArray)
	editor.setDecorations(backgroundExecutable, executableArray)
}

function openStackTrace(traceUriStr: string) {
	const traceUri = vscode.Uri.parse(traceUriStr.split("&")[0])
	const traceLine = Number(traceUriStr.split("&")[1])
	vscode.window.showTextDocument(traceUri).then(editor => {
		const lineToGoBegin = new vscode.Position(traceLine,0)
		const lineToGoEnd = new vscode.Position(traceLine + 1,0)
		editor.selections = [new vscode.Selection(lineToGoBegin, lineToGoEnd)];
		const range = new vscode.Range(lineToGoBegin, lineToGoEnd);
		decorate(editor)
		editor.revealRange(range);
	})
}
