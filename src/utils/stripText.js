import { stripVTControlCharacters } from "node:util"

function stripAnsi(str) {
	return stripVTControlCharacters(str)
}

function stripForDisplay(str) {
	if (typeof str !== "string") str = String(str)
	if (str === "undefined") return ""
	if (!str || !str.length) return ""

	return stripVTControlCharacters(str)
		.replace(/[\r\n\t]/g, " ") // carriage return, line break, tab
		.replace(/[\x00-\x1F\x7F]/g, "") // remove other control characters such as bell or backspace
}

export { stripAnsi, stripForDisplay }