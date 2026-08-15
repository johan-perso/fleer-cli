import displayFatalError from "./displayFatalError.js"

class SocketQueue {
	constructor(options = {}) {
		if (!options.handleEvent || typeof options.handleEvent !== "function") {
			throw new Error("SocketQueue requires a handleEvent function in options.")
		}

		this.queue = []
		this.isProcessing = false,
		this.handleEvent = options.handleEvent
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
				displayFatalError(`Error processing an event from the queue: ${error?.stack || error?.message || error}`)
			}
		}

		this.isProcessing = false
	}
}

export default SocketQueue