import { closeSync, openSync, writeSync } from "node:fs"
import clipboard from "clipboardy"

const isRemote = () => Boolean(process.env.SSH_TTY || process.env.SSH_CONNECTION)

// OSC 52 is a terminal escape sequence that allows copying text to clipboard, even in remote SSH sessions
function osc52(str) {
	const b64 = Buffer.from(str, "utf8").toString("base64")
	const seq = `\x1b]52;c;${b64}\x07`
	return process.env.TMUX ? `\x1bPtmux;${seq.replaceAll("\x1b", "\x1b\x1b")}\x1b\\` : seq
}

// Write in the terminal's TTY to copy text even when stdout is piped to another process
function writeTTY(seq) {
	try {
		const fd = openSync("/dev/tty", "w")
		writeSync(fd, seq)
		closeSync(fd)
		return { status: true, viaSsh: isRemote() }
	} catch {
		return { status: false, viaSsh: false }
	}
}

export default async function copy(str) {
	if (isRemote()) return writeTTY(osc52(str))

	try {
		await clipboard.write(str)
		return { status: true, viaSsh: false }
	} catch (err) { // frequently fails on headless servers (they litteraly don't have a clipboard)
		return { status: false, viaSsh: false }
	}
}