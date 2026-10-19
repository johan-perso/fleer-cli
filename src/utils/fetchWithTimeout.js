export default async function (url, options = {}, timeout = 5000) {
	// Combine the timeout signal with any user-provided signal
	const signal = options.signal
		? AbortSignal.any([options.signal, AbortSignal.timeout(timeout)])
		: AbortSignal.timeout(timeout)

	try {
		return await fetch(url, { ...options, signal })
	} catch (err) {
		if (err.name === "TimeoutError") {
			throw new Error(`Request timed out after ${timeout}ms: ${url}`)
		}
		throw err
	}
}