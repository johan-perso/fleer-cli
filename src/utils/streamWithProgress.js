export default function streamWithProgress(
	payload,
	onProgress // (uploaded: number, total: number)
) {
	const total = payload.byteLength
	let uploaded = 0

	const chunkSize = 512 * 1024 // 512 KB

	return new ReadableStream({
		pull(controller) {
			if (uploaded >= total) {
				controller.close()
				return
			}

			const end = Math.min(uploaded + chunkSize, total)
			const chunk = payload.subarray(uploaded, end)

			controller.enqueue(chunk)

			uploaded = end

			onProgress(
				uploaded,
				total,
			)
		}
	})
}