import * as vscode from 'vscode';
import { getContentFromFilesystem, ABLUnitTestData, ABLTestSuiteClass, ABLTestClassNamespace, ABLTestClass, ABLTestProgram, ABLTestMethod, ABLTestProcedure, ABLAssert, testData } from './testTree';

export async function activate(context: vscode.ExtensionContext) {
	const ctrl = vscode.tests.createTestController('ablunitTestController', 'ABLUnit Test');
	context.subscriptions.push(ctrl);
	const extensionUri = context.extensionUri
	const storageUri: vscode.Uri | undefined = context.storageUri

	const fileChangedEmitter = new vscode.EventEmitter<vscode.Uri>();
	const runHandler = (request: vscode.TestRunRequest2, cancellation: vscode.CancellationToken) => {
		if (!request.continuous) {
			return startTestRun(request);
		}

		const l = fileChangedEmitter.event(uri => startTestRun(
			new vscode.TestRunRequest2(
				[getOrCreateFile(ctrl, uri)?.file!],
				undefined,
				request.profile,
				true
			),
		));
		cancellation.onCancellationRequested(() => l.dispose());
	};

	const startTestRun = (request: vscode.TestRunRequest) => {
		const queue: { test: vscode.TestItem; data: ABLTestClass | ABLTestSuiteClass | ABLTestClassNamespace | ABLTestMethod | ABLTestProgram | ABLTestProcedure }[] = [];
		const run = ctrl.createTestRun(request);
		// map of file uris to statements on each line:
		const coveredLines = new Map</* file uri */ string, (vscode.StatementCoverage | undefined)[]>();

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

				if (data instanceof ABLTestClassNamespace || data instanceof ABLTestClass || data instanceof ABLTestProgram || data instanceof ABLTestMethod) {
					run.enqueued(test);
					queue.push({ test, data });
				} else {
					await discoverTests(gatherTestItems(test.children));
				}

				if (test.uri && !coveredLines.has(test.uri.toString())) {
					try {
						const lines = (await getContentFromFilesystem(test.uri)).split('\n');
						coveredLines.set(
							test.uri.toString(),
							lines.map((lineText, lineNo) =>
								lineText.trim().length ? new vscode.StatementCoverage(0, new vscode.Position(lineNo, 0)) : undefined
							)
						);
					} catch {
						// ignored
					}
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
					data.setStorageUri(extensionUri, storageUri)
					await data.run(test, run);
				}

				run.appendOutput(`Completed ${test.id}\r\n`);
			}
			run.end();
		};

		run.coverageProvider = {
			provideFileCoverage() {
				const coverage: vscode.FileCoverage[] = [];
				for (const [uri, statements] of coveredLines) {
					coverage.push(
						vscode.FileCoverage.fromDetails(
							vscode.Uri.parse(uri),
							statements.filter((s): s is vscode.StatementCoverage => !!s)
						)
					);
				}

				return coverage;
			},
		};

		discoverTests(request.include ?? gatherTestItems(ctrl.items)).then(runTestQueue);
	};

	ctrl.refreshHandler = async () => {
		await Promise.all(getWorkspaceTestPatterns().map(({ includePattern, excludePattern }) => findInitialFiles(ctrl, includePattern, excludePattern)));
	};

	ctrl.createRunProfile('Run Tests', vscode.TestRunProfileKind.Run, runHandler, true, new vscode.TestTag("runnable"), false);

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
		if (e.uri.scheme !== 'file') {
			return;
		}

		if (!e.uri.path.endsWith('.cls') && !e.uri.path.endsWith('.p')) {
			return;
		}
		const { file, data } = getOrCreateFile(ctrl, e.uri);
		if(file) {
			data.updateFromContents(ctrl, e.getText(), file);
		}
	}

	context.subscriptions.push(
		vscode.workspace.onDidOpenTextDocument(updateNodeForDocument),
		vscode.workspace.onDidChangeTextDocument(e => updateNodeForDocument(e.document)),
	);
}

function getOrCreateFile(controller: vscode.TestController, uri: vscode.Uri) {
	const existing = controller.items.get(uri.toString());
	if (existing) {
		const data = testData.get(existing)
		if (data instanceof ABLTestClass) {
			return { file: existing, data: data as ABLTestClass };
		} else {
			return { file: existing, data: data as ABLTestProgram}
		}
	}

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
	console.error("invalid extenstion. file='" + file.uri?.toString)
	return new ABLTestProgram()
}

function gatherTestItems(collection: vscode.TestItemCollection) {
	const items: vscode.TestItem[] = [];
	collection.forEach(item => items.push(item));
	return items;
}

function getWorkspaceTestPatterns() {
	if (!vscode.workspace.workspaceFolders) {
		return [];
	}

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
			if (data && data.didResolve) {
				await data.updateFromDisk(controller, file);
			}
			fileChangedEmitter.fire(uri);
		});
		watcher.onDidDelete(uri => controller.items.delete(uri.toString()));

		findInitialFiles(controller, includePattern, excludePattern);

		return watcher;
	});
}
