import chalk from "chalk"
import ora from "ora"
import boxen from "boxen"
import { filesize } from "filesize"
import path from "node:path"
import { lstat, readdir } from "node:fs/promises"
import { stripVTControlCharacters as stripAnsi } from "node:util"

import getAbsoluteLowest from "./utils/absoluteLowest.js"
import reduceString from "./utils/reduceString.js"
import doubleCheckPaths from "./utils/doubleCheckPaths.js"
import encryption from "./utils/encryption.js"
import getDeviceName from "./utils/getDeviceName.js"
import { askConfirmation, askIgnoreFile } from "./utils/tuiPrompts.js"
import streamWithProgress from "./utils/streamWithProgress.js"
import displayFatalError from "./utils/displayFatalError.js"
import displayWarning from "./utils/displayWarning.js"
import checkRelayAccess from "./utils/checkRelayAccess.js"
import { logDebugPerformance, saveDebugPerformances, appendSocketDebugEvent } from "./utils/debugPerformances.js"
import checkNonTlsConnection from "./utils/checkNonTlsConnection.js"

var relayServerUrl = "http://192.168.1.174:8080/"
const CHUNK_SIZE = 5 * 1024 * 1024 // 5 MiB
const supportedProtocolVersions = [1]
const maxErrorsCount = 20

const intlFormatter = new Intl.NumberFormat()

const ignoredPaths = []
var autoIgnoreDoubleCheckPaths = false
var disableAskingDoubleCheckPaths = false

var skippedSymlinksCount = 0
var allowedBytesByRelay = 0

