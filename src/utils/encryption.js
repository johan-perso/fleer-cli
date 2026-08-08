// vibe coded for testing purposes / made when developing the relay and didn't wanted to do much for the cli yet

export const USED_PROTOCOL_INDICATOR = 1
export const ENCRYPTION_PROTOCOLS = {
	1: {
		kdfName: "PBKDF2",
		kdfHash: "SHA-256",
		kdfIterations: 600_000,
		keyBits: 256,
		ivBytes: 12,
		tagBits: 128,
		shortKeyLength: 16,
		cipher: "AES-256-GCM",
		alphabet: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
		salt: (shareId) => `fleer:kdf:v1:${shareId}`,
		aad: (shareId, index) => `encprtcl=1|shareid=${shareId}|index=${index}`,
	},
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function requireProtocol(protocolIndicator) {
	const protocol = ENCRYPTION_PROTOCOLS[Number(protocolIndicator)]
	if (!protocol) {
		throw new Error(`Protocol "${protocolIndicator}" is unknown from this client (supported: ${Object.keys(ENCRYPTION_PROTOCOLS).join(", ")})`)
	}
	return protocol
}

export function generateShortKey(length, alphabet) {
	// Use our own random generator to avoid bias in the distribution of characters
	const out = new Array(length)
	const limit = 256 - (256 % alphabet.length)

	let filled = 0
	while (filled < length) {
		const bytes = crypto.getRandomValues(new Uint8Array(length - filled))
		for (const byte of bytes) {
			if (byte >= limit) continue
			out[filled++] = alphabet[byte % alphabet.length]
			if (filled === length) break
		}
	}
	return out.join("")
}

// Simple method to convert various input types (such as what the relay server return) into a Uint8Array
export function toBytes(input) {
	// Uint8Array and ArrayBuffer can be returned easily
	if (input instanceof Uint8Array) return input
	if (input instanceof ArrayBuffer) return new Uint8Array(input)

	if (ArrayBuffer.isView(input)) {
		return new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
	}
	if (Array.isArray(input)) return Uint8Array.from(input)
	if (typeof input === "string") return fromBase64(input)

	// {"0":x,"1":x,...} is produced by JSON.stringify on a Uint8Array, so we can accept it too.
	if (input && typeof input === "object") {
		const keys = Object.keys(input)
		if (keys.length > 0 && keys.every((k) => /^\d+$/.test(k))) {
			const out = new Uint8Array(keys.length)
			for (const k of keys) out[Number(k)] = input[k]
			return out
		}
	}

	throw new TypeError(`Unreadable payload. Could not convert ${Object.prototype.toString.call(input)} to a Uint8Array.`)
}

// Decode base64 string into a Uint8Array
export function fromBase64(text) {
	const binary = atob(String(text))
	const bytes = new Uint8Array(binary.length)

	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i)
	}

	return bytes
}

// =================================== //

// ShareCipher is the main class to encrypt/decrypt data for a given share
const INTERNAL = Symbol("ShareCipher.internal")
export class ShareCipher {
	#protocolIndicator
	#protocol
	#shareId
	#shortKey
	#key

	constructor(guard, parts) {
		if (guard !== INTERNAL) { // minor protection against accidental instantiation, but not a security measure
			throw new TypeError("ShareCipher constructor is private. Use `ShareCipher.create()` (sender side) or `ShareCipher.fromShortKey()` (receiver side) instead.")
		}

		this.#protocolIndicator = parts.protocolIndicator
		this.#protocol = parts.protocol
		this.#shareId = parts.shareId
		this.#shortKey = parts.shortKey
		this.#key = parts.key
	}

	// Create a new ShareCipher instance for a given shareId while generating a new shortKey
	static create({ shareId, protocolIndicator } = {}) {
		const protocol = requireProtocol(protocolIndicator) // check if protocolIndicator is valid
		const shortKey = generateShortKey(protocol.shortKeyLength, protocol.alphabet) // generate a new shortKey based on protocol
		return ShareCipher.fromShortKey({ shareId, shortKey, protocolIndicator })
	}

