const { ShareCipher } = require("../encryption.js")
const path = require("path")

const fleerUrl = "http://127.0.0.1:8080"
const encryptionProtocolIndicator = 1
const CHUNK_SIZE = 10 * 1024 * 1024 // 10 MiB

var shareId = null
var socket = null
var cipher = null

var currentSendingProcessId = null
var isSendingProcessInterrupted = false
var isSendingProcessEnded = false
var allowedBytesByRelay = null
var sentBytesToRelay = 0

async function main() {
	const shareCreation = await fetch(`${fleerUrl}/shares/create`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			"encryptionProtocolIndicator": encryptionProtocolIndicator,
			"filesCount": 1,
			"totalSize": 1000000
		}),
	})
	const shareCreationResponse = await shareCreation.json()
	shareId = shareCreationResponse?.data?.shareId
	console.log("Share creation response:", shareCreationResponse)

	const primaryDetails = {
		"structure": [
			{
				"name": "README.md",
				"virtualPath": "./README.md",
				"size": 914,
				"type": "file"
			}
		],
		"localIp": "192.168.1.76",
		"localPort": 31334,
		"deviceName": "My Testing Device"
	}

	cipher = await ShareCipher.create({ shareId, protocolIndicator: encryptionProtocolIndicator })
	const encryptedPrimaryDetails = await cipher.encryptJson(primaryDetails, "primary")

	const sendPrimaryDetails = await fetch(`${fleerUrl}/shares/chunks?shareId=${shareId}&isThisPrimaryDetails=true`, {
		method: "PUT",
		headers: {
			"Content-Type": "application/octet-stream",
		},
		body: encryptedPrimaryDetails
	})
	const sendPrimaryDetailsResponse = await sendPrimaryDetails.json()
	console.log("Send primary details response:", sendPrimaryDetailsResponse)

	socket = new WebSocket(`${fleerUrl.replace("http", "ws")}/shares/updates`)
	socket.onopen = () => {
		console.log("WebSocket connection established.")
		socket.send(JSON.stringify({ type: "ConnectToShare", data: { shareId, isSender: true } }))
	}
	socket.onmessage = async (event) => {
		const message = JSON.parse(event.data)

		switch (message?.type) {
		case "welcome":
			console.log("WebSocket connection ID:", message?.data?.connectionId)
			break
		case "error": // connection is not closed, act as a warning
			console.error(`WebSocket returned an error: ${message?.data?.error} - ${message?.data?.message}`)
			break
		case "fatal": // connection is closed afterwards
			console.error(`WebSocket returned a fatal error: ${message?.data?.error} - ${message?.data?.message}`)
			break
		case "connectedToShare":

			console.log("---------------------------------------------")
			console.log(`Share ID:    ${shareId}`)
			console.log(`Short key:   ${cipher.shortKey}`)
			console.log("---------------------------------------------")

			break
		case "allowedBytesMaxUpdate":
			allowedBytesByRelay = message?.data?.allowedBytesMax
			console.log(`Server updated allowedBytesMax to ${allowedBytesByRelay} bytes.`)
			break
		case "restartTransfer":
			console.log("Server asked to restart the transfer.")
			sentBytesToRelay = 0
			allowedBytesByRelay = null
			currentSendingProcessId = null

			while (!isSendingProcessInterrupted && !isSendingProcessEnded) {
				console.log("Waiting for the sending process to be interrupted before restarting the transfer...")
				await new Promise(resolve => setTimeout(resolve, 500))
			}
			sendFiles()
			break
		default:
			console.warn("Unknown WebSocket message type:", message.type)
		}
	}
	socket.onerror = (error) => {
		console.error("WebSocket error:", error)
	}
	socket.onclose = () => {
		console.log("WebSocket connection closed.")
	}

	await new Promise(resolve => setTimeout(resolve, 6000)) // wait for the server to process the primary details

	// ^^^^^^^^^^^^
	// CREATE THE SHARE AND SEND PRIMARY DETAILS

	// ENCRYPT AND SHARE FILES
	// ⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄
	sendFiles()
}
main()

