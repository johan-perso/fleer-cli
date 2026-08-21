#!/usr/bin/env bun

import chalk from "chalk"

import updateNotifier from "update-notifier"
import packageJson from "./package.json"

import sendFiles from "./src/send.js"
import receiveFiles from "./src/receive.js"
import breakLines from "./src/utils/breakLines.js"
import { getDebugSocketFilePath } from "./src/utils/debugPerformances.js"

process.on("SIGINT", () => cliCleanup(true))
process.on("exit", () => {
	if (process.stdin.isTTY) process.stdin.setRawMode(false)
})

// Force exit on Ctrl+C
process.stdin.setRawMode(true)
process.stdin.resume()
process.stdin.on("data", (data) => {
	const key = data.toString("utf-8")
	if (key === "\u0003" || data.toString() === "\x03") { // ctrl+c
		cliCleanup(true)
	} else {
		process.stdout.write(key)
	}
})

var isCleaningUp = false
async function cliCleanup(isUserInitiated = false) {
	if(isCleaningUp) return
	isCleaningUp = true

	if (process.stdin.isTTY) {
		process.stdin.setRawMode(false) // put back the terminal in normal mode (in case 'ora' spinner is running)
	}
	process.stdin.pause()

	if(isUserInitiated && globalThis?.spinner && globalThis.spinner.isSpinning) {
		globalThis.spinner.text = `${globalThis.spinner.text}\n\n${chalk.red("✖")} Cancelled by user (Ctrl+C)`
		globalThis.spinner.fail()
	}

	process.exit(0)
}

function showHelp(){
	// TODO: gradient-string with the colors of the logo?
	console.log(`
 ${chalk.cyan(`Fleer CLI v${packageJson.version}`)}
 Developed by Johan

 Usage
   $ fleer

 Commands
   send                  Start sending one or multiple files
   receive               Start receiving one or multiple files

 Options
   --version -v          Show installed version
   --help    -h          Show infos on how to use the CLI
   --debug-performances  Save debug performances to a CSV file (for development purposes)
   --debug-socket        Save debug socket events to a text file (for development purposes)

 How to send a file?
   $ fleer send <file_path>

 How to download a file?
   $ fleer receive <download_keys>

 FAQ:
   Q: Example?
   A: Example.

   Q: Looong example?
   A: Long
      example.
`)
	process.exit()
}

function showVersion(){
	console.log(`Fleer CLI is using version ${chalk.cyan(packageJson.version)}`)
	console.log("────────────────────────────────────────────")
	console.log("Developed by Johan")
	console.log(chalk.cyan("https://johanstick.fr"))
	process.exit()
}

// Check if some arguments are present
globalThis.defaultArgs = process.argv.slice(2)

if(defaultArgs.includes("--debug-performances")) {
	defaultArgs.splice(defaultArgs.indexOf("--debug-performances"), 1)
	globalThis.debugPerformances = true
}
if(defaultArgs.includes("--debug-socket")) {
	defaultArgs.splice(defaultArgs.indexOf("--debug-socket"), 1)
	globalThis.debugSocket = true
	console.log(chalk.yellow(`Debug socket events will be saved to: ${chalk.cyan(getDebugSocketFilePath())}\n`))
}

if(globalThis.fromFleerDownloadAlias) checkUpdate() && receiveFiles()

else if(defaultArgs.includes("version") || defaultArgs.includes("v") || defaultArgs.includes("--version") || defaultArgs.includes("-v")) showVersion()
else if(defaultArgs.includes("help") || defaultArgs.includes("h") || defaultArgs.includes("--help") || defaultArgs.includes("-h")) showHelp()
else if(defaultArgs.includes("help-download") || defaultArgs.includes("--help-download")) showDownloadHelp()
else if(defaultArgs.includes("send") || defaultArgs.includes("s") || defaultArgs.includes("upload") || defaultArgs.includes("u")) checkUpdate() && sendFiles()
else if(defaultArgs.includes("receive") || defaultArgs.includes("r") || defaultArgs.includes("download") || defaultArgs.includes("d")) checkUpdate() && receiveFiles()
else {
	console.log(`Unknown command.\nUse ${chalk.cyan("fleer --help")} to see the list of available commands.`)
	process.exit(1)
}

function showDownloadHelp() {
	var columns = process.stdout.columns || 80
	if (columns > 94) columns = 94
	columns -= 4
	const prefix = "   "

	console.log(`${breakLines(columns, "", "Fleer works with relay servers to transfer files between a sender and a receiver, even outside of a local network or behind a firewall.")}

${chalk.bold.dim("1.")} ${chalk.bold("Exchange security")}
${breakLines(columns, prefix, `Files you send are ${chalk.cyan("encrypted")} on your local device using a randomly generated ${chalk.cyan("encryption key")}. They are then sent to a server, which forwards them to the recipient. Thanks to this method, ${chalk.cyan("no one can read what you send")}, not even the relay itself.\nBut then, how is the recipient able to read what they receive?`)}

${chalk.bold.dim("2.")} ${chalk.bold("Role of the different keys")}
${breakLines(columns, prefix, `To access the data you send, the recipient must first know which ${chalk.cyan("relay server")} the data is stored on, as well as the ${chalk.cyan("share key")} associated with the transfer. This share key is also generated randomly and is used to associate a set of encrypted data with a specific transfer. At this point, the recipient can retrieve the files, ${chalk.cyan("but they remain unreadable")} because they do not have the ${chalk.cyan("encryption key")} required to decrypt them.`)}

${chalk.bold.dim("3.")} ${chalk.bold("Sharing the keys")}
${breakLines(columns, prefix, `As explained above, the recipient needs to know two keys, as well as the relay URL. To make the transfer easier, the ${chalk.cyan("fleer send")} command automatically generates a link containing all the necessary information, ready to be sent to anyone.\n\nhttps://${chalk.cyan("server.fleer.app")}/d/${chalk.cyan("3QNfY73YU")}#${chalk.cyan("1.SFZRQo59aOuwEIZc")}\n\u200B              ↑                ↑             ↑\n\u200B      Relay server URL     Share Key    Encryption Key`)}
`)

	cliCleanup()
}

async function checkUpdate(){
	updateNotifier({ pkg: packageJson }).notify()
}