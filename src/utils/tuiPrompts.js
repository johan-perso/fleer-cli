import enquirer from "enquirer"
import chalk from "chalk"

import reduceString from "./reduceString.js"

async function askConfirmation(question) {
	const prompt = new enquirer.Confirm({
		message: question,
		initial: true,
		prefix: chalk.cyan("?"),
		format() {
			return /^[ty1]/i.test(prompt.input) ? "yes" : "no"
		}
	})

	return prompt.run()
}

async function askCustomText(question, { footer } = {}) {
	const prompt = new enquirer.Input({
		message: question,
		prefix: chalk.cyan("?"),
		footer: footer || null,
	})

	return prompt.run()
}

async function askIgnoreFile(filePath, isFolder = false) {
	const firstLineMsg = `"${filePath}" is a commonly ignored ${isFolder ? "folder" : "file"}.`
	const prompt = new enquirer.Select({
		message: `${reduceString.maxLines(firstLineMsg, 1, 2)}\n  Do you want to send it?`,
		initial: true,
		prefix: chalk.cyan("?"),
		choices: [
			{ message: `Yes - Send this ${isFolder ? "folder" : "file"}`, value: "send" },
			{ message: `No - Ignore this ${isFolder ? "folder" : "file"}`, value: "ignore" },
			{ role: "separator" },
			{ message: `Yes - Send all ${isFolder ? "folder" : "file"}s that are found`, value: "sendAll" },
			{ message: `No - Ignore all similar ${isFolder ? "folder" : "file"}s`, value: "ignoreAll" },
		]
	})

	var answer
	try {
		answer = await prompt.run()
	} catch (error) {}
	return answer
}

export {
	askConfirmation,
	askCustomText,
	askIgnoreFile
}