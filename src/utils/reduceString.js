import { stripForDisplay } from "./stripText.js"

const ellipsis = "..."

// export function maxLength(string = "", maxLength = 50, padding = 0) {
// 	if(!string) string = ""

// 	const length = stripForDisplay(string).length + padding
// 	if (length <= maxLength) {
// 		return string
// 	}

// 	const truncatedString = string.slice(0, maxLength - ellipsis.length - padding) + ellipsis
// 	return truncatedString
// }

export function maxLines(string = "", maxLines = 2, padding = 0) {
	const terminalWidth = process.stdout.columns || 80
	const width = terminalWidth - padding

	const output = []

	for (const originalLine of string.split("\n")) {
		const words = originalLine.split(" ")
		let line = ""

		for (const word of words) {
			const candidate = line ? `${line} ${word}` : word

			if (stripForDisplay(candidate).length <= width) {
				line = candidate
			} else {
				if (line) output.push(line)
				line = word
			}

			if (output.length >= maxLines) break
		}

		if (output.length < maxLines && line) {
			output.push(line)
		}

		if (output.length >= maxLines) break
	}

	const visibleLines = string
		.split("\n")
		.flatMap(line => {
			const length = stripForDisplay(line).length
			return Array(Math.max(1, Math.ceil(length / width))).fill(null)
		})

	if (visibleLines.length > maxLines) {
		const last = output[maxLines - 1]

		if (last) {
			output[maxLines - 1] = `${last}${ellipsis}`
		}
	}

	return output.slice(0, maxLines).join("\n")
}

export default {
	// maxLength,
	maxLines
}