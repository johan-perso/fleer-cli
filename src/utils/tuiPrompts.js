import { confirm, input, select, Separator } from "@inquirer/prompts"
import chalk from "chalk"

import reduceString from "./reduceString.js"

async function askConfirmation(question) {
	const answer = await confirm({
		message: question,
		default: true,
		theme: {
			prefix: chalk.cyan("?"),
		},
	})

	return answer
}

async function askCustomText(question, { footer } = {}) {
	const answer = await input({
		message: question,
		theme: {
			prefix: chalk.cyan("?"),
		},
		footer: footer || null,
	})

	return answer.trim()
}

async function askIgnoreFile(filePath, isFolder = false) {
	const firstLineMsg = `"${filePath}" is a commonly ignored ${isFolder ? "folder" : "file"}.`

	const answer = await select({
		message: `${reduceString.maxLines(firstLineMsg, 1, 2)}\n  Do you want to send it?`,
		theme: {
			prefix: chalk.cyan("?"),
		},
		choices: [
			{ name: `Yes - Send this ${isFolder ? "folder" : "file"}`, value: "send" },
			{ name: `No - Ignore this ${isFolder ? "folder" : "file"}`, value: "ignore" },
			new Separator(),
			{ name: `Yes - Send all ${isFolder ? "folder" : "file"}s that are found`, value: "sendAll" },
			{ name: `No - Ignore all similar ${isFolder ? "folder" : "file"}s`, value: "ignoreAll" },
		]
	})

	return answer
}

async function askAlreadyExistingFile(filePath) {
	const answer = await select({
		message: `"${reduceString.maxLines(filePath, 3, 2)}" already exists.\n  What do you want to do?`,
		theme: {
			prefix: chalk.cyan("?"),
		},
		choices: [
			{ name: "Ignore this file", value: "ignore" },
			{ name: "Download with another name", value: "rename" },
			{ name: "Replace the existing file", value: "replace" },
			new Separator(),
			{ name: "Ignore all existing files", value: "ignoreAll" },
			{ name: "Replace all existing files", value: "replaceAll" },
		]
	})

	return answer
}

export {
	askConfirmation,
	askCustomText,
	askIgnoreFile,
	askAlreadyExistingFile
}