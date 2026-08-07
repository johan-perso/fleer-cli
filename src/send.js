import chalk from "chalk"
import ora from "ora"
import path from "node:path"
import { lstat, readdir } from "node:fs/promises"
import enquirer from "enquirer"

import getAbsoluteLowest from "./utils/absoluteLowest.js"
import reduceString from "./utils/reduceString.js"
import doubleCheckPaths from "./utils/doubleCheckPaths.js"

var relayServer = "http://192.168.1.174:8080/"
const supportedProtocolVersions = [1]
const maxErrorsCount = 20

const intlFormatter = new Intl.NumberFormat()
const ignoredPaths = []
var autoIgnoreDoubleCheckPaths = false
var disableAskingDoubleCheckPaths = false

var skippedSymlinksCount = 0

export default async function () {
	var filesPath = process.argv.slice(3)
	if (filesPath.length === 0) {
		console.log(chalk.red("No files provided. Please specify at least one file to send."))
		process.exit(1)
	}
	filesPath = [...new Set(filesPath.map(filePath => path.resolve(filePath)))] // Remove duplicates and resolve paths

	let errorsCount = 0
	function displayError(message) {
		process.stderr.write(`${chalk.red("✖")} ${message}\n`)
		errorsCount++
		if(errorsCount >= maxErrorsCount) {
			spinner.clear()
			console.log(chalk.red(`Encountered ${errorsCount}/${maxErrorsCount} errors. Stopping the process.`))
			process.exit(1)
		}
	}

	let warnings = []
	function displayWarning(message) {
		warnings.push(message)

		var maxWarningsCount = process.stdout.rows - (process.stdout.rows > 14 ? 10 : 4)
		if(maxWarningsCount < 2) maxWarningsCount = 2
		if(warnings.length > maxWarningsCount) warnings = warnings.slice(-maxWarningsCount)

		if(spinner.isSpinning) {
			_updateFilesFoundSpinner()
		} else {
			console.log(`${chalk.yellow("⚠")} ${message}`)
		}
	}

	const structure = []
	let filesCount = 0
	let foldersCount = 0

	const spinner = ora("Checking files...").start()
	let lastVirtualPathForSpinner = null
	function _updateFilesFoundSpinner(virtualPath) {
		if(virtualPath != null && virtualPath !== "disabled") lastVirtualPathForSpinner = virtualPath
		const hideLastChecked = virtualPath === "disabled" || lastVirtualPathForSpinner == null

		spinner.text = `Found ${intlFormatter.format(filesCount)} file${filesCount > 1 ? "s" : ""} and ${intlFormatter.format(foldersCount)} folder${foldersCount > 1 ? "s" : ""}.${hideLastChecked ? "" : `\n  ${chalk.dim(reduceString.maxLines(`Last checked: ${virtualPath || lastVirtualPathForSpinner}`, 1, 2))}`}${warnings.length ? `\n${warnings.map(msg => `${chalk.yellow("⚠")} ${chalk.dim(reduceString.maxLines(msg, 1, 2))}`).join("\n")}` : ""}`
	}

	const absoluteLowestPath = await getAbsoluteLowest(filesPath)
	if(!absoluteLowestPath) {
		displayError("No files were found. If you are trying to send a folder, please make sure it is not empty.")
		process.exit(1)
	}

	// Goes through all the files and folders to add them to a structure list
	for (const filePath of filesPath) {
		var stats = null
		try {
			stats = await lstat(filePath) // lstat instead of stat to avoid following symlinks

			// Avoid sending unsupported file types
			var thingsToTest = [
				"isSocket",
				"isBlockDevice",
				"isCharacterDevice",
				"isFIFO"
			]
			var cancelDueToUnsupportedType = false
			thingsToTest.forEach(test => {
				if (stats[test]()) {
					displayError(`"${filePath}" is a ${test.replace("is", "").toLowerCase()}, which is not supported.`)
					cancelDueToUnsupportedType = true
				}
			})
			if(cancelDueToUnsupportedType) continue

			// Avoid sending symlinks
			if (stats.isSymbolicLink()) {
				skippedSymlinksCount++
				displayWarning(`"${filePath}" is a symbolic link, which is not supported. Skipping it. (${skippedSymlinksCount} skipped so far)`)
				continue
			}

			// Check for ignored paths if disableAskingDoubleCheckPaths != true
			if(!disableAskingDoubleCheckPaths) {
				const isDoubleCheckPath = doubleCheckPaths.some(doubleCheckPath => path.basename(filePath).toLowerCase() === doubleCheckPath.toLowerCase())
				if (isDoubleCheckPath) { // found a folder that is commonly ignored
					// Ask user if they want to ignore this folder or not
					var confirmation
					if(!autoIgnoreDoubleCheckPaths) {
						spinner.stop()

						confirmation = await _askIgnoreFile(filePath, stats.isDirectory())
						if(confirmation === "ignoreAll") autoIgnoreDoubleCheckPaths = true
						if(confirmation === "sendAll") disableAskingDoubleCheckPaths = true

						// Delete the two last line of console
						process.stdout.moveCursor(0, -1)
						process.stdout.clearLine(1)
						process.stdout.moveCursor(0, -1)
						process.stdout.clearLine(1)
						spinner.start()
					} else { // auto ignore all double check paths
						confirmation = "ignoreAll"
					}

					// User wants to ignore this item, so we remove it
					if (autoIgnoreDoubleCheckPaths || confirmation == "ignore" || confirmation == "ignoreAll") {
						for (let i = filesPath.length - 1; i >= 0; i--) {
							const lowerCasedFilePath = filePath.toLowerCase()
							const lowerCasedCurrentFilePath = filesPath[i].toLowerCase()
							if (lowerCasedCurrentFilePath === lowerCasedFilePath || lowerCasedCurrentFilePath.startsWith(lowerCasedFilePath)) filesPath.splice(i, 1)
						}

						ignoredPaths.push(filePath)
						continue
					}
				}
			}

			if (stats.isDirectory()) {
				// Read files in the directory and add them to the list of files to send
				const filesInDirectory = await readdir(filePath)
				for (const fileInDirectory of filesInDirectory) {
					const fullPath = path.join(filePath, fileInDirectory)
					if (ignoredPaths.some(ignoredPath => fullPath.startsWith(ignoredPath))) continue // Ignore files that are in ignored paths
					filesPath.push(fullPath)
				}

				var virtualPath = path.relative(absoluteLowestPath, filePath)
				structure.push({
					name: path.basename(path.resolve(filePath)),
					physicalPath: path.resolve(filePath),
					virtualPath,
					type: "directory",
				})

				foldersCount++
				if (foldersCount % 100 === 0) _updateFilesFoundSpinner(virtualPath)
			}
		} catch (error) {
			displayError(error?.code == "ENOENT"
				? `"${filePath}" does not exist or is not accessible.`
				: error?.code == "EACCES"
					? `"${filePath}" is not accessible due to permission issues.`
					: `"${filePath}" could not be accessed. Error: ${error.message}`)
			continue
		}

		if (stats.isFile()) {
			var virtualPath = path.relative(absoluteLowestPath, filePath)
			structure.push({
				name: path.basename(path.resolve(filePath)),
				physicalPath: path.resolve(filePath),
				virtualPath,
				size: stats.size,
				type: "file",
			})

			filesCount++
			if (filesCount % 100 === 0) _updateFilesFoundSpinner(virtualPath)
		}
	}

	// We can display the final count of files/folders found
	warnings = [] // should not rely on warnings.length bc they are cleared if they are too many
	_updateFilesFoundSpinner("disabled")
	if(!filesCount) {
		spinner.fail(spinner.text)
	} else {
		spinner.succeed(spinner.text)
	}

	if(skippedSymlinksCount >= 1) console.log(`${chalk.yellow("⚠")} ${skippedSymlinksCount} symlink${skippedSymlinksCount > 1 ? "s" : ""} skipped.`)
	errorsCount = 0
	skippedSymlinksCount = 0

	if(!filesCount) process.exit(1)

	// Get infos about the relay server
	while(relayServer.endsWith("/")) relayServer = relayServer.slice(0, -1)
	const relayServerInfos = await fetch(`${relayServer}`).then(res => res.json()).catch(() => null)
	if(!relayServerInfos) {
		console.log(chalk.red(`Could not reach the relay server at ${chalk.cyan(relayServer)}.`))
		process.exit(1)
	}
	if(!relayServerInfos?.data?.message.includes("Fleer Backend API")) { // TODO: replace by "Fleer Relay API"
		console.log(chalk.red(`The relay server at ${chalk.cyan(relayServer)} doesn't seem to be a Fleer Relay server.`))
		process.exit(1)
	}
	if(!supportedProtocolVersions.includes(relayServerInfos?.data?.server?.protocolVersion)) {
		console.log(chalk.red(`The relay server at ${chalk.cyan(relayServer)} is using an unsupported protocol version (${chalk.cyan(relayServerInfos?.data?.server?.protocolVersion)}). Supported versions are: ${supportedProtocolVersions.map(v => chalk.cyan(v)).join(", ")}.`))
		process.exit(1)
	}
}

// async function _askConfirmation(question) {
// 	const prompt = new enquirer.Confirm({
// 		name: "confirmation",
// 		message: question,
// 		initial: true,
// 		prefix: chalk.cyan("?"),
// 		format() {
// 			return /^[ty1]/i.test(prompt.input) ? "yes" : "no"
// 		}
// 	})

// 	return prompt.run()
// }
async function _askIgnoreFile(filePath, isFolder = false) {
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