import { createHash } from "crypto"

export default async function (path, algorithm = "sha256") {
	const hash = createHash(algorithm)
	const stream = Bun.file(path).stream()

	for await (const chunk of stream) {
		hash.update(chunk)
	}

	return hash.digest("hex")
}