async function sendFiles() {
	const sendingProcessId = Date.now() + Math.floor(Math.random() * 1000000).toString(36)
	currentSendingProcessId = sendingProcessId
	isSendingProcessInterrupted = false

	const files = [
		Bun.file("/Users/johan/Downloads/IMG_2985.mp4")
	]
	var virtualChunkIndex = 0
	for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
		const file = files[fileIndex]
		const total = Math.ceil(file.size / CHUNK_SIZE)

		if(!checkIfSendingProcessIsStillValid(sendingProcessId)) return
		socket.send(JSON.stringify({
			type: "SendMsgToOtherWay",
			data: await cipher.encryptJson({
				highPriority: true,
				dataType: "FileChunks",
				from: virtualChunkIndex,
				name: path.basename(file.name),
				size: file.size,
				type: "file", // cannot be a folder here
				path: "test"
			})
		}))

		for (let currentFileChunkIndex = 0; currentFileChunkIndex < total; currentFileChunkIndex++) {
			const slice = file.slice(currentFileChunkIndex * CHUNK_SIZE, (currentFileChunkIndex + 1) * CHUNK_SIZE)
			const bytes = new Uint8Array(await slice.arrayBuffer())

			const payload = await cipher.encryptChunk(bytes, virtualChunkIndex)
			if(!checkIfSendingProcessIsStillValid(sendingProcessId)) return
			console.log(`Payload size = ${payload.length} bytes ; file size = ${file.size} bytes ; chunk ${currentFileChunkIndex + 1}/${total}`)

			while (allowedBytesByRelay !== null && payload.length + sentBytesToRelay > allowedBytesByRelay) {
				console.log(`Waiting before sending chunk ${currentFileChunkIndex + 1}/${total} of file ${fileIndex + 1}/${files.length} (virtualChunkIndex: ${virtualChunkIndex}) because allowedBytesByRelay (${allowedBytesByRelay}) is less than sentBytesToRelay (${sentBytesToRelay}) + payload.length (${payload.length})`)
				await new Promise(resolve => setTimeout(resolve, 500))
			}

			if(!checkIfSendingProcessIsStillValid(sendingProcessId)) return
			const response = await fetch(
				`${fleerUrl}/shares/chunks?shareId=${shareId}&chunkId=${virtualChunkIndex}`,
				{
					method: "PUT",
					headers: { "Content-Type": "application/octet-stream" },
					body: payload,
				},
			).then(res => res.json())
			console.log(`File ${fileIndex + 1}/${files.length}: chunk ${currentFileChunkIndex + 1}/${total} (virtualChunkIndex: ${virtualChunkIndex}) response:`, response)

			if(response?.error == "wait_before_uploading") {
				currentFileChunkIndex-- // retry the same chunk
				console.log(`Server asked to wait before uploading chunk ${currentFileChunkIndex + 1}/${total} of file ${fileIndex + 1}/${files.length} (virtualChunkIndex: ${virtualChunkIndex}) because allowedBytesByRelay (${allowedBytesByRelay}) is less than sentBytesToRelay (${sentBytesToRelay}) + payload.length (${payload.length})`)
				await new Promise(resolve => setTimeout(resolve, 500))
				continue
			}

			virtualChunkIndex++
			sentBytesToRelay += payload.length
			if (response?.data?.chunkId != null && response?.data?.receivedBytes != null && !isNaN(response.data.receivedBytes) && response.data.receivedBytes >= 1) {
				sentBytesToRelay = response.data.receivedBytes // more trusted than what we calculate ourselves
			}

			// We update the allowedBytesByRelay value when sending a chunk, but we also update it when receiving a chunk update through the socket
			if (response.data.allowedBytesMax != null && !isNaN(response.data.allowedBytesMax)) allowedBytesByRelay = response.data.allowedBytesMax

			if(!checkIfSendingProcessIsStillValid(sendingProcessId)) return
		}
	}

	isSendingProcessEnded = true
	console.log("All files sent successfully.")
}

function checkIfSendingProcessIsStillValid(sendingProcessId) {
	if(currentSendingProcessId != sendingProcessId) {
		console.log(`Sending process ${sendingProcessId} was interrupted by a new sending process ${currentSendingProcessId}. Stopping the current sending process.`)
		isSendingProcessInterrupted = true
		return false
	}
	return true
}