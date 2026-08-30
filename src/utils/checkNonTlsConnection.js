import chalk from "chalk"

import { stripForDisplay } from "./stripText.js"
import displayWarning from "./displayWarning.js"
import { askConfirmation } from "./tuiPrompts.js"

export default async function (url) {
	if (url.startsWith("http://")) {
		displayWarning(`You are using an unencrypted connection to the relay server (${chalk.bold.bgRed.cyan("http://")}${chalk.cyan(stripForDisplay(url).replace("http://", ""))}).\n  This is not recommended, as it could expose your data to potential Man-in-the-Middle attacks.\n  If possible, please use a secure connection (https://) to the relay server.`)
		const shouldContinueHTTP = await askConfirmation("Do you want to continue anyway?")
		if (!shouldContinueHTTP) return process.exit()
	}

	return true
}