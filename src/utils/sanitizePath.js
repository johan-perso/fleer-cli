import { stripForDisplay } from "./stripText.js"

import chalk from "chalk"
import path from "node:path"

const windowsForbiddenChars = /[<>:"/\\|?*\x00-\x1F]/
const windowsReservedNames = /^(?:con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])(?:\..*)?$/iu

export default function sanitizePath(baseDir, untrustedPath) {
	if (typeof untrustedPath !== "string") {
		throw new Error("Path supplied is not a string, which should not be the case")
	}

	untrustedPath = untrustedPath.trim().normalize("NFC") // prevent bypassing checks with unicode normalization
	const untrustedPathDimColored = chalk.dim(stripForDisplay(untrustedPath))

	// Absolute paths are rejected because they obviously can escape the baseDir
	if (path.posix.isAbsolute(untrustedPath) || path.win32.isAbsolute(untrustedPath)) {
		throw new Error(`Path ${untrustedPathDimColored} is absolute, which should not be the case`)
	}

	// Windows has a weird behavior where it allows paths like "C:foo" to be treated as relative paths
	if (/^[a-zA-Z]:/.test(untrustedPath)) {
		throw new Error(`Path ${untrustedPathDimColored} is a Windows drive letter path, which should not be the case`)
	}

	// Check for null bytes in the path to prevent potential errors with File System APIs
	if (untrustedPath.includes("\0")) {
		throw new Error(`Path ${untrustedPathDimColored} contains a null byte, which is not allowed`)
	}

	// Split each part of the path ("/" or "\" for all OSs)
	const parts = untrustedPath.split(/[\\/]+/)
	const cleanParts = []
	for (const part of parts) {
		if (!part || part === ".") continue
		if (part === "..") {
			throw new Error(`Path ${untrustedPathDimColored} used '..' to traverse directories backwards`)
		}

		// Additional checks for Windows-specific invalid characters and reserved names
		if (windowsForbiddenChars.test(part)) {
			throw new Error(`Path ${untrustedPathDimColored} contains forbidden characters for Windows (${chalk.dim(stripForDisplay(part))})`)
		}
		if (windowsReservedNames.test(part)) {
			throw new Error(`Path ${untrustedPathDimColored} contains a reserved name for Windows (${chalk.dim(stripForDisplay(part))})`)
		}
		if (/[. ]$/.test(part)) {
			throw new Error(`Path ${untrustedPathDimColored} contains a segment that ends with a space or dot, which is not allowed on Windows (${chalk.dim(stripForDisplay(part))})`)
		}

		cleanParts.push(part)
	}

	if (cleanParts.length === 0) {
		throw new Error(`Path ${untrustedPathDimColored} is empty after optimization`)
	}

	const base = path.resolve(baseDir)
	const target = path.resolve(base, ...cleanParts)

	// As a final check, we try to compute the best way to go from baseDir to the untrusted path.
	// If this requires going up in the tree, then we have a path traversal attempt.
	const relative = path.relative(base, target)
	if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
		throw new Error(`Path ${untrustedPathDimColored} is outside of the base directory (${chalk.dim(stripForDisplay(base))})`)
	}

	return target
}