import chalk from "chalk"
import ora from "ora"
import path from "node:path"
import fs from "node:fs/promises"

import { maxLines, truncate } from "./reduceString.js"
import breakLines from "./breakLines.js"
import fetchWithTimeout from "./fetchWithTimeout.js"
import displayWarning from "./displayWarning.js"
import displayFatalError from "./displayFatalError.js"
import checkRelayAccess from "./checkRelayAccess.js"

const DEFAULT_RELAY_LISTS = [
	"https://fleer.app/relays.txt",
	"https://raw.githubusercontent.com/johan-perso/fleer-relay/main/relays.txt",
	"https://johanstick.fr/fleer_relays.txt"
]

function colorizedURL(url, shouldReduceString = false) {
	var output = ""
	if(url.protocol === "file:") {
		output = `${chalk.dim(`${url.protocol}//`)}${url.pathname}`
	} else {
		output = `${chalk.dim(`${url.protocol}//`)}${url.hostname}${chalk.dim(maxLines(url.pathname, 1, 4 + url.protocol.length + 2 + url.hostname.length))}`
	}

	if(shouldReduceString) return maxLines(output, 1, 4)
	else return output
}

export default async function () {
	const spinner = ora("Reading lists of relay servers...").start()

	var lists = []
	var servers = []
	var warns = []

	// Read personnal relay lists of relay servers (yes, lists of lists...)
	const personnalRelayListsPath = path.join(process.env.HOME || process.env.USERPROFILE, ".fleer", "relays_list.txt")
	const personnalRelayListsExists = await fs.access(personnalRelayListsPath).then(() => true).catch(() => false)
	if (personnalRelayListsExists) {
		const personnalRelayListsContent = await fs.readFile(personnalRelayListsPath, "utf-8")
		personnalRelayListsContent.split("\n").forEach((line, index) => {
			var trimmedLine = line.trim()
			var isFile = trimmedLine?.startsWith("file://")

			// Simple checks to skip empty lines, comments, and invalid URLs/files
			if(!trimmedLine || !trimmedLine.length) return
			if(trimmedLine.startsWith("#")) return
			if(!trimmedLine.startsWith("http://") && !trimmedLine.startsWith("https://") && !isFile) {
				warns.push(`Ignoring line ${index + 1} in ${personnalRelayListsPath}: not a valid URL/file path (must start with http://, https:// or file://)`)
				return
			}

			// If the line is a relative file, convert it to an absolute path
			if(isFile && !trimmedLine.startsWith("file:///")) {
				trimmedLine = `file://${path.resolve(path.dirname(personnalRelayListsPath), trimmedLine.slice(7))}`
			}

			if(!lists.find(list => list.uri == trimmedLine)) lists.push({ uri: trimmedLine, type: isFile ? "file" : "url", checked: false, failed: false })
		})
	} else { // if no file, create an empty one
		await fs.mkdir(path.dirname(personnalRelayListsPath), { recursive: true })
		await fs.writeFile(personnalRelayListsPath, "# Add one or multiple lists of relay here, one per line.\n# Lines starting with # are comments.\n# Lines starting with http:// or https:// are URLs.\n# Lines starting with file:// are files on your drive.\n\n", "utf-8")
	}

	// Add default relay lists of relay servers
	DEFAULT_RELAY_LISTS.forEach((uri) => {
		var isFile = uri.startsWith("file://")
		if(!lists.find(list => list.uri == uri)) lists.push({ uri, type: isFile ? "file" : "url", checked: false, failed: false })
	})

	// TODO: ajouter un cache des listes dans le dossier temporaire de l'OS pr pas les relire à chaque fois qu'on fait une command

	function _updateReadingListsSpinner() {
		const formattedLists = lists.map(list => {
			const url = new URL(list.uri)
			return truncate(`${list.failed ? chalk.red("✖") : list.checked ? chalk.green("✔") : chalk.dim("◌")} ${colorizedURL(url, true)}`, 2)
		}).join("\n  ")

		spinner.text = `Reading lists of relay servers...\n  ${formattedLists}`
		if (lists.every(list => list.checked)) {
			if(servers.length) {
				spinner.succeed(`Found ${servers.length} potential relay server${servers.length > 1 ? "s" : ""}`)
			} else {
				spinner.stop()
				displayFatalError(`Finished reading lists of relay servers, but didn't find any.\nYou can setup custom lists in ${chalk.cyan(personnalRelayListsPath)}.`, spinner)
			}
		}
	}

	// Start checking all lists to find relay servers inside of them
	_updateReadingListsSpinner()
	servers.push({ uri: "http://localhost:8080", checked: false, failed: false })
	await Promise.all(lists.map(list => checkRelayList(list)))

	async function parseRelayList(list, content) {
		(content || "").split("\n").forEach((line, index) => {
			var trimmedLine = line.trim()
			var isFile = trimmedLine?.startsWith("file://")

			// Simple checks to skip empty lines, comments, and invalid URLs/files
			if(!trimmedLine || !trimmedLine.length) return
			if(trimmedLine.startsWith("#")) return
			if(!trimmedLine.startsWith("http://") && !trimmedLine.startsWith("https://") && !isFile) {
				warns.push(`Ignoring line ${index + 1} in ${list.uri}: not a valid URL (must start with http:// or https://)`)
				return
			}

			while(trimmedLine.endsWith("/")) trimmedLine = trimmedLine.slice(0, -1)
			if(!servers.find(server => server.uri == trimmedLine)) servers.push({ uri: trimmedLine, checked: false, failed: false })
		})
		lists.find(l => l.uri === list.uri).checked = true
		_updateReadingListsSpinner()
	}

	async function checkRelayList(list) {
		lists.find(l => l.uri === list.uri).checked = false
		if(list.type === "url") {
			const urlResponse = await fetchWithTimeout(list.uri, {}, 5000).catch((error) => {
				failRelayList(list.uri, `Failed to fetch relay list from ${chalk.dim(list.uri)}: ${error?.message}`)
			})
			if(!urlResponse) return

			if(!urlResponse.ok) {
				failRelayList(list.uri, `Failed to fetch relay list from ${chalk.dim(list.uri)}: ${urlResponse?.status} ${urlResponse?.statusText}`)
				return
			}

			if(urlResponse.headers.get("content-type") && !urlResponse.headers.get("content-type").includes("text/plain")) {
				failRelayList(list.uri, `Relay list from ${chalk.dim(list.uri)} is not a text file ${chalk.dim(`(content-type: ${urlResponse.headers.get("content-type")})`)}`)
				return
			}

			if(urlResponse.headers.get("content-length") > 1024 * 1024) {
				failRelayList(list.uri, `Relay list from ${chalk.dim(list.uri)} is too big ${chalk.dim(`(${urlResponse.headers.get("content-length")} bytes)`)}`)
				return
			}

			const urlContent = await urlResponse.text()
			if(urlContent) parseRelayList(list, urlContent)
		} else if(list.type === "file") {
			const filePath = list.uri?.slice(7) // remove "file://"
			try {
				const fileContent = await fs.readFile(filePath, "utf-8")
				parseRelayList(list, fileContent)
			} catch (error) {
				failRelayList(list.uri, `Failed to read relay list from file ${chalk.dim(filePath)}: ${error?.message}`)
			}
		} else {
			return displayFatalError(`Unknown list type for ${chalk.dim(list.uri)}: ${list.type}`, spinner)
		}
	}

	function failRelayList(uri, reason) {
		lists.find(l => l.uri === uri).checked = true
		lists.find(l => l.uri === uri).failed = true
		_updateReadingListsSpinner()
		warns.push(reason)
	}

	// Now, we have a list of potential relay servers that we need to check.
	// For this, we will check the first 5 servers to see if they are working and responding in less than 5 seconds.
	// If we have less than 5 working servers and we still have servers to check, we check the next 5 until we have at least 5 working servers or we have checked all servers.
	// At the end, we will use the server that responded the fastest as the main server.
	function _updateSearchingServerSpinner() {
		spinner.text = `Searching for the best relay server to use...\n  ${servers.map(server => {
			return truncate(`${server.failed ? chalk.red("✖") : server.checked ? chalk.green("✔") : chalk.dim("◌")} ${colorizedURL(new URL(server.uri), true)}`, 2)
		}).join("\n  ")}`
	}
	_updateSearchingServerSpinner()
	spinner.start()

	var serversCheckI = 0
	var serversToCheck = 0
	async function checkNextServers() {
		serversToCheck = servers.slice(serversCheckI, serversCheckI + 5)
		await Promise.all(serversToCheck.map(server => checkRelayServer(server).then((timeElapsed) => {
			servers.find(s => s.uri === server.uri).checked = true
			servers.find(s => s.uri === server.uri).timeElapsed = timeElapsed
			_updateSearchingServerSpinner()
		}).catch(() => {
			servers.find(s => s.uri === server.uri).checked = true
			servers.find(s => s.uri === server.uri).failed = true
			_updateSearchingServerSpinner()
		})))

		serversCheckI += 5
		if (servers.filter(server => server.checked && !server.failed).length >= 5 || serversCheckI >= servers.length) {
			const fastestServer = servers.filter(server => server.checked && !server.failed).sort((a, b) => a.timeElapsed - b.timeElapsed)[0]
			if(fastestServer) {
				spinner.succeed(`Found ${servers.filter(server => server.checked && !server.failed).length} working relay server${servers.filter(server => server.checked && !server.failed).length > 1 ? "s" : ""}.`)
				spinner.succeed(breakLines(process.stdout.columns - 2, "  ", `${chalk.cyan(colorizedURL(new URL(fastestServer.uri)))} is the fastest relay server ${chalk.dim(`(${fastestServer.timeElapsed} ms)`)}.`, { skipPrefixFirstLine: true }))
				return fastestServer.uri
			} else {
				displayFatalError(`Finished checking relay servers, but didn't find any working one.\nYou can setup custom lists in ${chalk.cyan(personnalRelayListsPath)}.`, spinner)
			}
		} else {
			return await checkNextServers()
		}
	}
	const relayServerUrl = await checkNextServers()

	async function checkRelayServer(server) {
		const time = Date.now()
		spinner.stop()
		const checkResult = await checkRelayAccess({
			relayUrl: server.uri,
			spinner,
			callbackOnError: (message) => {
				servers.find(s => s.uri === server.uri).failed = true
			},
			silentProtocolVersionCheck: true,
		})

		if(!servers.find(s => s.uri === server.uri).failed && !checkResult?.sharesCreationAllowed) {
			warns.push(`Relay server ${chalk.dim(server.uri)} doesn't allow creating shares, it will be ignored.`)
			servers.find(s => s.uri === server.uri).failed = true
		}

		servers.find(s => s.uri === server.uri).checked = true
		servers.find(s => s.uri === server.uri).failed = !checkResult?.sharesCreationAllowed
		_updateSearchingServerSpinner()

		if(servers.find(s => s.uri === server.uri).failed) throw new Error(`Relay server ${chalk.dim(server.uri)} is not working or doesn't allow creating shares at this time.`)
		return Date.now() - time
	}

	// At this stage, we found the best relay server to use
	if(warns.length) {
		spinner.stop()
		displayWarning(`Some warnings occurred while searching for relay servers:\n  ${breakLines(process.stdout.columns - 2, "  ", `• ${warns.join("\n• ")}`, { skipPrefixFirstLine: true })}`, spinner)
	}

	return relayServerUrl
}