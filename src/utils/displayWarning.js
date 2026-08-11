import chalk from "chalk"

export default function (message, spinner) {
	var shouldResumeSpinner = spinner?.isSpinning
	if (spinner?.isSpinning) spinner?.stop()
	console.log(`${chalk.yellow("⚠")} ${message}`)
	if (shouldResumeSpinner) spinner?.start()
}