import { TestRun, Uri, workspace } from 'vscode'
import { ABLResults } from './ABLResults'
import { logToChannel } from './ABLUnitCommon'
import { isRelativePath } from './ABLUnitConfigWriter'
import { ExecException, exec } from "child_process"

export const ablunitRun = async (options: TestRun, res: ABLResults) => {
	const start = Date.now()

	await res.cfg.createAblunitJson(res.cfg.ablunitConfig.config_uri, res.cfg.ablunitConfig.options, res.testQueue)

	const getCommand = () => {
		if (res.cfg.ablunitConfig.command.executable != "_progres" &&
			res.cfg.ablunitConfig.command.executable != "prowin" &&
			res.cfg.ablunitConfig.command.executable != "prowin32") {
			return getCustomCommand()
		}
		return getDefaultCommand()
	}

	const getCustomCommand = () => {
		let cmd = res.cfg.ablunitConfig.command.executable.replace("${DLC}", res.dlc!.uri.fsPath.replace(/\\/g, '/'))

		const testarr: string[] = []
		for (const test of res.testQueue) {
			if (test.test) {
				testarr.push(test.test)
			}
		}
		const testlist = testarr.join(',')

		if (cmd.indexOf('${testlist}') === -1) {
			logToChannel("command does not contain ${testlist}", 'error', options)
			throw (new Error("command does not contain ${testlist}"))
		}
		cmd = cmd.replace(/\$\{testlist\}/, testlist)
		cmd = cmd.replace(/\$\{tempDir\}/, workspace.asRelativePath(res.cfg.ablunitConfig.tempDirUri, false))
		const cmdSanitized = cmd.split(' ')

		logToChannel("ABLUnit Command: " + cmdSanitized.join(' '))
		return cmdSanitized
	}

	const getDefaultCommand = () => {
		if (!res.cfg.ablunitConfig.tempDirUri) {
			throw (new Error("temp directory not set"))
		}

		const executable = res.dlc!.uri.fsPath.replace(/\\/g, '/') + '/bin/' + res.cfg.ablunitConfig.command.executable

		let cmd = [ executable, '-b', '-p', res.wrapperUri.fsPath.replace(/\\/g,'/') ]

		if (process.platform === 'win32') {
			cmd.push('-basekey', 'INI', '-ininame', workspace.asRelativePath(res.cfg.ablunitConfig.progressIniUri.fsPath, false))
		} else if (process.platform === 'linux') {
			process.env.PROPATH = res.propath!.toString()
		} else {
			throw new Error("unsupported platform: " + process.platform)
		}

		let tempPath = workspace.asRelativePath(res.cfg.ablunitConfig.tempDirUri, false)
		if (isRelativePath(tempPath)) {
			tempPath = './' + tempPath
		}
		cmd.push('-T',tempPath)

		if (res.cfg.ablunitConfig.dbConnPfUri && res.cfg.ablunitConfig.dbConns && res.cfg.ablunitConfig.dbConns.length > 0) {
			cmd.push('-pf', workspace.asRelativePath(res.cfg.ablunitConfig.dbConnPfUri.fsPath, false))
		}

		if (res.cfg.ablunitConfig.profiler.enabled) {
			cmd.push('-profile', workspace.asRelativePath(res.cfg.ablunitConfig.profOptsUri, false))
		}

		const cmdSanitized: string[] = []
		cmd = cmd.concat(res.cfg.ablunitConfig.command.additionalArgs)

		let params = "CFG=" + workspace.asRelativePath(res.cfg.ablunitConfig.config_uri.fsPath, false)
		if (res.cfg.ablunitConfig.dbAliases.length > 0) {
			params = params + "= ALIASES=" + res.cfg.ablunitConfig.dbAliases.join(';')
		}
		cmd.push("-param", '"' + params + '"')

		cmd.forEach(element => {
			cmdSanitized.push(element.replace(/\\/g, '/'))
		})

		logToChannel("ABLUnit Command: " + cmdSanitized.join(' '))
		return cmdSanitized
	}

	const runCommand = () => {
		const args = getCommand()
		logToChannel("ABLUnit Command Execution Started - dir='" + res.cfg.ablunitConfig.workspaceFolder.uri.fsPath + "'")

		const cmd = args[0]
		args.shift()

		return new Promise<string>((resolve, reject) => {
			res.setStatus("running command")

			const runenv = getEnvVars(res.dlc!.uri)

			exec(cmd + ' ' + args.join(' '), {env: runenv, cwd: res.cfg.ablunitConfig.workspaceFolder.uri.fsPath }, (err: ExecException | null, stdout: string, stderr: string) => {
				const duration = Date.now() - start
				if (stdout) {
					logToChannel("_progres stdout=" + stdout, 'info', options)
				}
				if (stderr) {
					logToChannel("_progres stderr=" + stderr, 'error', options)
				}
				if (err) {
					logToChannel("_progres err=" + err.name + " (ExecExcetion)\r\n   " + err.message, 'error', options)
				}
				if(err || stderr) {
					reject(new Error ("ABLUnit Command Execution Failed - duration: " + duration))
				}
				logToChannel("ABLUnit Command Execution Completed - duration: " + duration)
				resolve("resolve _progres promise")
			})
		})
	}

	return runCommand().then(() => {
		return res.parseOutput(options).then()
	})
}

export const getEnvVars = (dlcUri: Uri | undefined) => {
	const runenv = process.env
	let envConfig: {[key: string]: string} | undefined = undefined
	if (process.platform === 'win32') {
		envConfig = workspace.getConfiguration('terminal').get('integrated.env.windows')
	} else if (process.platform === 'linux') {
		envConfig = workspace.getConfiguration('terminal').get('integrated.env.linux')
	} else if (process.platform === 'darwin') {
		envConfig = workspace.getConfiguration('terminal').get('integrated.env.osx')
	}
	if (envConfig) {
		for (const key of Object.keys(envConfig)) {
			if (key === 'PATH' && process.env.PATH) {
				runenv[key] = envConfig[key].replace("${env:PATH}", process.env.PATH)
			} else {
				runenv[key] = envConfig[key]
			}
		}
	}
	if (dlcUri) {
		runenv['DLC'] = dlcUri.fsPath.replace(/\\/g, '/')
	}
	return runenv
}
