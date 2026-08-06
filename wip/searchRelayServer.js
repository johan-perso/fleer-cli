import chalk from "chalk"
import ora from "ora"

import reduceString from "../src/utils/reduceString.js"

process.stdin.on("data", (data) => {
	if (data.toString() === "\x03") {
		process.exit(130) // 130 = signal code for SIGINT (Ctrl+C)
	}
})
async function main() {
	var listsServer = [ // examples, should be read from something like ~/.fleer/relays.json
		{
			url: "https://raw.githubusercontent.com/johan-perso/fleer-relay/main/relays.json",
			checked: false,
			failed: false
		},
		{
			url: "https://deltasrv.fleer.app/relays.json",
			checked: false,
			failed: false
		},
		{
			url: "https://hivesrv.fleer.app/relays.json",
			checked: false,
			failed: false
		},
		{
			url: "https://fleersrv.johanstick.fr/relays.json",
			checked: false,
			failed: false
		},
	]

	const servers = [ // examples
		"https://deltasrv.fleer.app/",
		"https://hivesrv.fleer.app/",
		"https://fleersrv.johanstick.fr/",
	]

	const spinner = ora("Reading lists of relay servers...").start()
	function _updateReadingListsSpinner() {
		const formattedLists = listsServer.map(list => {
			const url = new URL(list.url)
			return `${list.failed ? chalk.red("✖") : list.checked ? chalk.green("✔") : chalk.dim("◌")} ${chalk.dim(`${url.protocol}//`)}${url.hostname}${chalk.dim(reduceString.maxLines(url.pathname, 1, 4 + url.protocol.length + 2 + url.hostname.length))}`
		}).join("\n  ")

		spinner.text = `Reading lists of relay servers...\n  ${formattedLists}`
		if (listsServer.every(list => list.checked)) {
			if(servers.length) {
				spinner.succeed(`Found ${servers.length} relay server${servers.length > 1 ? "s" : ""}`)
			} else {
				spinner.stop()
				console.log(`${chalk.red("✖")} Finished reading lists of relay servers, but didn't find any.`)
			}
			process.exit()
		}
	}

	_updateReadingListsSpinner()
	for (var i = 0; i < listsServer.length; i++) {
		const list = listsServer[i]
		setTimeout(async () => {
			list.checked = true
			list.failed = Math.random() < 0.5 // Simulate a random failure for demonstration
			_updateReadingListsSpinner()
		}, (i + 1) * Math.random() * 1500)
	}

	// TODO: we check the first 5 servers to check if they are working
	// TODO: if there is not at least 5 working server (that respond in less than 5 seconds), we add one or two from the list of relay
	// TODO: we take the server that respond the fastest and we use it as the main server

}
main()