	// Create a new ShareCipher instance for a given shareId and shortKey
	static async fromShortKey({ shareId, shortKey, protocolIndicator } = {}) {
		if (!shareId) throw new Error("shareId is required")
		if (!shortKey) throw new Error("shortKey is required")

		const protocol = requireProtocol(protocolIndicator)

		const material = await crypto.subtle.importKey(
			"raw",
			encoder.encode(shortKey),
			protocol.kdfName,
			false,
			["deriveKey"],
		)

		const key = await crypto.subtle.deriveKey(
			{
				name: protocol.kdfName,
				salt: encoder.encode(protocol.salt(shareId)),
				iterations: protocol.kdfIterations,
				hash: protocol.kdfHash,
			},
			material,
			{ name: "AES-GCM", length: protocol.keyBits },
			false, // disable extractable to avoid leaking the key in some way idrk
			["encrypt", "decrypt"],
		)

		return new ShareCipher(INTERNAL, {
			protocolIndicator,
			protocol,
			shareId,
			shortKey,
			key,
		})
	}

	// Some accessors to easily access internal properties
	get protocolIndicator() {
		return this.#protocolIndicator
	}
	get shareId() {
		return this.#shareId
	}
	get protocol() {
		return this.#protocol
	}
	get shortKey() { // semi-"public" encryption key, used to derive the actual encryption key
		return this.#shortKey
	}

	#aad(index) {
		return encoder.encode(this.#protocol.aad(this.#shareId, index))
	}

	// Seal and unseal methods are the core of the encryption/decryption process
	async #seal(plaintext, aad) {
		const { ivBytes, tagBits } = this.#protocol
		const iv = crypto.getRandomValues(new Uint8Array(ivBytes))

		const sealed = await crypto.subtle.encrypt(
			{ name: "AES-GCM", iv, additionalData: aad, tagLength: tagBits },
			this.#key,
			plaintext,
		)

		// Return a single Uint8Array containing [ iv | sealed | tag ]
		const out = new Uint8Array(ivBytes + sealed.byteLength)
		out.set(iv, 0)
		out.set(new Uint8Array(sealed), ivBytes)
		return out
	}
	async #unseal(rawPayload, aad) {
		const payload = toBytes(rawPayload)
		const { ivBytes, tagBits } = this.#protocol

		if (payload.length <= ivBytes + (tagBits / 8)) {
			throw new Error("Payload is too short to contain a valid IV, ciphertext and tag. It may be corrupted or truncated.")
		}

		const plain = await crypto.subtle.decrypt(
			{
				name: "AES-GCM",
				iv: payload.subarray(0, ivBytes),
				additionalData: aad,
				tagLength: tagBits,
			},
			this.#key,
			payload.subarray(ivBytes),
		)

		return new Uint8Array(plain)
	}

	// Methods used to encrypt/decrypt actual chunks of binary data,
	// the index is used to generate the AAD to ensure some integrity of exchanges
	encryptChunk(bytes, index) {
		return this.#seal(bytes, this.#aad(index))
	}
	decryptChunk(payload, index) {
		return this.#unseal(payload, this.#aad(index))
	}

	// Methods used to encrypt/decrypt JSON data
	// the index is not that important here tbh, but it can be set to "primary" for the primary details, or "default" for other data
	encryptJson(value, index = "default") {
		return this.#seal(
			encoder.encode(JSON.stringify(value)),
			this.#aad(index),
		)
	}
	async decryptJson(payload, index = "default") {
		const bytes = await this.#unseal(payload, this.#aad(index))
		return JSON.parse(decoder.decode(bytes))
	}
}

export default {
	USED_PROTOCOL_INDICATOR,
	ENCRYPTION_PROTOCOLS,
	toBytes,
	ShareCipher,
}