import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { platform, hostname } from "os"

const execFileAsync = promisify(execFile)

export default async function () {
	if (platform() === "darwin") {
		try {
			const { stdout } = await execFileAsync("scutil", ["--get", "ComputerName"], {
				encoding: "utf8",
				timeout: 2000,
			})
			const name = stdout.trim()
			if (name && name.length > 1 && name.length < 64) return name
		} catch (error) {} // Ignore errors to fallback to default device name
	}

	return _defaultDeviceName()
}

function _defaultDeviceName() {
	var name = process.env.COMPUTERNAME
	if (name && name.length > 1 && name.length < 64) return name

	name = hostname()
	if (name && name.length > 1 && name.length < 64) return name
	return "Anonymous Device"
}