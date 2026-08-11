import { stripVTControlCharacters as stripAnsi } from "node:util"

export default function(columns = 80, prefix = "", str = "") {
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

				if (stripAnsi(nextLine).length > columns && currentLine) {
					lines.push(currentLine)
					currentLine = word
				} else {
					currentLine = nextLine
				}
			}

			if (currentLine) lines.push(currentLine)

			return lines
		})
		.map(line => prefix + line)
		.join("\n")
}