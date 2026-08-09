#!/usr/bin/env bun

import chalk from "chalk"

import updateNotifier from "update-notifier"
import packageJson from "./package.json"

import sendFiles from "./src/send.js"
// import receiveFiles from "./src/receive.js"

// Force exit on Ctrl+C
// process.stdin.on("data", (data) => {
// 	if (data.toString() === "\x03") cliCleanup()
// })
process.on("SIGINT", cliCleanup)
process.on("exit", cliCleanup)
function cliCleanup() {
	if (process.stdin.isTTY) {
		process.stdin.setRawMode(false) // put back the terminal in normal mode (in case 'ora' spinner is running)
	}
	process.stdin.pause()
	process.exit(130) // 130 = signal code for SIGINT (Ctrl+C)
}

function showHelp(){
	// TODO: gradient-string with the colors of the logo?
	console.log(`
 ${chalk.cyan(`Fleer CLI v${packageJson.version}`)}
 Developed by Johan

 Usage
   $ fleer

 Commands
   send             Start sending one or multiple files
   receive          Start receiving one or multiple files

 Options
   --version -v     Show installed version
   --help    -h     Show infos on how to use the CLI

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
const defaultArgs = process.argv.slice(2)

if(defaultArgs.includes("--debug-performances")) globalThis.debugPerformances = true

if(defaultArgs.includes("version") || defaultArgs.includes("v") || defaultArgs.includes("--version") || defaultArgs.includes("-v")) showVersion()
else if(defaultArgs.includes("help") || defaultArgs.includes("h") || defaultArgs.includes("--help") || defaultArgs.includes("-h")) showHelp()
else if(defaultArgs.includes("send") || defaultArgs.includes("s") || defaultArgs.includes("upload") || defaultArgs.includes("u")) checkUpdate() && sendFiles()
else if(defaultArgs.includes("receive") || defaultArgs.includes("r") || defaultArgs.includes("download") || defaultArgs.includes("d")) checkUpdate() && sendFiles() // receiveFiles
else {
	console.log(`Unknown command.\nUse ${chalk.cyan("fleer --help")} to see the list of available commands.`)
	process.exit(1)
}

async function checkUpdate(){
	updateNotifier({ pkg: packageJson }).notify()
}