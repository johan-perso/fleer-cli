// vibe coded for testing purposes / made when developing the relay and didn't wanted to do much for the cli yet

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
		throw new Error(`Le protocole ${protocolIndicator} est inconnu de ce client (connues : ${Object.keys(ENCRYPTION_PROTOCOLS).join(", ")})`,)
	}
	return protocol
}

// ═══════════════════════════════════════════════════════════ Fragment
//
//   https://fleer.app/s/TibtMKRdb#1.aBcDeFgHiJkLmNoP
//                                  ▲ ▲
//                      protocol indicator │ clé courte

// ══════════════════════════════════════════════════════════ Primitives

/** Tirage uniforme par rejet : `byte % n` biaiserait la distribution. */
export function generateShortKey(length, alphabet) {
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

/**
 * Normalise tout ce qui peut sortir d'un JSON, d'un body HTTP ou d'un
 * pont natif. Sans ça, un payload passé par JSON.parse arrive en Array
 * simple et n'a pas de .subarray.
 */
export function toBytes(input) {
	if (input instanceof Uint8Array) return input // inclut Buffer
	if (input instanceof ArrayBuffer) return new Uint8Array(input)

	if (ArrayBuffer.isView(input)) {
		return new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
	}
	if (Array.isArray(input)) return Uint8Array.from(input)
	if (typeof input === "string") return fromBase64Url(input)

	// {"0":89,"1":82,...} — ce que produit JSON.stringify(uint8array)
	if (input && typeof input === "object") {
		const keys = Object.keys(input)
		if (keys.length > 0 && keys.every((k) => /^\d+$/.test(k))) {
			const out = new Uint8Array(keys.length)
			for (const k of keys) out[Number(k)] = input[k]
			return out
		}
	}

	throw new TypeError(`Payload illisible (${Object.prototype.toString.call(input)})`,)
}

export function toBase64Url(bytes) {
	let binary = ""
	const view = toBytes(bytes)
	for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i])
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export function fromBase64Url(text) {
	const binary = atob(String(text).replace(/-/g, "+").replace(/_/g, "/"))
	const bytes = new Uint8Array(binary.length)
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
	return bytes
}

// ════════════════════════════════════════════════════════ ShareCipher

const INTERNAL = Symbol("ShareCipher.internal")

export const CHUNK_SIZE = 4 * 1024 * 1024

export class ShareCipher {
	#protocolIndicator
	#protocol
	#shareId
	#shortKey
	#key

	constructor(guard, parts) {
		if (guard !== INTERNAL) {
			throw new TypeError("Utilise ShareCipher.create(), .open() ou .fromShortKey()",)
		}
		this.#protocolIndicator = parts.protocolIndicator
		this.#protocol = parts.protocol
		this.#shareId = parts.shareId
		this.#shortKey = parts.shortKey
		this.#key = parts.key
	}

	// ─────────────────────────────────────────────────────── Fabriques

	/** Émetteur : génère une clé courte neuve. */
	static create({ shareId, protocolIndicator } = {}) {
		const protocol = requireProtocol(protocolIndicator)
		const shortKey = generateShortKey(protocol.shortKeyLength, protocol.alphabet)
		return ShareCipher.fromShortKey({ shareId, shortKey, protocolIndicator })
	}

	/** Coûte 300-800 ms : une seule fois par session, jamais par chunk. */
	static async fromShortKey({ shareId, shortKey, protocolIndicator } = {}) {
		if (!shareId) throw new Error("shareId requis")
		if (!shortKey) throw new Error("shortKey requise")

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
			false, // non extractable : la clé AES ne peut pas fuiter via JS
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

	// ─────────────────────────────────────────────────────── Accesseurs

	get protocolIndicator() {
		return this.#protocolIndicator
	}
	get shareId() {
		return this.#shareId
	}
	get protocol() {
		return this.#protocol
	}

	/** LE secret. Va dans le fragment du lien, nulle part ailleurs. */
	get shortKey() {
		return this.#shortKey
	}

	// ────────────────────────────────────────────────────────── Interne

	#aad(index) {
		return encoder.encode(this.#protocol.aad(this.#shareId, index))
	}

	async #seal(plaintext, aad) {
		const { ivBytes, tagBits } = this.#protocol
		const iv = crypto.getRandomValues(new Uint8Array(ivBytes))

		const sealed = await crypto.subtle.encrypt(
			{ name: "AES-GCM", iv, additionalData: aad, tagLength: tagBits },
			this.#key,
			plaintext,
		)

		// [ IV | ciphertext | tag ] — une allocation, une copie.
		const out = new Uint8Array(ivBytes + sealed.byteLength)
		out.set(iv, 0)
		out.set(new Uint8Array(sealed), ivBytes)
		return out
	}

	async #unseal(rawPayload, aad) {
		const payload = toBytes(rawPayload)
		const { ivBytes, tagBits } = this.#protocol

		if (payload.length <= ivBytes + (tagBits / 8)) {
			throw new Error("Payload trop court pour être valide")
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

	// ───────────────────────────────────────────────────────── Chunks

	encryptChunk(bytes, index) {
		return this.#seal(bytes, this.#aad(index))
	}

	decryptChunk(payload, index) {
		return this.#unseal(payload, this.#aad(index))
	}

	// ─────────────────────────────────────────────────────────── JSON
	//
	// Les métadonnées sont un chunk comme les autres, d'identifiant
	// "primary" — cohérent avec ?chunkId=primary côté API.

	encryptJson(value, index = "primary") {
		return this.#seal(
			encoder.encode(JSON.stringify(value)),
			this.#aad(index),
		)
	}

	async decryptJson(payload, index = "primary") {
		const bytes = await this.#unseal(payload, this.#aad(index))
		return JSON.parse(decoder.decode(bytes))
	}

	// ───────────────────────────────────────────────── Fichier → chunks

	/** Un seul chunk en mémoire à la fois, quelle que soit la taille. */
	async *encryptFile(file, chunkSize = CHUNK_SIZE) {
		const total = Math.max(1, Math.ceil(file.size / chunkSize))

		for (let index = 0; index < total; index++) {
			const slice = file.slice(index * chunkSize, (index + 1) * chunkSize)
			const bytes = new Uint8Array(await slice.arrayBuffer())

			yield {
				index,
				total,
				payload: await this.encryptChunk(bytes, index, total),
			}
		}
	}
}