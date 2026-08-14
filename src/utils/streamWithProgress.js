export default function streamWithProgress(
	payload,
	onProgress // (uploaded: number, total: number)
) {
	const total = payload.byteLength
	let uploaded = 0

	return new ReadableStream({
		pull(controller) {
			if (uploaded >= total) {
				controller.close()
				return
			}

			controller.enqueue(payload.subarray(uploaded, total))
			uploaded = total

			onProgress(uploaded, total)
		}
	})
}