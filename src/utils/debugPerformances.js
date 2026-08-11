import path from "path"
import chalk from "chalk"

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

export default {
	logDebugPerformance,
	saveDebugPerformances
}