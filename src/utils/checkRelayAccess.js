import chalk from "chalk"

import fetchWithTimeout from "./fetchWithTimeout.js"
import displayWarning from "./displayWarning.js"
import { askConfirmation } from "./tuiPrompts.js"

const supportedProtocolVersions = [1]

export default async function ({
	relayUrl,
	spinner,
	logDebugPerformance = () => {},
	chunkSize,
	callbackOnError,
	silentProtocolVersionCheck,
}) {
	logDebugPerformance("relayServerInfos...")
	const relayServerInfos = await fetchWithTimeout(`${relayUrl}`, {}, 5000)
		.catch(error => {
			callbackOnError(`Could not reach the relay server at ${chalk.cyan(relayUrl)}.\n  Error: ${error.message}`, spinner)
		})
	if(!relayServerInfos) return

	var relayServerInfosJson
	try {
		relayServerInfosJson = await relayServerInfos.json()
	} catch (error) {
		const responseStatusCode = relayServerInfos?.status || "unknown"
		callbackOnError(`Could not parse the response from the relay server.\n  HTTP Code: ${responseStatusCode}\n  Error: ${error.message}`, spinner)
		return
	}
	logDebugPerformance("relayServerInfos!")

	if(!relayServerInfosJson) return callbackOnError(`Could not reach the relay server at ${chalk.cyan(relayUrl)}.`, spinner)
	if(relayServerInfosJson?.error) {
		callbackOnError(`Relay server threw an error (${chalk.dim("case 6")}) (${chalk.dim(relayServerInfosJson?.data?.error || relayServerInfosJson?.error)}):\n  ${relayServerInfosJson?.data?.message || relayServerInfosJson?.message || JSON.stringify(relayServerInfosJson)}.`, spinner)
		return
	}
	if(!relayServerInfosJson?.data?.message.includes("Fleer Relay API")) return callbackOnError(`The relay server at ${chalk.cyan(relayUrl)} doesn't seem to be a Fleer Relay server.`, spinner)
	if(!relayServerInfosJson?.data?.server?.maxChunkBytes) return callbackOnError(`The relay server at ${chalk.cyan(relayUrl)} doesn't specify a maximum amount of bytes allowed per file chunk.\nThis is likely due to a misconfiguration or an unsupported relay server.\nPlease contact the relay server administrator for further assistance.`, spinner)
	if(!relayServerInfosJson?.data?.server?.maxCachedBytes) return callbackOnError(`The relay server at ${chalk.cyan(relayUrl)} doesn't specify a maximum amount of bytes allowed per file transfer.\nThis is likely due to a misconfiguration or an unsupported relay server.\nPlease contact the relay server administrator for further assistance.`, spinner)

	// We need to be sure we can send chunks of the size we want, otherwise it would fail to send the file
	if(chunkSize && chunkSize > 1 && relayServerInfosJson?.data?.server?.maxChunkBytes < chunkSize) return callbackOnError(`The relay server at ${chalk.cyan(relayUrl)} is not allowing us to send chunks of ${chalk.cyan(chunkSize)} bytes, the maximum allowed is ${chalk.cyan(relayServerInfosJson?.data?.server?.maxChunkBytes)} bytes.\nYou need to use another relay server that allows bigger chunks.`, spinner)

	// On a typical relay, maxCachedBytes will be shared with 80% for chunks and 20% for messages
	// We need to be sure we can send at least 4*chunkSize bytes, otherwise it would be quite annoying to send a large file.
	const requiredCachedBytes = chunkSize * 4 * 1.2 // 20% because of the split between chunks/messages
	if(relayServerInfosJson?.data?.server?.maxCachedBytes < requiredCachedBytes) return callbackOnError(`The relay server at ${chalk.cyan(relayUrl)} is limiting how much data it can receive for a file transfer.\nThe maximum allowed is ${chalk.cyan(relayServerInfosJson?.data?.server?.maxCachedBytes)} bytes, but we need at least ${chalk.cyan(requiredCachedBytes)} bytes.\nYou need to use another relay server that allows bigger transfers.`, spinner)

	if(!supportedProtocolVersions.includes(relayServerInfosJson?.data?.server?.protocolVersion)) {
		if(silentProtocolVersionCheck) return callbackOnError(`The relay server at ${chalk.cyan(relayUrl)} is using an unsupported protocol version (${chalk.cyan(relayServerInfosJson?.data?.server?.protocolVersion)}).\n  The use of this relay could cause issues when sending or receiving files.\n  Supported versions by Fleer CLI are: ${supportedProtocolVersions.map(v => chalk.cyan(v)).join(", ")}.`, spinner)
		spinner.stop()
		displayWarning(`The relay server at ${chalk.cyan(relayUrl)} is using an unsupported protocol version (${chalk.cyan(relayServerInfosJson?.data?.server?.protocolVersion)}).\n  The use of this relay could cause issues when sending or receiving files.\n  Supported versions by Fleer CLI are: ${supportedProtocolVersions.map(v => chalk.cyan(v)).join(", ")}.`, spinner)
		const shouldContinueIncompatibleProtocol = await askConfirmation("Do you want to continue anyway?")
		if (!shouldContinueIncompatibleProtocol) return process.exit()
		else spinner.start()
	}

	return relayServerInfosJson?.data
}