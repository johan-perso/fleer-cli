import chalk from "chalk"
import ora from "ora"
import { filesize } from "filesize"
import path from "node:path"
import { homedir } from "node:os"
import { mkdir, exists } from "node:fs/promises"

import { stripForDisplay } from "./utils/stripText.js"
import getAbsoluteLowest from "./utils/absoluteLowest.js"
import reduceString from "./utils/reduceString.js"
import doubleCheckPaths from "./utils/doubleCheckPaths.js"
import encryption from "./utils/encryption.js"
import getDeviceName from "./utils/getDeviceName.js"
import { askConfirmation, askAlreadyExistingFile, askCustomText } from "./utils/tuiPrompts.js"
import streamWithProgress from "./utils/streamWithProgress.js"
import displayFatalError from "./utils/displayFatalError.js"
import displayWarning from "./utils/displayWarning.js"
import checkRelayAccess from "./utils/checkRelayAccess.js"
import SocketQueue from "./utils/socketQueue.js"
import { logDebugPerformance, saveDebugPerformances, appendSocketDebugEvent } from "./utils/debugPerformances.js"
import checkNonTlsConnection from "./utils/checkNonTlsConnection.js"
import sanitizePath from "./utils/sanitizePath.js"
import removeLinesFromConsole from "./utils/removeLinesFromConsole.js"
import breakLines from "./utils/breakLines.js"

const supportedProtocolVersions = [1]

const intlFormatter = new Intl.NumberFormat()

