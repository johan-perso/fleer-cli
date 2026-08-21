export default function removeLinesFromConsole(amount) {
	for (let i = 0; i < amount; i++) {
		process.stdout.moveCursor(0, -1)
		process.stdout.clearLine(1)
	}
}