import { window } from 'vscode'

const outputChannel = window.createOutputChannel('ABLUnit');

export function logToChannel(message: string, consoleMessageType: string = "log") {
	outputChannel.appendLine(message)
	if (consoleMessageType === "warn") {
		console.warn(message)
	} else if (consoleMessageType === "error") {
		console.error(message)
	} else {
		console.log(message)
		if (consoleMessageType != '' && consoleMessageType != 'log') {
			console.warn("WARNING: consoleMessageType not recognized - '" + consoleMessageType + "'")
		}
	}
}
