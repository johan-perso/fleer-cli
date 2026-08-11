import chalk from "chalk"

export default function (message, spinner) {
	spinner?.clear()
	process.stderr.write(`${chalk.red("✖")} ${message}\n`)
	process.exit(1)
}