import { Uri, workspace, WorkspaceFolder } from 'vscode'
import { logToChannel } from '../ABLUnitCommon'
import { getOpenEdgeProfileConfig, IBuildPathEntry } from './openedgeConfigFile'
require("jsonminify")


interface IRuntime {
	name: string,
	path: string,
	default?: boolean
}

export interface IDlc {
	uri: Uri,
	version?: string
}

export interface IProjectJson {
	propathEntry: IBuildPathEntry[]
}

const dlcMap = new Map<WorkspaceFolder, IDlc>()

async function getProjectJson (workspaceFolder: WorkspaceFolder) {
	const data = await workspace.fs.readFile(Uri.joinPath(workspaceFolder.uri,"openedge-project.json")).then((raw) => {
		return JSON.minify(Buffer.from(raw.buffer).toString())
	}, (err) => {
		logToChannel("Failed to read openedge-project.json: " + err,'error')
		return undefined
	})
	if (data) {
		if (!JSON.parse(data)) {
			logToChannel("Failed to parse openedge-project.json", 'error')
			return undefined
		}
		return data
	}
	return undefined
}

export async function getDLC (workspaceFolder: WorkspaceFolder, projectJson?: string) {
	const dlc = dlcMap.get(workspaceFolder)
	if (dlc) {
		return dlc
	}

	let runtimeDlc: Uri | undefined = undefined
	const oeversion = await getOEVersion(workspaceFolder, projectJson)
	const runtimes: IRuntime[] = workspace.getConfiguration("abl.configuration").get("runtimes",[])

	for (const runtime of runtimes) {
		if (runtime.name === oeversion) {
			runtimeDlc = Uri.file(runtime.path)
			break
		}
		if (runtime.default) {
			runtimeDlc = Uri.file(runtime.path)
		}
	}
	if (!runtimeDlc && process.env.DLC) {
		runtimeDlc = Uri.file(process.env.DLC)
	}
	if (runtimeDlc) {
		logToChannel("using DLC = " + runtimeDlc.fsPath)
		const dlcObj: IDlc = { uri: runtimeDlc }
		dlcMap.set(workspaceFolder, dlcObj)
		return dlcObj
	}
	throw new Error("unable to determine DLC")
}

export async function getOEVersion (workspaceFolder: WorkspaceFolder, projectJson?: string) {
	const profileJson = getOpenEdgeProfileConfig(workspaceFolder.uri)
	if (!profileJson) {
		logToChannel("[getOEVersion] profileJson not found", 'debug')
		return undefined
	}

	if (profileJson.oeversion) {
		logToChannel("[getOEVersion] profileJson.value.oeversion = " + profileJson.oeversion, 'debug')
		return profileJson.oeversion
	}

	if (!projectJson) {
		projectJson = await getProjectJson(workspaceFolder)
		if (!projectJson) {
			return undefined
		}
	}
	if(projectJson) {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
		const tmpVer: string = JSON.parse(projectJson).oeversion
		if(tmpVer) {
			return tmpVer
		}
	}
	return undefined
}
