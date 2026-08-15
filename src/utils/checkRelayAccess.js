import chalk from "chalk"

import displayFatalError from "./displayFatalError.js"
import displayWarning from "./displayWarning.js"
import { askConfirmation } from "./tuiPrompts.js"

export default async function ({ relayUrl, spinner, logDebugPerformance, supportedProtocolVersions, chunkSize }) {
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
	if(relayServerInfosJson?.error) {
		displayFatalError(`Relay server threw an error (${chalk.dim(relayServerInfosJson?.data?.error || relayServerInfosJson?.error)}):\n  ${relayServerInfosJson?.data?.message || relayServerInfosJson?.message || JSON.stringify(relayServerInfosJson)}.`, spinner)
	}
	if(!relayServerInfosJson?.data?.message.includes("Fleer Relay API")) displayFatalError(`The relay server at ${chalk.cyan(relayUrl)} doesn't seem to be a Fleer Relay server.`, spinner)
	if(!relayServerInfosJson?.data?.server?.maxChunkBytes) displayFatalError(`The relay server at ${chalk.cyan(relayUrl)} doesn't gave us a maximum amount of bytes allowed per file chunk.\nThis is likely due to a misconfiguration or an unsupported relay server.\nPlease contact the relay server administrator for further assistance.`, spinner)
	if(chunkSize && chunkSize > 1 && relayServerInfosJson?.data?.server?.maxChunkBytes < chunkSize) displayFatalError(`The relay server at ${chalk.cyan(relayUrl)} is not allowing us to send chunks of ${chalk.cyan(chunkSize)} bytes, the maximum allowed is ${chalk.cyan(relayServerInfosJson?.data?.server?.maxChunkBytes)} bytes.\nYou need to use another relay server that allows bigger chunks.`, spinner)

	if(!supportedProtocolVersions.includes(relayServerInfosJson?.data?.server?.protocolVersion)) {
		spinner.stop()
		displayWarning(`The relay server at ${chalk.cyan(relayUrl)} is using an unsupported protocol version (${chalk.cyan(relayServerInfosJson?.data?.server?.protocolVersion)}).\n  The use of this relay could cause issues when sending or receiving files.\n  Supported versions by Fleer CLI are: ${supportedProtocolVersions.map(v => chalk.cyan(v)).join(", ")}.`, spinner)
		const shouldContinueIncompatibleProtocol = await askConfirmation("Do you want to continue anyway?")
		if (!shouldContinueIncompatibleProtocol) return process.exit()
		else spinner.start()
	}

	return true
}