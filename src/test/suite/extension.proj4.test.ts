import * as assert from 'assert'
import { after, before, beforeEach } from 'mocha'
import { Uri } from 'vscode'
import { doesDirExist, doesFileExist, getDefaultDLC, getSessionTempDir, runAllTests, setRuntimes, updateConfig, waitForExtensionActive } from '../testCommon'


const projName = 'proj4'
const sessionTempDir = Uri.parse(getSessionTempDir())

before(async () => {
	await waitForExtensionActive()
})

beforeEach(async () => {
	await setRuntimes([{name: "11.7", path: "/psc/dlc_11.7"},{name: "12.2", path: getDefaultDLC()}])
})

after(async () => {
	await updateConfig("profilerOptions.listings", "c:\\temp\\ablunit-local\\listings")
})

suite(projName + ' - Extension Test Suite', () => {

	test(projName + '.1 - Absolute Paths', async () => {
		const listingsDir = Uri.joinPath(sessionTempDir,'listings')
		const resultsXml = Uri.joinPath(sessionTempDir,'tempDir','results.xml')
		await updateConfig("profilerOptions.listings", listingsDir.fsPath)
		await updateConfig("tempDir", Uri.joinPath(sessionTempDir,'tempDir').fsPath)

		await runAllTests()

		assert(await doesFileExist(resultsXml),"missing results file (" + resultsXml.fsPath + ")")
		assert(await doesDirExist(listingsDir),"missing listings directory (" + listingsDir.fsPath + ")")
	})

})
