import path from "path"
import chalk from "chalk"
import { tmpdir } from "os"
import { writeFile } from "fs/promises"

globalThis.debugPerformancesCsv = "timestamp,timeSinceLast,action"
globalThis.lastDebugPerformanceTimestamp = Date.now()

export function logDebugPerformance(action) {
	if (globalThis.debugPerformances !== true) return

	var now = Date.now()
	var timeSinceLast = now - lastDebugPerformanceTimestamp
	const escapedAction = action.replace(/,/g, ";") // replace commas with semicolons to avoid breaking the CSV format
	debugPerformancesCsv += `\n${now},${timeSinceLast},${escapedAction}`

	lastDebugPerformanceTimestamp = now
}

export async function saveDebugPerformances() {
	const debugFilePath = path.join(process.cwd(), `fleer_debug_performances_${Date.now()}.csv`)
	await Bun.write(debugFilePath, debugPerformancesCsv)
	console.log(`\n${chalk.green("✔")} Debug performances saved to ${chalk.cyan(debugFilePath)}`)
}

export function getDebugSocketFilePath() {
	return path.join(tmpdir(), "fleer_cli_socket.txt")
}

export async function appendSocketDebugEvent(message) {
	if (globalThis.debugSocket !== true) return

	const now = new Date().toISOString()
	await writeFile(getDebugSocketFilePath(), `[${now}] ${message}\n`, { flag: "a" })
}

export default {
	logDebugPerformance,
	saveDebugPerformances,

	getDebugSocketFilePath,
	appendSocketDebugEvent
}