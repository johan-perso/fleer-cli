import chalk from "chalk"

import breakLines from "./breakLines.js"

export default function (message, spinner, options = { exit: true }) {
	while(message.endsWith("..")) message = `${message.slice(0, -2)}.`

	spinner?.clear()
	process.stderr.write(`${chalk.red("✖")} ${breakLines(process.stdout.columns - 2, "  ", message, { skipPrefixFirstLine: true })}\n`)
	if(options?.exit) process.exit(1)
}