export default async function () {
	async function askManualDetails() {
		const relayUrl = await askCustomText("Please provide relay server URL", { footer: "e.g. https://server.fleer.app" })
		if(!relayUrl || !relayUrl?.trim()?.length) return displayFatalError("No relay server URL provided. Please provide a valid relay server URL to continue.")
		if(!relayUrl.startsWith("http://") && !relayUrl.startsWith("https://")) return displayFatalError("Invalid relay server URL provided. Please provide a valid relay server URL starting with https:// to continue.")

		const shareKey = await askCustomText("Please provide Share Key", { footer: "Approx. 9 letters, given by the sender" })
		if(!shareKey || !shareKey?.trim()?.length) return displayFatalError("No Share Key provided. Please provide a valid one to continue.")

		const encryptionKey = await askCustomText("Please provide Encryption Key", { footer: "Approx. 18 characters, starting with a number followed by a dot, given by the sender" })
		if(!encryptionKey || !encryptionKey?.trim()?.length) return displayFatalError("No Encryption Key provided. Please provide a valid one to continue.")

		return { relayUrl, shareKey, encryptionKey }
	}

	var relayUrl, shareKey, encryptionKey = null

	// Get the download URL
	const downloadUrlStr = globalThis.defaultArgs.slice(1)
	if (downloadUrlStr.length === 0) {
		process.stderr.write(`${chalk.red("✖")} ${breakLines(process.stdout.columns - 2, "  ", `No download URL provided.\nCancel using ${chalk.cyan("Ctrl+C")} and use ${chalk.cyan("fleer download <download_url>")} or fill out the following prompts.\nTo display more information about how Fleer works, use ${chalk.cyan("fleer help-download")}.\n\n`, { skipPrefixFirstLine: true })}\n`)
		const manualDetails = await askManualDetails()
		relayUrl = manualDetails.relayUrl
		shareKey = manualDetails.shareKey
		encryptionKey = manualDetails.encryptionKey
	}

	// Automatically parse the download URL
	if (downloadUrlStr && (!relayUrl || !shareKey || !encryptionKey)) {
		try {
			const downloadUrl = new URL(downloadUrlStr)
			relayUrl = downloadUrl?.origin
			shareKey = downloadUrl?.pathname?.split("/d/")?.[1]
			encryptionKey = downloadUrl?.hash?.split("#")?.[1]
		} catch (error) {
			displayFatalError(`Invalid download URL provided ("${chalk.dim(downloadUrlStr)}").\nTo display more information about how Fleer works, use ${chalk.cyan("fleer help-download")}.`, null)
		}
	}

	// Guess the encryption protocol indicator from the first sequence of the encryption key (before the first dot)
	const encryptionProtocolIndicator = encryptionKey?.split(".")?.[0]
	if(!encryptionProtocolIndicator) return displayFatalError("Could not determine any encryption protocol indicator from the encryption key. Please provide a valid encryption key to continue.")
	if(isNaN(parseInt(encryptionProtocolIndicator))) return displayFatalError("Could not determine a valid encryption protocol indicator from the encryption key. Please provide a valid encryption key to continue.")
	encryptionKey = encryptionKey?.split(".")?.slice(1)?.join(".")

	if (!encryption.ENCRYPTION_PROTOCOLS?.[encryptionProtocolIndicator]) {
		return displayFatalError(`The encryption protocol used by the sender (${chalk.cyan(encryptionProtocolIndicator)}) is not supported by this client.\nSupported protocols: ${Object.keys(encryption.ENCRYPTION_PROTOCOLS).map(p => chalk.cyan(p)).join(", ")}.`)
	}

	// Check if all required parameters are present
	if (!relayUrl) return displayFatalError("Relay server URL missing. Please provide a valid relay server URL to continue.")
	if (!shareKey) return displayFatalError("Share Key missing. Please provide a valid one to continue.")
	if (!encryptionKey) return displayFatalError("Encryption Key missing. Please provide a valid one to continue.")

	await checkNonTlsConnection(relayUrl)

	// Check if the relay server is reachable
	const spinner = ora("Checking relay server...").start()
	globalThis.spinner = spinner
	while(relayUrl.endsWith("/")) relayUrl = relayUrl.slice(0, -1)
	await checkRelayAccess({
		relayUrl: relayUrl,
		spinner,
		logDebugPerformance,
		supportedProtocolVersions
	})

	// Get transfer details from the relay server
	spinner.start("Retrieving transfer details...")
	logDebugPerformance("shareDetails...")
	const shareDetails = await fetch(`${relayUrl}/shares/read`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			"shareId": shareKey
		}),
	}).catch(error => {
		displayFatalError(`Could not reach the relay server at ${chalk.cyan(stripForDisplay(relayUrl))}.\nError: ${error.message}`, spinner)
	})

	var shareDetailsJson
	try {
		shareDetailsJson = await shareDetails.json()
	} catch (error) {
		const responseStatusCode = shareDetails?.status || "unknown"
		displayFatalError(`Could not parse the response from the relay server.\nHTTP Code: ${responseStatusCode}\nError: ${error.message}`, spinner)
	}
	logDebugPerformance("shareDetails!")
	if(shareDetailsJson?.error) {
		const statusCode = shareDetails?.status
		if(statusCode == 404) {
			displayFatalError(`No transfer associated to this Share Key was found on the relay server.\nShare Key: ${chalk.cyan(shareKey)}\nRelay URL: ${chalk.cyan(relayUrl)}`, spinner)
		} else {
			displayFatalError(`Relay server threw an error (${chalk.dim(stripForDisplay(shareCreationJson?.data?.error || shareCreationJson?.error))}):\n${stripForDisplay(shareDetailsJson?.data?.message || shareDetailsJson?.message || JSON.stringify(shareDetailsJson))}`, spinner)
		}
	}
	lastChunkId = shareDetailsJson?.data?.lastChunkId || null
	spinner.succeed(`Found transfer. ${chalk.dim(`(${intlFormatter.format(shareDetailsJson?.data?.filesCount || 0)} file${shareDetailsJson?.data?.filesCount > 1 ? "s" : ""} for ${filesize(shareDetailsJson?.data?.totalSize || 0)})`)}`)

	spinner.start("Testing encryption key...")
	const primaryDetailsEncrypted = shareDetailsJson?.data?.primaryDetails
	if (!primaryDetailsEncrypted) {
		displayFatalError("Could not find the primary details in the transfer data. The transfer might be incomplete or corrupted.", spinner)
		return
	}

	// Decrypt primary details to access more details about the transfer
	var cipher, primaryDetails = null
	try {
		logDebugPerformance("Creating a cipher instance...")
		cipher = await encryption.ShareCipher.fromShortKey({ shareId: shareKey, protocolIndicator: encryptionProtocolIndicator, shortKey: encryptionKey })
		logDebugPerformance("Decrypting primary details...")
		primaryDetails = await cipher.decryptJson(primaryDetailsEncrypted, "primary")
		logDebugPerformance("Decrypted primary details successfully.")
	} catch (error) {
		const isInvalidKeyError = error?.message?.includes("Invalid key") || error?.message?.includes("The operation failed for an operation-specific reason")
		displayFatalError(`Could not decrypt the primary details with the provided encryption key.${isInvalidKeyError ? "\nThis might happen if the encryption key is incorrect." : ""}\n  Error: ${error?.message || error?.stack}`, spinner)
	}
	if (!primaryDetails || typeof primaryDetails !== "object") {
		displayFatalError("Decrypted primary details successfully, but didn't find valid data.\nThe encryption key might be incorrect, or the sender might have sent corrupted data.", spinner)
	}
	var senderDeviceName = primaryDetails?.deviceName?.trim() || "Sender's device"
	senderDeviceName = senderDeviceName.length > 1 && senderDeviceName.length < 65 ? stripForDisplay(senderDeviceName) : "Sender's device"
	spinner.succeed("Encryption key is valid.")

	const structure = primaryDetails?.structure || []
	const ignoredFilesPath = []
	const needRenamingFilesPath = []
	const canOverwriteFilesPath = []
	var ignoreAllExistingFiles = false
	var overwriteAllExistingFiles = false
	const renamedFilesPath = {}

	// Initialize a few (many 💀) variables for the files downloading process
	var filesCount = shareDetailsJson?.data?.filesCount || 0
	var foldersCount = shareDetailsJson?.data?.foldersCount || 0
	var totalSizeBytes = shareDetailsJson?.data?.totalSize || 0
	var lastReceivedChunkIndex = -1

	const saveDirectory = "./"
	if (!await exists(saveDirectory)) await mkdir(saveDirectory, { recursive: true })

	let writingChunks = {}
	const fileChunksCorrelationTable = []

	var lastEventType = null
	var lastEventCount = 0

	var lastChunkId = null
	var isDownloadingProcessEnded = false
	var startDownloadingTime = null
	var endedDownloadTime = null
	var isSenderDisconnected = false

	var receivedBytesFromRelay = 0
	var isProcessingChunk = false
	var shouldIgnoreChunks = false
	var mbps = null
	var mbpsEmoji = "📈"

	var currentFileBeingIgnored = false
	var currentFileDisplayName = null
	var currentFilePosition = 1
	var currentFileSize = 0
	var currentFileDownloadingBytes = 0

	var lastSocketWarning = null
	function _updateFilesDownloadingSpinner() {
		const downloadingStatus = isDownloadingProcessEnded
			? ""
			: mbpsEmoji.length && mbps != null
				? `(${mbpsEmoji} ${chalk.dim.cyan(mbps.toFixed(2))} MB/s)`
				: "(Starting...)"

		const ignoredFilesCount = ignoredFilesPath.length
		const totalFilesReceived = (currentFilePosition || 1) - ignoredFilesCount

		var newText = isDownloadingProcessEnded
			? `Received ${chalk.cyan(intlFormatter.format(totalFilesReceived))} file${totalFilesReceived > 1 ? "s" : ""} and ${chalk.cyan(intlFormatter.format(foldersCount))} folder${foldersCount > 1 ? "s" : ""}.${ignoredFilesCount > 0 ? `\n  Ignored ${ignoredFilesCount} file${ignoredFilesCount > 1 ? "s" : ""}.` : ""}`
			: `Receiving file ${chalk.cyan(intlFormatter.format(currentFilePosition || 1))} / ${chalk.cyan(intlFormatter.format(filesCount))} ${chalk.dim(downloadingStatus)}`
		if (currentFileDisplayName && !currentFileBeingIgnored && !isDownloadingProcessEnded) {
			var percentage = currentFileSize > 0 ? Math.floor((currentFileDownloadingBytes / currentFileSize) * 100) : 0
			if (percentage > 100) percentage = 100
			newText += `\n${chalk.cyan("◌")} ${percentage > 0 && percentage <= 9 ? "0" : ""}${percentage} %   ${chalk.dim(reduceString.maxLines(currentFileDisplayName, 1, 2 + 5 + 3))}`
		} else if (currentFileDisplayName && currentFileBeingIgnored && !isDownloadingProcessEnded) {
			newText += `\n${chalk.cyan("◌")} Skipping ${chalk.dim(reduceString.maxLines(currentFileDisplayName, 1, 2 + "Skipping ".length))}`
		}

		if(isDownloadingProcessEnded) {
			const totalTime = Math.round((endedDownloadTime - startDownloadingTime) / 1000)
			newText += `\n  Took ${chalk.cyan(totalTime > 300 ? `${Math.floor(totalTime / 60)} min ${totalTime % 60} sec` : `${totalTime} sec`)} for ${chalk.cyan(filesize(receivedBytesFromRelay))}.`

			const homeDir = homedir()
			const relativeSaveDirectory = path.relative(process.cwd(), saveDirectory)
			const relativeToHome = path.relative(homeDir, saveDirectory)

			const displayedSaveDirectory = !relativeToHome.startsWith("..")
				? path.join("~", relativeToHome)
				: relativeSaveDirectory.startsWith("..")
					? path.resolve(saveDirectory)
					: path.join(path.basename(process.cwd()), relativeSaveDirectory)

			newText += `\n  File${filesCount > 1 ? "s" : ""} saved to ${chalk.cyan(stripForDisplay(displayedSaveDirectory))}`
		} else {
			var totalPercentage = totalSizeBytes > 0 ? Math.floor((receivedBytesFromRelay / totalSizeBytes) * 100) : 0
			if (totalPercentage > 99.9) totalPercentage = 100

			newText += `\n\n${chalk.dim(`received ${chalk.cyan(filesize(receivedBytesFromRelay))} / ${chalk.cyan(filesize(totalSizeBytes))} (${totalPercentage}%) from ${chalk.cyan(senderDeviceName)}`)}`
			newText += `\n${chalk.dim(`use ${chalk.cyan("Ctrl+C")} to cancel download`)}`
		}

		if (lastSocketWarning) newText += `\n${chalk.yellow("⚠")} ${chalk.dim(reduceString.maxLines(lastSocketWarning, 3, 5))}`
		if (isSenderDisconnected) newText += `\n${chalk.yellow("⚠")} ${chalk.dim(reduceString.maxLines("Sender seems to be disconnected.", 1, 5))}`

		if (spinner.text !== newText) spinner.text = newText
		return newText
	}

	// Calculate the average Mb/s over the last few chunks sent
	let lastMbpsCheck = performance.now()
	let lastReceivedBytes = 0
	const mbpsHistory = []
	const MBPS_HISTORY_SIZE = 8
	function _calculateMbps() {
		if (lastReceivedBytes === receivedBytesFromRelay) return // no new bytes received since last check
		if (performance.now() - lastMbpsCheck < 100) return // avoid calculating if we already did it less than 100ms ago

		if (receivedBytesFromRelay < lastReceivedBytes) {
			// This should not happen, but just in case, we reset the values
			lastMbpsCheck = performance.now()
			lastReceivedBytes = receivedBytesFromRelay
			return
		}
		if (receivedBytesFromRelay === 0) {
			mbps = 0
			mbpsEmoji = "📈"
			return
		}

		const now = performance.now()
		const elapsedSeconds = (now - lastMbpsCheck) / 1000
		const sentBytes = receivedBytesFromRelay - lastReceivedBytes
		const newMbps = (sentBytes / 1_000_000) / elapsedSeconds // in MB/s

		mbpsHistory.push(newMbps)
		if (mbpsHistory.length > MBPS_HISTORY_SIZE) {
			mbpsHistory.shift()
		}
		const averageMbps = mbpsHistory.reduce((sum, value) => sum + value, 0) / mbpsHistory.length

		mbpsEmoji = averageMbps < mbps ? "📉" : "📈"
		mbps = averageMbps

		lastMbpsCheck = now
		lastReceivedBytes = receivedBytesFromRelay
	}

	// Method to handle incoming JSON WebSocket messages
	async function handleJsonSocketMessage(message) {
		// Avoid spamming the console if server keep sending the same msg
		if (lastEventType === message?.type && !["precedentsChunksUpdate", "msgFromSender", "senderStatus"].includes(message?.type)) {
			lastEventCount++
			if (lastEventCount > 30) {
				lastSocketWarning = `Received ${lastEventCount} consecutive messages of type: ${stripForDisplay(message?.type)}. Slowing down the processing...`
				await new Promise(resolve => setTimeout(resolve, (lastEventCount * 25) > 10_000 ? 10_000 : lastEventCount * 25)) // wait a bit to avoid spamming the console
			}
		} else {
			lastEventCount = 1
			lastEventType = message?.type
		}

		switch (message?.type) {
		case "welcome":
			spinner.text = `Establishing real-time connection to the relay server... ${chalk.dim("(Connected)")}`
			break
		case "error": // connection is not closed, act as a warning
			lastSocketWarning = stripForDisplay(`${message?.data?.error || message?.error} - ${message?.data?.message || message?.message || JSON.stringify(message)}`)
			_updateFilesDownloadingSpinner()
			break
		case "fatal": // connection is closed afterwards
			displayFatalError(`Relay server threw an error (${chalk.dim(stripForDisplay(message?.data?.error || message?.error))}):\n${stripForDisplay(message?.data?.message || message?.message || JSON.stringify(message))}.`, spinner)
			break
		case "connectedToShare":
			if(!isConnectedToShareDisplayedOnce) spinner.succeed("Real-time connection established.")
			isConnectedToShareDisplayedOnce = true

			isSenderDisconnected = !(message?.data?.isSenderConnected || false)

			if (structure.length > 0) {
				spinner.start("Checking files structure...")
				for (const file of structure) {
					const savePath = sanitizePath(saveDirectory, file.path)

					// Create directories if they don't exist
					if (!await exists(path.dirname(savePath))) await mkdir(path.dirname(savePath), { recursive: true })

					// Ask user what they want to do for existing files
					if (!ignoreAllExistingFiles && !overwriteAllExistingFiles && await exists(savePath)) {
						await askActionForExistingFile(savePath, file.path)
					}
				}
				spinner.stop()
			}

			const confirmStartDownload = await askConfirmation("Do you want to start downloading the files now?")
			if(!confirmStartDownload) {
				spinner.fail("Download cancelled by user.")
				process.exit()
			}
			removeLinesFromConsole(1)

			startDownloadingTime = Date.now()
			console.log() // line break
			spinner.start(_updateFilesDownloadingSpinner())

			logDebugPerformance("Asking server to send us the first chunks...")
			socket.send(JSON.stringify({ type: "GetPrecedentsChunks", data: { fromChunkId: 0, untilChunkId: 3 } })) // max 3 chunks at a time
			break
		case "precedentsChunksUpdate":
			if (message.data.remaining > 0) {
				socket.send(JSON.stringify({ type: "GetPrecedentsChunks", data: { fromChunkId: lastReceivedChunkIndex + 1, untilChunkId: lastReceivedChunkIndex + 4 } })) // still asking for max 3 chunks at a time
			} else {
				// The server will automatically send us new chunks as they are sent to the server, as soon as we acknowledge what we just got here
				if (lastChunkId != null && lastReceivedChunkIndex >= lastChunkId) finishDownload()
			}
			break
		case "msgFromSender":
			const unencryptedMessage = await cipher.decryptJson(message.data)

			if(unencryptedMessage?.dataType == "FileChunks") registerChunkForFile(unencryptedMessage)
			else if(unencryptedMessage?.dataType == "TransferFinished" && isDownloadingProcessEnded) {
				if (globalThis.debugPerformances === true) await saveDebugPerformances()
				process.exit()
			}
			break
		case "lastChunkIndicated":
			lastChunkId = message?.data?.lastChunkId
			if (lastReceivedChunkIndex >= lastChunkId) finishDownload()
			break
		case "senderStatus":
			isSenderDisconnected = !(message?.data?.connected || false)
			if (spinner.isSpinning) _updateFilesDownloadingSpinner()
			break
		case "restartTransfer":
			if (shouldIgnoreChunks) return logDebugPerformance("Ignoring restartTransfer message because shouldIgnoreChunks is set to true.")

			acknowledgeQueue.length = 0
			socketQueue.queue.length = 0

			// If we are currently saving a chunk file, we need to wait for it to finish to avoid corruption
			if(isProcessingChunk) while (isProcessingChunk) {
				await new Promise(resolve => setTimeout(resolve, 500))
			}

			currentFilePosition = 1
			lastReceivedChunkIndex = -1
			receivedBytesFromRelay = 0
			startDownloadingTime = null
			endedDownloadTime = null
			lastChunkId = null

			currentFileDownloadingBytes = 0
			currentFileBeingIgnored = false
			currentFileDisplayName = null
			currentFilePosition = 1
			currentFileSize = 0

			mbps = 0
			mbpsEmoji = "📈"
			lastReceivedBytes = 0
			mbpsHistory.length = 0

			writingChunks = {}
			fileChunksCorrelationTable.length = 0

			lastSocketWarning = `Transfer was interrupted and needs to be restarted (${chalk.dim(stripForDisplay(message?.data?.message || "unknown reason"))}).`
			_updateFilesDownloadingSpinner()
		}
	}

	// Method to handle incoming WebSocket messages (binary or JSON)
	async function handleSocketEvent(event) {
		await appendSocketDebugEvent(`(Receiver) 🫷 Received message from relay: ${JSON.stringify(event.data)}`)

		// Handle JSON encoded messages
		if (typeof event.data === "string") {
			const message = JSON.parse(event.data)
			await handleJsonSocketMessage(message)
			return
		}

		// Handle binary data (such as chunks)
		if (shouldIgnoreChunks) return logDebugPerformance("Ignoring received chunk because shouldIgnoreChunks is set to true.")
		isProcessingChunk = true
		logDebugPerformance("Received a binary chunk from relay server, analyzing it...")
		const view = new DataView(event.data)
		const frameType = view.getUint8(0) // 1st byte indicates the frame type (0 = file chunk)
		if (frameType !== 0) {
			return displayFatalError(`Relay server sent an unknown binary frame via WebSocket.\nThis is likely due to a misconfiguration or an unsupported relay server, and the transfer cannot continue on this client.\nPlease contact the relay server administrator for further assistance.\n${chalk.dim(`frameType: ${chalk.cyan(frameType)} ; receivedBytesFromRelay: ${chalk.cyan(receivedBytesFromRelay)} ; totalSizeBytes: ${chalk.cyan(totalSizeBytes)}`)}`, spinner)
		}

		const index = view.getUint32(1, false) // 2nd to 5th bytes indicate the chunk index (big-endian)
		lastReceivedChunkIndex = index
		if(index > 1) _calculateMbps()
		const payload = new Uint8Array(event.data, 5) // The rest is the chunk payload

		// Decrypt, and save this chunk to the correct file
		logDebugPerformance(`Decrypting chunk ${index} (size before decryption: ${payload.length} bytes)`)
		if(startDownloadingTime == null) startDownloadingTime = Date.now()
		const plain = await cipher.decryptChunk(payload, index)
		logDebugPerformance(`Decrypted chunk ${index} (size after decryption: ${plain.length} bytes)`)

		const fileForChunk = getFileForChunk(index)
		if (!fileForChunk) {
			return displayFatalError(`Could not find any file associated to chunk ${chalk.cyan(`#${index}`)}.\nThis is likely due to a problem with the sender client that didn't told us about this chunk, or the relay server that didn't forwarded the correct information.`, spinner)
		} if (ignoredFilesPath.includes(fileForChunk.path)) {
			logDebugPerformance(`Ignoring chunk ${index} because its associated file "${fileForChunk.path}" is in the ignored files list.`)
			currentFileDisplayName = stripForDisplay(path.basename(fileForChunk.path))
			currentFileBeingIgnored = true
			_updateFilesDownloadingSpinner()
		} else {
			var savePath = null
			try {
				savePath = renamedFilesPath[fileForChunk.path] || sanitizePath(saveDirectory, fileForChunk.path)
			} catch (error) {
				return displayFatalError(`Could not determine a valid save path for chunk ${chalk.cyan(`#${index}`)}.\nThis is likely due to a problem with the sender client that didn't sent us valid informations about this chunk.\nError: ${error?.message || error?.stack}`, spinner)
			}
			if (!savePath) {
				return displayFatalError(`Could not determine a valid save path for chunk ${chalk.cyan(`#${index}`)}.\nThis is likely due to a problem with the sender client that didn't told us about this chunk, or the relay server that didn't forwarded the correct information.`, spinner)
			}

			try {
				logDebugPerformance(`Saving chunk ${index}...`)
				if(!writingChunks[fileForChunk.path]) {
					currentFileDownloadingBytes = 0

					// Check what to do if the file already exists
					if (await exists(savePath)) {
						const actionForExistingFile = await decideActionForExistingFile(savePath, fileForChunk)
						if (!actionForExistingFile?.continue) return
						savePath = renamedFilesPath[fileForChunk.path] || actionForExistingFile?.savePath || savePath
					}

					// Create directories if needed, and create a file stream writer for this file
					if (!await exists(path.dirname(savePath))) await mkdir(path.dirname(savePath), { recursive: true })
					writingChunks[fileForChunk.path] = await Bun.file(savePath, { create: true }).writer({ highWaterMark: 100 * 1024 * 1024 })
				}

				currentFileSize = fileForChunk.size
				currentFileDisplayName = stripForDisplay(path.basename(savePath))
				currentFileBeingIgnored = false
				_updateFilesDownloadingSpinner()

				await writingChunks[fileForChunk.path].write(plain)
				logDebugPerformance(`Saved chunk ${index}`)

				receivedBytesFromRelay += plain.length
				currentFileDownloadingBytes += plain.length
				_updateFilesDownloadingSpinner()
			} catch (error) {
				return displayFatalError(`Could not write chunk ${chalk.cyan(`#${index}`)} to "${chalk.cyan(savePath)}".\nThis is likely due to a problem with the local file system or permissions.\nError: ${error?.message || error?.stack}`, spinner)
			}

			_calculateMbps()
		}

		// If we finished processing the last file, end its associated file stream writer to free up memory
		if (Object.keys(writingChunks).length >= 2) for (const name in writingChunks) {
			if (name == fileForChunk.path) continue

			logDebugPerformance(`Ending file stream for ${name} to free up memory...`)
			await writingChunks[name].end()
			logDebugPerformance(`Ended file stream for ${name}`)
			delete writingChunks[name]
		}

		if (lastChunkId != null && lastChunkId != 0 && lastReceivedChunkIndex >= lastChunkId) finishDownload()

		acknowledgeChunks(index)
		logDebugPerformance(`Finished processing chunk ${index} (${socketQueue.queue.length} messages in queue)`)
		isProcessingChunk = false
	}

	// Sender is sending FileChunks encrypted messages to tell us which chunk belongs to which file, so we can write the decrypted chunk to the correct file
	function registerChunkForFile(socketMessage) {
		const existing = fileChunksCorrelationTable.find(r => r.from === socketMessage.from)
		if (existing) return // already registered
		fileChunksCorrelationTable.push({ from: socketMessage.from, name: path.basename(socketMessage.path), size: socketMessage.size, path: socketMessage.path })
		fileChunksCorrelationTable.sort((a, b) => a.from - b.from) // keep the list sorted by 'from' index

		// The sender is free to send us more files than what was initially told to us
		if (fileChunksCorrelationTable.length > filesCount) {
			filesCount = fileChunksCorrelationTable.length
			_updateFilesDownloadingSpinner()
		}
	}
	function getFileForChunk(index) {
		let match = null
		for (const r of fileChunksCorrelationTable) {
			if (r.from <= index) match = r
			else break // list is ordered, so we can stop searching once we find a range that starts after the index
		}
		return match // null if no match found, or the last matching range if found
	}

	async function decideActionForExistingFile(savePath, fileForChunk) {
		if (needRenamingFilesPath.includes(fileForChunk.path)) {
			savePath = await incrementFilePath(savePath)
			renamedFilesPath[fileForChunk.path] = savePath
			return { continue: true, savePath }
		} else if ((ignoreAllExistingFiles && !canOverwriteFilesPath.includes(fileForChunk.path)) || ignoredFilesPath.includes(fileForChunk.path)) {
			logDebugPerformance(`Ignoring existing file "${savePath}" as per user choice.`)
			if(!ignoredFilesPath.includes(fileForChunk.path)) ignoredFilesPath.push(fileForChunk.path)
			return { continue: false, savePath }
		} else if (overwriteAllExistingFiles || canOverwriteFilesPath.includes(fileForChunk.path)) {
			logDebugPerformance(`Deleting existing file "${savePath}" as per user choice.`)
			await Bun.file(savePath).delete()
			logDebugPerformance(`Deleted existing file "${savePath}" to overwrite it with the new one.`)
			return { continue: true, savePath }
		} else {
			await askActionForExistingFile(savePath, fileForChunk.path)
			return decideActionForExistingFile(savePath, fileForChunk)
		}
	}

	async function askActionForExistingFile(savePath, filePath) {
		spinner.stop()
		const userChoice = await askAlreadyExistingFile(savePath)
		removeLinesFromConsole(2)
		spinner.start()

		switch (userChoice) {
		case "ignore":
			ignoredFilesPath.push(filePath)
			break
		case "rename":
			needRenamingFilesPath.push(filePath)
			break
		case "replace":
			canOverwriteFilesPath.push(filePath)
			break
		case "ignoreAll":
			ignoreAllExistingFiles = true
			break
		case "replaceAll":
			overwriteAllExistingFiles = true
			break
		}
	}

	async function incrementFilePath(savePath) {
		const { dir, name, ext } = path.parse(savePath)
		let newName = `${name} (1)${ext}`
		let counter = 1
		while (await exists(path.join(dir, newName))) {
			counter++
			newName = `${name} (${counter})${ext}`
		}
		savePath = path.join(dir, newName)
		return savePath
	}

	// Function that need to be called when the download is ended (all chunks received and written to disk)
	async function finishDownload() {
		// If we are currently saving a chunk file, we need to wait for it to finish to avoid corruption,
		// even if that's clearly not supposed to happen
		if(isProcessingChunk) while (isProcessingChunk) {
			await new Promise(resolve => setTimeout(resolve, 500))
		}

		shouldIgnoreChunks = true // prevent any new chunk from being processed

		endedDownloadTime = Date.now()
		isDownloadingProcessEnded = true
		spinner.succeed(_updateFilesDownloadingSpinner())

		// TODO: take structure (in primaryDetails) and create folders if needed to have the same exact structure

		socket.send(JSON.stringify({
			type: "SendMsgToOtherWay",
			data: await cipher.encryptJson({
				highPriority: false,
				dataType: "DownloadFinished",
			})
		}))

		// While we wait for the sender to acknowledge (by sending "TransferFinished" message), we can free up memory by ending all file stream writers
		for (const name in writingChunks) {
			logDebugPerformance(`Ending file stream for ${name} to free up memory...`)
			await writingChunks[name].end()
			logDebugPerformance(`Ended file stream for ${name}`)
			delete writingChunks[name]
		}
	}

	// Connect to the relay server via WebSocket
	var isConnectedToShareDisplayedOnce = false
	const socketQueue = new SocketQueue({ handleEvent: handleSocketEvent })

	spinner.start("Establishing real-time connection to the relay server...")
	const socket = new WebSocket(`${relayUrl.replace("http", "ws")}/shares/updates`)
	socket.binaryType = "arraybuffer" // handle binary data as ArrayBuffer
	socket.send = ((originalSend) => {
		return function (data) {
			appendSocketDebugEvent(`(Receiver) 🫸 Sending message to relay: ${JSON.stringify(data)}`)
			originalSend.call(this, data)
		}
	})(socket.send)
	socket.onopen = () => {
		socket.send(JSON.stringify({ type: "ConnectToShare", data: { shareId: shareKey, isSender: false, deviceName: getDeviceName() } }))
	}
	socket.onmessage = (event) => {
		socketQueue.enqueue(event)
	}
	socket.onerror = (error) => {
		lastSocketWarning = `${error?.message || `Unknown WebSocket error${error?.code ? ` (${error.code})` : ""}`}`
		_updateFilesDownloadingSpinner()
	}
	socket.onclose = (event) => {
		if(!isDownloadingProcessEnded) {
			const reason = event?.reason
			lastSocketWarning = `Real-time connection to the relay server was closed ${reason ? `(${reason})` : "due to an unknown reason"}.`
			spinner.fail(_updateFilesDownloadingSpinner())
			process.exit(1)
			// TODO: try to resume, it may be due to a temporary network issue
		}
	}

	// Methods to acknowledge received chunks to the relay server, this allows the relay server to send us more chunks
	var acknowledgeQueue = []
	var acknowledgeTimeout = null
	var lastAcknowledgeTime = 0
	function acknowledgeChunks(chunkId) {
		acknowledgeQueue.push(chunkId)

		// If the last acknowledge was sent less than 300ms ago, we can afford to wait a bit before sending the next one.
		// Without this, we could end up having a large queue that keep growing and never get sent.
		if(acknowledgeTimeout && Date.now() - lastAcknowledgeTime < 300) {
			clearTimeout(acknowledgeTimeout)
		}

		acknowledgeTimeout = setTimeout(() => {
			const chunksToAcknowledge = [...acknowledgeQueue]
			acknowledgeQueue = []
			if (chunksToAcknowledge.length === 0) return

			socket.send(JSON.stringify({ type: "AcknowledgeChunks", data: { chunkIds: chunksToAcknowledge } }))
			lastAcknowledgeTime = Date.now()
		}, 100) // Acknowledge every 100ms
	}
}