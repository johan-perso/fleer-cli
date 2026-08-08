const ellipsis = "..."

export function maxLength(string = "", maxLength = 50, padding = 0) {
	if(!string) string = ""

	const length = string.length + padding
	if (length <= maxLength) {
		return string
	}

	const truncatedString = string.slice(0, maxLength - ellipsis.length - padding) + ellipsis
	return truncatedString
}

export function maxLines(string = "", maxLines = 2, padding = 0) {
	if(!string) string = ""

	const terminalWidth = process.stdout.columns || 80
	const lines = string.split("\n")
	const truncatedLines = lines.slice(0, maxLines).map(line => {
		if (line.length + padding > terminalWidth) {
			return line.slice(0, terminalWidth - ellipsis.length - padding) + ellipsis
		}
		return line
	})

	if (lines.length > maxLines) {
		truncatedLines.push(ellipsis)
	}

	return truncatedLines.join("\n")
}

export default { maxLength, maxLines }