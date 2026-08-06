const { ShareCipher } = require("../encryption.js")
const fs = require("fs")

const fleerUrl = "http://127.0.0.1:8080"
const saveDirectory = "./received_files"
const [shareId, shortKey] = process.argv.slice(2)

var socket = null
const socketQueue = new SocketQueue()
var cipher = null
var lastReceivedChunkIndex = -1

let writingChunks = {}
const fileChunksCorrelationTable = []

var lastEventType = null
var lastEventCount = 0

async function main() {
	if (!fs.existsSync(saveDirectory)) fs.mkdirSync(saveDirectory, { recursive: true })

	if (!shareId || !shortKey) {
		console.error("usage: bun run receive.js <shareId> <shortKey>")
		return
	}

	console.log("Using shareId:", shareId)
	console.log("Using shortKey:", shortKey)

	const shareDetails = await fetch(`${fleerUrl}/shares/read`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			"shareId": shareId
		}),
	})
	const shareDetailsResponse = await shareDetails.json()
	console.log("Share creation response:", shareDetailsResponse)

	const encryptionProtocolIndicator = shareDetailsResponse?.data?.encryptionProtocolIndicator

	const primaryDetailsEncrypted = shareDetailsResponse?.data?.primaryDetails
	if (!primaryDetailsEncrypted) {
		console.error("No primary details found for this shareId.")
		return
	}

	cipher = await ShareCipher.fromShortKey({ shareId, protocolIndicator: encryptionProtocolIndicator, shortKey })
	const primaryDetails = await cipher.decryptJson(primaryDetailsEncrypted)

	console.log("Decrypted primary details:", primaryDetails)

	socket = new WebSocket(`${fleerUrl.replace("http", "ws")}/shares/updates`)
	socket.binaryType = "arraybuffer" // handle binary data as ArrayBuffer

	socket.onopen = () => {
		console.log("WebSocket connection established.")
		socket.send(JSON.stringify({ type: "ConnectToShare", data: { shareId, isSender: false, deviceName: "Je reçois des fichiers" } }))
	}
	socket.onmessage = (event) => {
		socketQueue.enqueue(event)
	}
	socket.onerror = (error) => {
		console.error("WebSocket error:", error)
	}
	socket.onclose = () => {
		console.log("WebSocket connection closed.")
	}

}
main()

async function handleJsonSocketMessage(message) {
	// Avoid spamming the console if server keep sending the same msg
	if (lastEventType === message?.type) {
		lastEventCount++
		if (lastEventCount > 10) {
			console.warn(`(Received ${lastEventCount} consecutive messages of type: ${message?.type}.)`)
			await new Promise(resolve => setTimeout(resolve, 1000)) // wait a bit to avoid spamming the console
		}
	} else {
		lastEventCount = 1
		lastEventType = message?.type
	}

	switch (message?.type) {
	case "welcome":
		const socketConnectionId = message?.data?.connectionId
		console.log("WebSocket connection ID:", socketConnectionId)
		break
	case "error": // connection is not closed, act as a warning
		console.error(`WebSocket returned an error: ${message?.data?.error} - ${message?.data?.message}`)
		break
	case "fatal": // connection is closed afterwards
		console.error(`WebSocket returned a fatal error: ${message?.data?.error} - ${message?.data?.message}`)
		break
	case "connectedToShare":
		console.log("Asking server for the first 3 chunks of the share...")
		socket.send(JSON.stringify({ type: "GetPrecedentsChunks", data: { fromChunkId: 0, untilChunkId: 3 } })) // max 3 chunks at a time
		break
	case "precedentsChunksUpdate":
		console.log(`Server says there are ${message.data.remaining} chunks remaining to be sent to us.`)
		if (message.data.remaining > 0) {
			console.log("Asking server for more chunks...")
			console.log(`asking chunks until ${lastReceivedChunkIndex + 4} (last received: ${lastReceivedChunkIndex})`)
			socket.send(JSON.stringify({ type: "GetPrecedentsChunks", data: { fromChunkId: lastReceivedChunkIndex + 1, untilChunkId: lastReceivedChunkIndex + 4 } })) // still asking for max 3 chunks at a time
		} else {
			console.log("All chunks that have been sent to the server before we connected have been received.")
			// The server will automatically send us new chunks as they are sent to the server, as soon as we acknowledge what we just got here
		}
		break
	case "msgFromSender":
		console.log("Decrypting message from sender...")
		const unencryptedMessage = await cipher.decryptJson(message.data)
		console.log("Message from sender:", unencryptedMessage)

		if(unencryptedMessage?.dataType == "FileChunks") registerChunkForFile(unencryptedMessage)
		break
	default:
		console.warn("Unknown WebSocket message type:", message.type)
	}
}