export default async function () {
	// Get files prompted in the command line arguments
	var filesPath = globalThis.defaultArgs.slice(1)
	if (filesPath.length === 0) {
		process.stderr.write(`${chalk.red("✖")} No files provided. Please specify at least one file to send.\n`)
		process.exit(1)
	}
	filesPath = [...new Set(filesPath.map(filePath => path.resolve(filePath)))] // Remove duplicates and resolve paths

	let errorsCount = 0
	function displayError(message) {
		process.stderr.write(`${chalk.red("✖")} ${message}\n`)
		errorsCount++
		if(errorsCount >= maxErrorsCount) {
			spinner.clear()
			process.stderr.write(chalk.red(`Encountered ${errorsCount}/${maxErrorsCount} errors. Stopping the process.\n`))
			process.exit(1)
		}
	}

	let warnings = []
	function displaySpinnerWarning(message) {
		warnings.push(message)

		var maxWarningsCount = process.stdout.rows - (process.stdout.rows > 14 ? 10 : 4)
		if(maxWarningsCount < 2) maxWarningsCount = 2
		if(warnings.length > maxWarningsCount) warnings = warnings.slice(-maxWarningsCount)

		if(spinner.isSpinning) {
			_updateFilesFoundSpinner()
		} else {
			console.log(`${chalk.yellow("⚠")} ${message}`)
		}
	}

	const structure = []
	let totalSizeBytes = 0
	let filesCount = 0
	let foldersCount = 0

	const spinner = ora("Checking files...").start()
	globalThis.spinner = spinner
	let lastVirtualPathForSpinner = null
	function _updateFilesFoundSpinner(virtualPath, forceDisplayTotalSize = false) {
		if(virtualPath != null && virtualPath !== "disabled") lastVirtualPathForSpinner = virtualPath
		const hideLastChecked = virtualPath === "disabled" || lastVirtualPathForSpinner == null

		var newText = `Found ${intlFormatter.format(filesCount)} file${filesCount > 1 ? "s" : ""} and ${intlFormatter.format(foldersCount)} folder${foldersCount > 1 ? "s" : ""}.`
		const formattedTotalSize = filesize(totalSizeBytes)

		if (forceDisplayTotalSize || totalSizeBytes > 10_000_000) newText += chalk.dim(` (${forceDisplayTotalSize ? "Total: " : ""}${forceDisplayTotalSize ? chalk.dim.cyan(formattedTotalSize) : formattedTotalSize})`)
		if (!hideLastChecked) newText += `\n  ${chalk.dim(reduceString.maxLines(`Last checked: ${virtualPath || lastVirtualPathForSpinner}`, 1, 2))}`
		if (warnings.length) newText += `\n${warnings.map(msg => `${chalk.yellow("⚠")} ${chalk.dim(reduceString.maxLines(msg, 1, 2))}`).join("\n")}`

		if (spinner.text !== newText) spinner.text = newText
	}

	const absoluteLowestPath = await getAbsoluteLowest(filesPath)
	if(!absoluteLowestPath) {
		displayError("No files were found. If you are trying to send a folder, please make sure it is not empty.")
		process.exit(1)
	}

	// Goes through all the files and folders to add them to a structure list
	for (const filePath of filesPath) {
		var stats = null
		try {
			logDebugPerformance(`${filePath}: checking file stats`)
			stats = await lstat(filePath) // lstat instead of stat to avoid following symlinks
			logDebugPerformance(`${filePath}: checked file stats`)

			// Avoid sending unsupported file types
			var thingsToTest = [
				"isSocket",
				"isBlockDevice",
				"isCharacterDevice",
				"isFIFO"
			]
			var cancelDueToUnsupportedType = false
			thingsToTest.forEach(test => {
				if (stats[test]()) {
					displayError(`"${filePath}" is a ${test.replace("is", "").toLowerCase()}, which is not supported.`)
					cancelDueToUnsupportedType = true
				}
			})
			if(cancelDueToUnsupportedType) continue

			// Avoid sending symlinks
			if (stats.isSymbolicLink()) {
				skippedSymlinksCount++
				displaySpinnerWarning(`"${filePath}" is a symbolic link, which is not supported. Skipping it. (${skippedSymlinksCount} skipped so far)`)
				continue
			}

			// Check for ignored paths if disableAskingDoubleCheckPaths != true
			logDebugPerformance(`${filePath}: checking doubleCheckPaths`)
			if(!disableAskingDoubleCheckPaths) {
				const isDoubleCheckPath = doubleCheckPaths.some(doubleCheckPath => path.basename(filePath).toLowerCase() === doubleCheckPath.toLowerCase())
				if (isDoubleCheckPath) { // found a folder that is commonly ignored
					// Ask user if they want to ignore this folder or not
					var confirmation
					if(!autoIgnoreDoubleCheckPaths) {
						spinner.stop()

						confirmation = await askIgnoreFile(filePath, stats.isDirectory())
						if(confirmation === "ignoreAll") autoIgnoreDoubleCheckPaths = true
						if(confirmation === "sendAll") disableAskingDoubleCheckPaths = true

						// Delete the two last line of console
						process.stdout.moveCursor(0, -1)
						process.stdout.clearLine(1)
						process.stdout.moveCursor(0, -1)
						process.stdout.clearLine(1)
						spinner.start()
					} else { // auto ignore all double check paths
						confirmation = "ignoreAll"
					}

					// User wants to ignore this item, so we remove it
					if (autoIgnoreDoubleCheckPaths || confirmation == "ignore" || confirmation == "ignoreAll") {
						ignoredPaths.push(filePath)
						continue
					}
				}
			}
			logDebugPerformance(`${filePath}: checked doubleCheckPaths`)

			if (stats.isDirectory()) {
				logDebugPerformance(`${filePath}: checking directory contents`)
				// Read files in the directory and add them to the list of files to send
				const filesInDirectory = await readdir(filePath)
				for (const fileInDirectory of filesInDirectory) {
					const fullPath = path.join(filePath, fileInDirectory)
					if (ignoredPaths.some(ignoredPath => fullPath.startsWith(ignoredPath))) continue // Ignore files that are in ignored paths
					filesPath.push(fullPath)
				}

				var virtualPath = path.relative(absoluteLowestPath, filePath)
				if(virtualPath) { // we don't want to add the root folder to the structure
					structure.push({
						name: path.basename(path.resolve(filePath)),
						physicalPath: path.resolve(filePath),
						virtualPath,
						type: "directory",
					})
					foldersCount++
				}
				logDebugPerformance(`${filePath}: checked directory contents`)

				if (foldersCount % 100 === 0) _updateFilesFoundSpinner(virtualPath)
			}
		} catch (error) {
			displayError(error?.code == "ENOENT"
				? `"${filePath}" does not exist or is not accessible.`
				: error?.code == "EACCES"
					? `"${filePath}" is not accessible due to permission issues.`
					: `"${filePath}" could not be accessed. Error: ${error.message}`)
			continue
		}

		if (stats.isFile()) {
			var virtualPath = path.relative(absoluteLowestPath, filePath)
			structure.push({
				name: path.basename(path.resolve(filePath)),
				physicalPath: path.resolve(filePath),
				virtualPath,
				size: stats.size,
				type: "file",
			})

			filesCount++
			totalSizeBytes += stats.size
			if (filesCount % 100 === 0) _updateFilesFoundSpinner(virtualPath)
		}
	}

	// We can display the final count of files/folders found
	warnings = [] // should not rely on warnings.length bc they are cleared if they are too many
	_updateFilesFoundSpinner("disabled", true)
	if(!filesCount) {
		spinner.fail(spinner.text)
	} else {
		spinner.succeed(spinner.text)
	}

	if(skippedSymlinksCount >= 1) console.log(`${chalk.yellow("⚠")} ${skippedSymlinksCount} symlink${skippedSymlinksCount > 1 ? "s" : ""} skipped.`)
	errorsCount = 0
	skippedSymlinksCount = 0

	if(!filesCount) process.exit(1)

	await checkNonTlsConnection(relayServerUrl)

	// Get infos about the relay server
	logDebugPerformance("---------------")
	spinner.start("Creating the transfer...")
	while(relayServerUrl.endsWith("/")) relayServerUrl = relayServerUrl.slice(0, -1)
	await checkRelayAccess({ relayUrl: relayServerUrl, spinner, logDebugPerformance, supportedProtocolVersions })

	// Create a transfer to the server
	logDebugPerformance("shareCreation...")
	const shareCreation = await fetch(`${relayServerUrl}/shares/create`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			filesCount: filesCount,
			foldersCount: foldersCount,
			totalSize: totalSizeBytes
		}),
	}).catch(error => {
		displayFatalError(`Could not reach the relay server at ${chalk.cyan(stripAnsi(relayServerUrl))}.\n  Error: ${error.message}`, spinner)
	})
	var shareCreationJson
	try {
		shareCreationJson = await shareCreation.json()
	} catch (error) {
		const responseStatusCode = shareCreation?.status || "unknown"
		displayFatalError(`Could not parse the response from the relay server.\n  HTTP Code: ${responseStatusCode}\n  Error: ${error.message}`, spinner)
	}
	if(shareCreationJson?.error) {
		displayFatalError(`Relay server threw an error (${chalk.dim(stripAnsi(shareCreationJson?.data?.error || shareCreationJson?.error))}):\n  ${stripAnsi(shareCreationJson?.data?.message || shareCreationJson?.message || JSON.stringify(shareCreationJson))}.`, spinner)
	}
	logDebugPerformance("shareCreation!")
	const shareId = shareCreationJson?.data?.shareId
	spinner.succeed(`Transfer created successfully. ${chalk.dim(`(Share ID: ${chalk.cyan(stripAnsi(shareId))})`)}`)

	// Create, encrypt and send the primary details to the server
	spinner.start("Sending transfer details...")
	logDebugPerformance("Creating primaryDetails...")
	const primaryDetails = {
		"structure": structure.map(item => ({
			name: item.name,
			virtualPath: item.virtualPath,
			size: item.size,
			type: item.type
		})),
		// "localIp": "0.0.0.0" || null,
		// "localPort": "80" || null,
		"deviceName": getDeviceName()
	}
	const files = structure
		.filter(item => item.type === "file")
		.map(item => ({
			...item,
			instance: null
		}))
	logDebugPerformance("Created primaryDetails!")

	const cipher = await encryption.ShareCipher.create({ shareId, protocolIndicator: encryption.USED_PROTOCOL_INDICATOR })

	logDebugPerformance("Encrypting primaryDetails...")
	const encryptedPrimaryDetails = await cipher.encryptJson(primaryDetails, "primary")
	logDebugPerformance("Encrypted primaryDetails!")

	logDebugPerformance("Sending primaryDetails...")
	const sendPrimaryDetails = await fetch(`${relayServerUrl}/shares/chunks?shareId=${shareId}&isThisPrimaryDetails=true`, {
		method: "PUT",
		headers: {
			"Content-Type": "application/octet-stream",
		},
		body: encryptedPrimaryDetails
	}).catch(error => {
		displayFatalError(`Could not send primary details to the relay server.\n  Error: ${error.message}`, spinner)
	})
	var sendPrimaryDetailsJson
	try {
		sendPrimaryDetailsJson = await sendPrimaryDetails.json()
	} catch (error) {
		const responseStatusCode = sendPrimaryDetails?.status || "unknown"
		displayFatalError(`Could not parse the response from the relay server while sending the primary details.\n  HTTP Code: ${responseStatusCode}\n  Error: ${error.message}`, spinner)
	}
	if(sendPrimaryDetailsJson?.error) {
		displayFatalError(`Relay server threw an error (${chalk.dim(stripAnsi(sendPrimaryDetailsJson?.data?.error || sendPrimaryDetailsJson?.error))}):\n  ${stripAnsi(sendPrimaryDetailsJson?.data?.message || sendPrimaryDetailsJson?.message || JSON.stringify(sendPrimaryDetailsJson))}.`, spinner)
	}
	logDebugPerformance("Sent primaryDetails!")

	const errorSuffix = "\n  This is likely due to a misconfiguration or an unsupported relay server.\n  Please contact the relay server administrator for further assistance."
	if(sendPrimaryDetailsJson?.data?.chunkId !== null) displayFatalError(`The relay server returned an unexpected chunk ID while sending the primary details.${errorSuffix}`, spinner)
	if(sendPrimaryDetailsJson?.data?.bytes < 1) displayFatalError(`The relay server returned an unexpected number of bytes received while sending the primary details.${errorSuffix}`, spinner)
	if(sendPrimaryDetailsJson?.data?.allowedBytesMax < 1) displayFatalError(`The relay server returned an unexpected number of bytes allowed while sending the primary details.${errorSuffix}`, spinner)
	allowedBytesByRelay = sendPrimaryDetailsJson?.data?.allowedBytesMax || 0
	spinner.succeed(`Transfer details sent successfully. ${chalk.dim("(🔐")} ${chalk.dim.cyan(`${encryption.USED_PROTOCOL_INDICATOR}.${cipher.shortKey}`)}${chalk.dim(")")}`)

	// Initialize a few (many 💀) variables for the files sending process
	var currentSendingProcessId = null
	var isWaitingForRelayToAllowSending = false
	var isSendingProcessInterrupted = false
	var isSendingProcessEnded = false
	var startSendingTime = null

	var sentBytesToRelay = 0
	var mbps = 0
	var mbpsEmoji = "📈"

	var currentFileDisplayName = null
	var currentFilePosition = 1
	var currentFileSize = 0
	var currentFileSentBytes = 0
	var currentChunkSentBytes = 0

	var lastSocketWarning = null
	var spinnerFailed = false
	function _updateFilesSendingSpinner() {
		const sendingStatus = isSendingProcessEnded || isSendingProcessInterrupted
			? ""
			: isWaitingForRelayToAllowSending
				? "(Sending too fast, waiting for receiver to catch up...)"
				: currentSendingProcessId
					? `(${mbpsEmoji} ${chalk.dim.cyan(mbps.toFixed(2))} MB/s)`
					: "(Starting...)"

		var newText = isSendingProcessEnded
			? `Sent ${chalk.cyan(intlFormatter.format(currentFilePosition || filesCount || 1))} file${currentFilePosition > 1 ? "s" : ""} and ${chalk.cyan(intlFormatter.format(foldersCount))} folder${foldersCount > 1 ? "s" : ""}.`
			: `Sending file ${chalk.cyan(intlFormatter.format(currentFilePosition || 1))} / ${chalk.cyan(intlFormatter.format(filesCount))} ${chalk.dim(sendingStatus)}`
		if (currentFileDisplayName && !isSendingProcessEnded) {
			var percentage = currentFileSize > 0 ? Math.floor((currentFileSentBytes / currentFileSize) * 100) : 0
			if (percentage > 100) percentage = 100
			newText += `\n${chalk.cyan("◉")} ${percentage > 0 && percentage <= 9 ? "0" : ""}${percentage} %   ${chalk.dim(reduceString.maxLines(currentFileDisplayName, 1, 2 + 5 + 3))}`
		}
		if(isSendingProcessEnded && !spinnerFailed) {
			const totalTime = Math.round((Date.now() - startSendingTime) / 1000)
			newText += `\n  Took ${chalk.cyan(totalTime > 300 ? `${Math.floor(totalTime / 60)} min ${totalTime % 60} sec` : `${totalTime} sec`)} for ${chalk.cyan(filesize(sentBytesToRelay))}.`
			newText += `\n  ${chalk.dim("Waiting for receiver to finish downloading...")}`
		} else if(isSendingProcessInterrupted && !spinnerFailed) {
			newText += `\n  ${chalk.dim("Transfer was interrupted. Waiting for the receiver to reconnect...")}`
		} else if(!spinnerFailed) {
			newText += `\n\n${chalk.dim(`sent ${chalk.cyan(filesize(sentBytesToRelay))} / ${chalk.cyan(filesize(totalSizeBytes))} (${Math.floor((sentBytesToRelay / totalSizeBytes) * 100)}%)`)}`
			newText += `\n${chalk.dim(`use ${chalk.cyan("Ctrl+C")} to cancel transfer`)}`
		}

		if (lastSocketWarning) newText += `\n${chalk.yellow("⚠")} ${chalk.dim(reduceString.maxLines(lastSocketWarning, 1, 2))}`

		if (spinner.text !== newText) spinner.text = newText
		return newText
	}

	// Connect to the relay server via WebSocket
	var isConnectedToShareDisplayedOnce = false
	spinner.start("Establishing real-time connection to the relay server...")
	const socket = new WebSocket(`${relayServerUrl.replace("http", "ws")}/shares/updates`)
	socket.send = ((originalSend) => {
		return function (data) {
			appendSocketDebugEvent(`(Sender) 🫸 Sending message to relay: ${JSON.stringify(data)}`)
			originalSend.call(this, data)
		}
	})(socket.send)
	socket.onopen = () => {
		socket.send(JSON.stringify({ type: "ConnectToShare", data: { shareId, isSender: true } }))
	}
	socket.onmessage = async (event) => { // TODO: integrate queue system here
		const message = JSON.parse(event.data)
		appendSocketDebugEvent(`(Sender) 🫷 Received message from relay: ${JSON.stringify(event.data)}`)

		switch (message?.type) {
		case "welcome":
			spinner.text = `Establishing real-time connection to the relay server... ${chalk.dim("(Connected)")}`
			break
		case "error": // connection is not closed, act as a warning
			lastSocketWarning = stripAnsi(`${message?.data?.error || message?.error} - ${message?.data?.message || message?.message || JSON.stringify(message)}`)
			_updateFilesSendingSpinner()
			break
		case "fatal": // connection is closed afterwards
			displayFatalError(`Relay server threw an error (${chalk.dim(stripAnsi(message?.data?.error || message?.error))}):\n  ${stripAnsi(message?.data?.message || message?.message || JSON.stringify(message))}.`, spinner)
			break
		case "connectedToShare":
			if(!isConnectedToShareDisplayedOnce) spinner.succeed("Real-time connection established. Ready to send files.")
			isConnectedToShareDisplayedOnce = true

			const shareLink = `${relayServerUrl}/d/${shareId}#${encryption.USED_PROTOCOL_INDICATOR}.${cipher.shortKey}`
			const shouldJumpLine = shareLink.length > 80 || (`fleer d ${shareLink}`).length > (process.stdout.columns / 1.5)

			console.log() // line break
			console.log(boxen(
				`Start downloading files from any Fleer-compatible app using one of${process.stdout.columns >= 80 ? "\n" : " "}the following methods (use ${chalk.dim("fleer help-download")} for more details).\n\n • ${chalk.bold("Share Link")}${shouldJumpLine ? "\n   " : "      "}${chalk.cyan(stripAnsi(shareLink))}\n • ${chalk.bold("Via Fleer CLI")}${shouldJumpLine ? "\n   " : "   "}${chalk.cyan(`fleer d ${stripAnsi(shareLink)}`)}\n\n • ${chalk.bold("Using Keys")}      Share Key: ${chalk.cyan(stripAnsi(shareId))}   Encryption: ${chalk.cyan(`${stripAnsi(encryption.USED_PROTOCOL_INDICATOR.toString())}.${stripAnsi(cipher.shortKey)}`)}\n ${chalk.dim("(for experts)")}     Relay Server: ${chalk.cyan(stripAnsi(relayServerUrl))}`,
				{ padding: 1, borderStyle: "round", borderColor: "cyan" }
			))
			console.log() // line break

			spinner.start(_updateFilesSendingSpinner())

			if(!currentSendingProcessId) sendFiles()
			break
		case "allowedBytesMaxUpdate":
			// The relay server is limiting the amount of bytes it can keep in cache,
			// so this event is fired when the received download a chunk, allowing the relay to accept more bytes from us
			allowedBytesByRelay = message?.data?.allowedBytesMax
			break
		case "restartTransfer":
			// As seen in the comment of allowedBytesMaxUpdate handler, the relay keep chunks in cache for a limited time.
			// If the receiver ask for chunks that got deleted from the relay cache, transfer will have to be restarted from the beginning.
			spinnerFailed = false
			currentSendingProcessId = null
			allowedBytesByRelay = null
			isWaitingForRelayToAllowSending = false

			sentBytesToRelay = 0
			startSendingTime = null

			currentFileSentBytes = 0
			currentChunkSentBytes = 0
			currentFileDisplayName = null
			currentFilePosition = 1
			currentFileSize = 0

			mbps = 0
			mbpsEmoji = "📈"
			lastUploadedBytes = 0
			mbpsHistory.length = 0

			lastSocketWarning = "Transfer was interrupted and needs to be restarted."
			_updateFilesSendingSpinner()

			if(!isSendingProcessEnded) while (!isSendingProcessInterrupted) {
				await new Promise(resolve => setTimeout(resolve, 500))
			}
			isSendingProcessEnded = true
			lastSocketWarning = "Transfer was interrupted and had to be restarted."
			_updateFilesSendingSpinner()

			sendFiles()
			break
		}
	}
	socket.onerror = (error) => {
		lastSocketWarning = `${error?.message || `Unknown WebSocket error${error?.code ? ` (${error.code})` : ""}`}`
		_updateFilesSendingSpinner()
	}
	socket.onclose = () => {
		lastSocketWarning = "Real-time connection to the relay server was closed due to an unknown reason."
		spinnerFailed = true
		spinner.fail(_updateFilesSendingSpinner())
		process.exit(1)
		// TODO: try to resume, it may be due to a temporary network issue
	}

	// Calculate the average Mb/s over the last few chunks sent
	let lastMbpsCheck = performance.now()
	let lastUploadedBytes = 0
	const mbpsHistory = []
	const MBPS_HISTORY_SIZE = 8
	function _calculateMbps() {
		if (lastUploadedBytes === sentBytesToRelay) return // no new bytes sent since last check
		if (performance.now() - lastMbpsCheck < 100) return // avoid calculating if we already did it less than 100ms ago

		if (sentBytesToRelay < lastUploadedBytes) {
			// This should not happen, but just in case, we reset the values
			lastMbpsCheck = performance.now()
			lastUploadedBytes = sentBytesToRelay
			return
		}
		if (sentBytesToRelay === 0) {
			mbps = 0
			mbpsEmoji = "📈"
			return
		}

		const now = performance.now()
		const elapsedSeconds = (now - lastMbpsCheck) / 1000
		const sentBytes = sentBytesToRelay - lastUploadedBytes
		const newMbps = (sentBytes / 1_000_000) / elapsedSeconds // in MB/s

		mbpsHistory.push(newMbps)
		if (mbpsHistory.length > MBPS_HISTORY_SIZE) {
			mbpsHistory.shift()
		}
		const averageMbps = mbpsHistory.reduce((sum, value) => sum + value, 0) / mbpsHistory.length

		mbpsEmoji = averageMbps < mbps ? "📉" : "📈"
		mbps = averageMbps

		lastMbpsCheck = now
		lastUploadedBytes = sentBytesToRelay
	}

	async function sendFiles() {
		// Create a unique ID for this sending process, this will be used to check if it got interrupted somewhere else in the code
		const sendingProcessId = Date.now() + Math.floor(Math.random() * 1000000).toString(36)
		currentSendingProcessId = sendingProcessId
		isSendingProcessInterrupted = false
		isSendingProcessEnded = false
		startSendingTime = Date.now()

		var virtualChunkIndex = 0

		// Loop through every file and send them chunk by chunk to the relay server, which will then be sent to the receiver
		logDebugPerformance("---------------")
		for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
			const file = files[fileIndex]
			const total = Math.ceil(file.size / CHUNK_SIZE)
			logDebugPerformance(`${file.virtualPath}: ${total} chunks to send`)

			files[fileIndex].instance = Bun.file(files[fileIndex].physicalPath) // create a file instance right now to avoid keeping it in memory for too long

			// Update the current file info for the spinner display
			currentFileDisplayName = files[fileIndex].virtualPath || files[fileIndex].name
			currentFileSize = files[fileIndex].size || 0
			currentFileSentBytes = 0
			currentChunkSentBytes = 0
			_updateFilesSendingSpinner()

			// Send infos about this file to the relay server, this allows the receiver to know where to save the chunks he's about to receive
			if(!_checkIfSendingProcessIsStillValid(sendingProcessId)) return
			logDebugPerformance(`${file.virtualPath}: sending FileChunks info to relay server`)
			socket.send(JSON.stringify({
				type: "SendMsgToOtherWay",
				data: await cipher.encryptJson({
					highPriority: true,
					dataType: "FileChunks",
					from: virtualChunkIndex,
					name: path.basename(file.name),
					size: file.size,
					path: file.virtualPath
				})
			}))
			logDebugPerformance(`${file.virtualPath}: sent FileChunks info`)

			// Loop through every chunk of the current file and send them to the relay server
			for (let currentFileChunkIndex = 0; currentFileChunkIndex < total; currentFileChunkIndex++) {
				logDebugPerformance(`${file.virtualPath}: Slicing chunk ${currentFileChunkIndex + 1}/${total} (virtualChunkIndex: ${virtualChunkIndex})`)
				const slice = file.instance.slice(currentFileChunkIndex * CHUNK_SIZE, (currentFileChunkIndex + 1) * CHUNK_SIZE)
				const bytes = new Uint8Array(await slice.arrayBuffer())
				logDebugPerformance(`${file.virtualPath}: Sliced chunk ${currentFileChunkIndex + 1}/${total} (virtualChunkIndex: ${virtualChunkIndex})`)
				currentChunkSentBytes = 0

				logDebugPerformance(`${file.virtualPath}: Encrypting chunk ${currentFileChunkIndex + 1}/${total} (virtualChunkIndex: ${virtualChunkIndex})`)
				const payload = await cipher.encryptChunk(bytes, virtualChunkIndex) // encrypt the chunk
				logDebugPerformance(`${file.virtualPath}: Encrypted chunk ${currentFileChunkIndex + 1}/${total} (virtualChunkIndex: ${virtualChunkIndex})`)
				if(!_checkIfSendingProcessIsStillValid(sendingProcessId)) return

				while (allowedBytesByRelay !== null && payload.length + sentBytesToRelay > allowedBytesByRelay) { // 1st check for allowed bytes by relay
					isWaitingForRelayToAllowSending = true
					_updateFilesSendingSpinner()
					await new Promise(resolve => setTimeout(resolve, 500))
				}

				// Wwe were waiting for the relay to allow sending, but now we can send again
				if(isWaitingForRelayToAllowSending) {
					isWaitingForRelayToAllowSending = false
					_updateFilesSendingSpinner()
				}
				if(!_checkIfSendingProcessIsStillValid(sendingProcessId)) return

				// We use a stream to send the chunk to the relay server, this allows us to track the progress of the upload and update the spinner accordingly
				var lastProgressUpdateTime = Date.now()
				const currentChunkStream = streamWithProgress(
					payload,
					(uploadedBytes) => {
						const delta = uploadedBytes - currentChunkSentBytes
						currentChunkSentBytes = uploadedBytes // total bytes currently uploaded for this chunk
						sentBytesToRelay += delta // total bytes sent to the relay server while including this chunk

						if (Date.now() - lastProgressUpdateTime > 400) { // max one update every 400ms
							_calculateMbps()
							_updateFilesSendingSpinner()
							lastProgressUpdateTime = Date.now()
						}
					}
				)
				logDebugPerformance(`${file.virtualPath}: Starting to send chunk ${currentFileChunkIndex + 1}/${total} (virtualChunkIndex: ${virtualChunkIndex}) to relay server`)
				const response = await fetch( // send the chunk to the relay server
					`${relayServerUrl}/shares/chunks?shareId=${shareId}&chunkId=${virtualChunkIndex}`,
					{
						method: "PUT",
						headers: {
							"Content-Type": "application/octet-stream",
							"Content-Length": payload.byteLength.toString()
						},
						body: currentChunkStream
					},
				).catch(error => {
					displayFatalError(`Could not send chunk ${currentFileChunkIndex + 1}/${total} of file ${fileIndex + 1}/${files.length} (virtualChunkIndex: ${virtualChunkIndex}) to the relay server.\n  Error: ${error.message}`, spinner)
				})

				var responseJson
				try {
					responseJson = await response.json()
				} catch (error) {
					const responseStatusCode = response?.status || "unknown"
					displayFatalError(`Could not parse the response from the relay server while sending chunk ${currentFileChunkIndex + 1}/${total} of file ${fileIndex + 1}/${files.length} (virtualChunkIndex: ${virtualChunkIndex}).\n  HTTP Code: ${responseStatusCode}\n  Error: ${error.message}`, spinner)
				}
				logDebugPerformance(`${file.virtualPath}: Sent chunk ${currentFileChunkIndex + 1}/${total} (virtualChunkIndex: ${virtualChunkIndex}) to relay server`)

				if(responseJson?.error == "wait_before_uploading") { // 2nd check for allowed bytes by relay
					currentFileChunkIndex-- // retry the same chunk
					isWaitingForRelayToAllowSending = true
					_updateFilesSendingSpinner()
					await new Promise(resolve => setTimeout(resolve, 500))
					continue
				} else if(responseJson?.error) {
					displayFatalError(`Relay server threw an error (${chalk.dim(stripAnsi(responseJson?.data?.error || responseJson?.error))}):\n  ${stripAnsi(responseJson?.data?.message || responseJson?.message || JSON.stringify(responseJson))}.`, spinner)
				}

				// We sent the chunk successfully, so we can update displayed spinner accordingly
				virtualChunkIndex++
				currentFileSentBytes += payload.length
				if (responseJson?.data?.chunkId != null && responseJson?.data?.receivedBytes != null && !isNaN(responseJson.data.receivedBytes) && responseJson.data.receivedBytes >= 1) {
					sentBytesToRelay = responseJson.data.receivedBytes // more trusted than what we calculate ourselves
				}
				_calculateMbps()
				_updateFilesSendingSpinner()

				// We update the allowedBytesByRelay value when sending a chunk, but we also update it when receiving a chunk update through the socket
				if (responseJson.data.allowedBytesMax != null && !isNaN(responseJson.data.allowedBytesMax)) allowedBytesByRelay = responseJson.data.allowedBytesMax

				if(!_checkIfSendingProcessIsStillValid(sendingProcessId)) return
			}

			files[fileIndex].instance = null // free memory
			currentFilePosition++
		}

		// All files have been sent, we can end the sending process
		socket.send(JSON.stringify({ type: "LastChunk", data: { lastChunkId: virtualChunkIndex - 1 } }))
		isSendingProcessEnded = true
		_updateFilesSendingSpinner()

		// TODO: then, delete the transfer on the relay server once we know the receiver downloaded everything
		// TODO: don't process.exit() here bc we need to stay connected if transfer need to be restarted
		// TODO: wait for receiver to receive everything before spinner.succeed() and saveDebugPerformances()

		// Save debug performances file on disk
		if (globalThis.debugPerformances === true) await saveDebugPerformances()
	}

	// Method to check if the transfer was not interrupted by another part of the code
	function _checkIfSendingProcessIsStillValid(sendingProcessId) {
		if(currentSendingProcessId != sendingProcessId) {
			isSendingProcessInterrupted = true
			return false
		}
		return true
	}
}