import { execSync } from "child_process"
import { platform, hostname } from "os"

export default function () {
	if (platform() === "darwin") {
		try {
			const name = execSync("scutil --get ComputerName", { encoding: "utf8" }).trim()
			if (name && name.length > 1 && name.length < 64) return name
		} catch (error) {
			// Ignore errors and fallback to default device name
		}
	}

	return _defaultDeviceName()
}

function _defaultDeviceName() {
	var name = process.env.COMPUTERNAME
	if (name && name.length > 1 && name.length < 64) return name

	name = hostname()
	if (name && name.length > 1 && name.length < 64) return name
	return "Unknown Device"
}