function registerChunkForFile(socketMessage) {
	const existing = fileChunksCorrelationTable.find(r => r.from === socketMessage.from)
	if (existing) return // already registered
	fileChunksCorrelationTable.push({ from: socketMessage.from, name: socketMessage.name, size: socketMessage.size, path: socketMessage.path })
	fileChunksCorrelationTable.sort((a, b) => a.from - b.from) // keep the list sorted by 'from' index
}

function getFileForChunk(index) {
	let match = null
	for (const r of fileChunksCorrelationTable) {
		if (r.from <= index) match = r
		else break // list is ordered, so we can stop searching once we find a range that starts after the index
	}
	return match // null if no match found, or the last matching range if found
}

class SocketQueue {
	constructor() {
		this.queue = []
		this.isProcessing = false
	}

	enqueue(message) {
		if(message?.data instanceof Object && message.data?.highPriority) {
			this.queue.unshift(message) // add to the front of the queue for high priority messages
		} else {
			this.queue.push(message) // add to the end of the queue for normal messages
		}

		this.processQueue()
	}

	async processQueue() {
		if (this.isProcessing) return
		this.isProcessing = true

		while (this.queue.length > 0) {
			const event = this.queue.shift()
			try {
				await this.handleEvent(event)
			} catch (error) {
				console.error("Error processing an event from the queue:", error)
			}
		}

		this.isProcessing = false
	}

	async handleEvent(event) {
		// Handle JSON encoded messages
		if (typeof event.data === "string") {
			const message = JSON.parse(event.data)
			await handleJsonSocketMessage(message)
			return
		}

		// Handle binary data (chunks)
		const view = new DataView(event.data)
		const frameType = view.getUint8(0) // 1st byte indicates the frame type (0 = file chunk)
		console.log(`Received binary frame of type ${frameType}`)
		if (frameType !== 0) {
			console.warn("Unknown binary frame type:", frameType)
			process.exit(1)
		}

		const index = view.getUint32(1, false) // 2nd to 5th bytes indicate the chunk index (big-endian)
		lastReceivedChunkIndex = index
		const t0 = performance.now()
		const payload = new Uint8Array(event.data, 5) // The rest is the chunk payload

		console.log(`Decrypting chunk ${index}, size: ${payload.length} bytes`)
		const t1 = performance.now()
		const plain = await cipher.decryptChunk(payload, index)
		console.log(`Decrypted chunk ${index}, size: ${plain.length} bytes`)

		const t2 = performance.now()
		const fileForChunk = getFileForChunk(index)
		console.log(`Chunk ${index} belongs to file: ${fileForChunk ? fileForChunk.name : "unknown"}`)
		if (!fileForChunk) {
			console.warn(`No file correlation found for chunk ${index}. Quitting.`)
			process.exit(1)
		} else {
			if(!writingChunks[fileForChunk.name]) writingChunks[fileForChunk.name] = Bun.file(`${saveDirectory}/${fileForChunk.name}`, { create: true }).writer({ highWaterMark: 100 * 1024 * 1024 })
			writingChunks[fileForChunk.name].write(plain)
		}
		const t3 = performance.now()

		console.log(`chunk ${index}: read ${(t1 - t0).toFixed(1)}ms | ` +
  `decrypt ${(t2 - t1).toFixed(1)}ms | write ${(t3 - t2).toFixed(1)}ms`,)

		// end file stream if we changed file
		if (writingChunks.length >= 2) for (const name in writingChunks) {
			if (name == fileForChunk.name) continue
			await writingChunks[name].end()
			delete writingChunks[name]
		}

		acknowledgeChunks(index)
	}
}

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

		console.log(`Acknowledging chunks: ${chunksToAcknowledge.join(", ")}`)
		socket.send(JSON.stringify({ type: "AcknowledgeChunks", data: { chunkIds: chunksToAcknowledge } }))
		lastAcknowledgeTime = Date.now()
	}, 100) // Acknowledge every 100ms
}