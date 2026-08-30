import chalk from "chalk"

import breakLines from "./breakLines.js"

export default function (message, spinner) {
	var shouldResumeSpinner = spinner?.isSpinning
	if (spinner?.isSpinning) spinner?.stop()
	console.log(`${chalk.yellow("⚠")} ${breakLines(process.stdout.columns - 2, "  ", message, { skipPrefixFirstLine: true })}`)
	if (shouldResumeSpinner) spinner?.start()
}