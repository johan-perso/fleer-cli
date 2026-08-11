import chalk from "chalk"

import displayFatalError from "./displayFatalError.js"
import { askConfirmation } from "./tuiPrompts.js"

export default async function ({ relayUrl, spinner, logDebugPerformance, supportedProtocolVersions }) {
	logDebugPerformance("relayServerInfos...")
	const relayServerInfos = await fetch(`${relayUrl}`)
		.catch(error => {
			displayFatalError(`Could not reach the relay server at ${chalk.cyan(relayUrl)}.\n  Error: ${error.message}`, spinner)
		})

	var relayServerInfosJson
	try {
		relayServerInfosJson = await relayServerInfos.json()
	} catch (error) {
		const responseStatusCode = relayServerInfos?.status || "unknown"
		displayFatalError(`Could not parse the response from the relay server.\n  HTTP Code: ${responseStatusCode}\n  Error: ${error.message}`, spinner)
	}
	logDebugPerformance("relayServerInfos!")

	if(!relayServerInfosJson) displayFatalError(`Could not reach the relay server at ${chalk.cyan(relayUrl)}.`, spinner)
	if(!relayServerInfosJson?.data?.message.includes("Fleer Relay API")) displayFatalError(`The relay server at ${chalk.cyan(relayUrl)} doesn't seem to be a Fleer Relay server.`, spinner)

	if(!supportedProtocolVersions.includes(relayServerInfosJson?.data?.server?.protocolVersion)) {
		spinner.stop()
		displayWarning(`The relay server at ${chalk.cyan(relayUrl)} is using an unsupported protocol version (${chalk.cyan(relayServerInfosJson?.data?.server?.protocolVersion)}).\n  The use of this relay could cause issues when sending or receiving files.\n  Supported versions by Fleer CLI are: ${supportedProtocolVersions.map(v => chalk.cyan(v)).join(", ")}.`)
		const shouldContinueIncompatibleProtocol = await askConfirmation("Do you want to continue anyway?")
		if (!shouldContinueIncompatibleProtocol) return process.exit()
		else spinner.start()
	}

	return true
}