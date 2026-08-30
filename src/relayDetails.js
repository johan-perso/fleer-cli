import chalk from "chalk"
import ora from "ora"

import { stripForDisplay } from "./utils/stripText.js"
import displayFatalError from "./utils/displayFatalError.js"
import checkRelayAccess from "./utils/checkRelayAccess.js"
import { logDebugPerformance } from "./utils/debugPerformances.js"
import checkNonTlsConnection from "./utils/checkNonTlsConnection.js"

export default async function () {
	// Get the relay server URL
	var relayServerStr = globalThis.defaultArgs.slice(1).find(arg => arg.startsWith("http://") || arg.startsWith("https://")) || ""
	if (relayServerStr.length == 0) {
		displayFatalError(`No relay server URL provided.\nIt should be provided using ${chalk.cyan("fleer relay <relay_server_url>")}.\nTo display more information about how Fleer works, use ${chalk.cyan("fleer help-download")}.`, null)
	}

	// Check if relay server URL is valid
	if (relayServerStr) {
		try {
			relayServerStr = relayServerStr.toString().trim()
			while(relayServerStr.endsWith("/")) relayServerStr = relayServerStr.slice(0, -1)

			new URL(relayServerStr) // will throw an error if it's invalid
		} catch (error) {
			displayFatalError(`Invalid relay server URL provided ("${chalk.dim(relayServerStr)}").\nTo display more information about how Fleer works, use ${chalk.cyan("fleer help-download")}.`, null)
		}
	}
	const relayUrl = relayServerStr

	// Check if the relay server is reachable
	await checkNonTlsConnection(relayUrl)
	const spinner = ora("Checking relay server...").start()
	globalThis.spinner = spinner
	const relayServerInfosJson = await checkRelayAccess({
		relayUrl: relayUrl,
		spinner,
		logDebugPerformance,
	})
	spinner.stop()

	// Display all JSON details provided by the relay
	console.log(`${chalk.bold(`Relay server ${chalk.italic("(JSON)")}:`)}\n`)
	console.log(`${chalk.dim(JSON.stringify(relayServerInfosJson))}\n`)

	// Display relay server details
	console.log(`\n${chalk.bold("Relay server details:")}\n`)
	console.log(`• ${chalk.bold("Base URL:")} ${chalk.cyan(relayUrl)}`)
	console.log(`• ${chalk.bold("Version:")} ${chalk.cyan(stripForDisplay(relayServerInfosJson?.server?.buildVersion))}${relayServerInfosJson?.server?.buildVersion ? ` (commit ${chalk.cyan.dim(stripForDisplay(relayServerInfosJson?.server?.buildCommitHash?.substring(0, 7)))})` : ""}`)
	console.log(`• ${chalk.bold("Protocol Version:")} ${chalk.cyan(stripForDisplay(relayServerInfosJson?.server?.protocolVersion))}`)
	console.log(`• ${chalk.bold("Untrusted Name:")} ${chalk.cyan(stripForDisplay(relayServerInfosJson?.relay?.name))}`)
	console.log(`• ${chalk.bold("Contact Email:")} ${chalk.cyan(stripForDisplay(relayServerInfosJson?.relay?.contactEmail))}`)
	console.log(`• ${chalk.bold("Associated Links:")}\n${Object.entries(relayServerInfosJson?.relay?.associatedLinks || {}).map(([key, value]) => `  • ${chalk.bold(stripForDisplay(key))}: ${chalk.cyan(stripForDisplay(value))}`).join("\n")}`)

	process.exit(0)
}