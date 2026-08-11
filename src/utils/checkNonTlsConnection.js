import chalk from "chalk"
import { stripVTControlCharacters as stripAnsi } from "node:util"

import displayWarning from "./displayWarning.js"
import { askConfirmation } from "./tuiPrompts.js"

export default async function (url) {
	return true // TODO: remove this line to re-enable the TLS check, currently disabled for testing purposes
	if (url.startsWith("http://")) {
		displayWarning(`You are using an unencrypted connection to the relay server (${chalk.bold.bgRed.cyan("http://")}${chalk.cyan(stripAnsi(url).replace("http://", ""))}).\n  This is not recommended, as it could expose your data to potential Man-in-the-Middle attacks.\n  If possible, please use a secure connection (https://) to the relay server.`)
		const shouldContinueHTTP = await askConfirmation("Do you want to continue anyway?")
		if (!shouldContinueHTTP) return process.exit()
	}

	return true
}