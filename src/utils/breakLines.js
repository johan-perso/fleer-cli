import { stripForDisplay } from "./stripText.js"

export default function (
	columns = 80,
	prefix = "",
	str = "",
	options = { skipPrefixFirstLine: false },
) {
	return str
		.split("\n")
		.flatMap(rawLine => {
			if (!rawLine) return [""]

			const words = rawLine.split(" ")
			const lines = []
			let currentLine = ""

			for (const word of words) {
				const nextLine = currentLine
					? `${currentLine} ${word}`
					: word

				if (stripForDisplay(nextLine).length > columns && currentLine) {
					lines.push(currentLine)
					currentLine = word
				} else {
					currentLine = nextLine
				}
			}

			if (currentLine) lines.push(currentLine)

			return lines
		})
		.map((line, index) => {
			if (index === 0 && options.skipPrefixFirstLine) {
				return line
			}

			return prefix + line
		})
		.join("\n")
}