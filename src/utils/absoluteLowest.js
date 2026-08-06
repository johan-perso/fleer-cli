import path from "node:path"
import { lstat } from "node:fs/promises"

export default async function (listPaths) {
	const segmentsList = listPaths.map((p) => path.resolve(p).split(path.sep))

	var common = segmentsList.reduce((a, b) => {
		let i = 0
		while (i < a.length && i < b.length && a[i] === b[i]) i++
		return a.slice(0, i)
	})

	var lowestPath = common.join(path.sep) || path.sep

	try {
		if ((await lstat(lowestPath)).isFile()) lowestPath = path.dirname(lowestPath)
	} catch {}

	return lowestPath
}

// export default async function (listPaths) {
// 	let minLevel = Infinity
// 	var lowestFilePaths = listPaths.reduce((lowest, current) => {
// 		while (current.endsWith("/") || current.endsWith("\\")) {
// 			current = current.slice(0, -1)
// 		}

// 		const level = path.resolve(current).split(path.sep).length
// 		if (level < minLevel) {
// 			minLevel = level
// 			return [current]
// 		}
// 		if (level === minLevel) lowest.push(current)
// 		return lowest
// 	}, [])
// 	console.log("lowestFilePaths:", lowestFilePaths)
// 	lowestFilePaths = [...new Set(lowestFilePaths)] // remove duplicates

// 	var lowestPath = lowestFilePaths[0] // default to the first one if all are invalid
// 	if(lowestFilePaths.length > 1) {
// 		for (const filePath of lowestFilePaths) {
// 			var stats = null
// 			try {
// 				stats = await stat(filePath)
// 				if (stats.isSocket() || stats.isBlockDevice() || stats.isSymbolicLink() || stats.isCharacterDevice() || stats.isFIFO()) continue

// 				if (stats.isDirectory()) {
// 					lowestPath = path.dirname(lowestPath)
// 					break
// 				}
// 			} catch (error) {
// 				continue
// 			}

// 			if (stats.isFile()) {
// 				lowestPath = path.dirname(lowestPath)
// 				break
// 			}
// 		}
// 	}
// 	if(!lowestPath || !lowestPath?.length) return null

// 	var absoluteLowestPath = path.resolve(lowestPath)
// 	try {
// 		if (absoluteLowestPath === ".") absoluteLowestPath = process.cwd()
// 		if (absoluteLowestPath === "..") absoluteLowestPath = path.resolve(process.cwd(), "..")
// 		while (absoluteLowestPath.endsWith("/") || absoluteLowestPath.endsWith("\\")) {
// 			absoluteLowestPath = absoluteLowestPath.slice(0, -1)
// 		}
// 		while (absoluteLowestPath.startsWith("../") || absoluteLowestPath.startsWith("..\\")) {
// 			absoluteLowestPath = absoluteLowestPath.slice(3)
// 		}
// 		while (absoluteLowestPath.startsWith("./") || absoluteLowestPath.startsWith(".\\")) {
// 			absoluteLowestPath = absoluteLowestPath.slice(2)
// 		}
// 		if ((await stat(absoluteLowestPath)).isFile()) {
// 			absoluteLowestPath = path.dirname(absoluteLowestPath)
// 		}
// 	} catch (error) {}

// 	return absoluteLowestPath
// }