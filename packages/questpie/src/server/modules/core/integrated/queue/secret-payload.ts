const SECRET_PAYLOAD_VERSION = 1;
const MINIMUM_ROOT_SECRET_BYTES = 32;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface QueueSecretPayloadEnvelope {
	__questpieQueueSecret: {
		version: typeof SECRET_PAYLOAD_VERSION;
		iv: string;
		ciphertext: string;
	};
}

export interface QueueWrappedSecretKey {
	version: typeof SECRET_PAYLOAD_VERSION;
	iv: string;
	ciphertext: string;
}

export function isQueueSecretPayloadEnvelope(
	value: unknown,
): value is QueueSecretPayloadEnvelope {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const secret = (value as Partial<QueueSecretPayloadEnvelope>)
		.__questpieQueueSecret;
	return (
		secret?.version === SECRET_PAYLOAD_VERSION &&
		typeof secret.iv === "string" &&
		typeof secret.ciphertext === "string"
	);
}

export async function encryptQueueSecretPayload(input: {
	dispatchId: string;
	jobName: string;
	payload: unknown;
	rootSecret: string;
}): Promise<{
	payload: QueueSecretPayloadEnvelope;
	wrappedKey: QueueWrappedSecretKey;
}> {
	assertRootSecret(input.rootSecret);
	const dataKey = await crypto.subtle.generateKey(
		{ name: "AES-GCM", length: 256 },
		true,
		["encrypt", "decrypt"],
	);
	const payloadIv = crypto.getRandomValues(new Uint8Array(12));
	const payloadCiphertext = await crypto.subtle.encrypt(
		{
			name: "AES-GCM",
			iv: toArrayBuffer(payloadIv),
			additionalData: associatedData(
				input.jobName,
				input.dispatchId,
				"payload",
			),
		},
		dataKey,
		encoder.encode(JSON.stringify(input.payload)),
	);
	const rawDataKey = await crypto.subtle.exportKey("raw", dataKey);
	const wrappingKey = await deriveWrappingKey(
		input.rootSecret,
		input.dispatchId,
	);
	const wrappingIv = crypto.getRandomValues(new Uint8Array(12));
	const wrappedKey = await crypto.subtle.encrypt(
		{
			name: "AES-GCM",
			iv: toArrayBuffer(wrappingIv),
			additionalData: associatedData(
				input.jobName,
				input.dispatchId,
				"data-key",
			),
		},
		wrappingKey,
		rawDataKey,
	);

	return {
		payload: {
			__questpieQueueSecret: {
				version: SECRET_PAYLOAD_VERSION,
				iv: encodeBase64(payloadIv),
				ciphertext: encodeBase64(new Uint8Array(payloadCiphertext)),
			},
		},
		wrappedKey: {
			version: SECRET_PAYLOAD_VERSION,
			iv: encodeBase64(wrappingIv),
			ciphertext: encodeBase64(new Uint8Array(wrappedKey)),
		},
	};
}

export async function decryptQueueSecretPayload(input: {
	dispatchId: string;
	jobName: string;
	payload: QueueSecretPayloadEnvelope;
	rootSecret: string;
	wrappedKey: QueueWrappedSecretKey;
}): Promise<unknown> {
	assertRootSecret(input.rootSecret);
	if (input.wrappedKey.version !== SECRET_PAYLOAD_VERSION) {
		throw new Error("QUESTPIE Queue secret payload key is unavailable");
	}
	try {
		const wrappingKey = await deriveWrappingKey(
			input.rootSecret,
			input.dispatchId,
		);
		const rawDataKey = await crypto.subtle.decrypt(
			{
				name: "AES-GCM",
				iv: decodeBase64(input.wrappedKey.iv),
				additionalData: associatedData(
					input.jobName,
					input.dispatchId,
					"data-key",
				),
			},
			wrappingKey,
			decodeBase64(input.wrappedKey.ciphertext),
		);
		const dataKey = await crypto.subtle.importKey(
			"raw",
			rawDataKey,
			"AES-GCM",
			false,
			["decrypt"],
		);
		const plaintext = await crypto.subtle.decrypt(
			{
				name: "AES-GCM",
				iv: decodeBase64(input.payload.__questpieQueueSecret.iv),
				additionalData: associatedData(
					input.jobName,
					input.dispatchId,
					"payload",
				),
			},
			dataKey,
			decodeBase64(input.payload.__questpieQueueSecret.ciphertext),
		);
		return JSON.parse(decoder.decode(plaintext));
	} catch {
		throw new Error("QUESTPIE Queue secret payload cannot be decrypted");
	}
}

function assertRootSecret(rootSecret: string): void {
	if (
		typeof rootSecret !== "string" ||
		encoder.encode(rootSecret).byteLength < MINIMUM_ROOT_SECRET_BYTES
	) {
		throw new Error(
			`QUESTPIE Queue secret payloads require runtimeConfig.secret with at least ${MINIMUM_ROOT_SECRET_BYTES} bytes`,
		);
	}
}

async function deriveWrappingKey(
	rootSecret: string,
	dispatchId: string,
): Promise<CryptoKey> {
	const keyMaterial = await crypto.subtle.importKey(
		"raw",
		encoder.encode(rootSecret),
		"HKDF",
		false,
		["deriveKey"],
	);
	return crypto.subtle.deriveKey(
		{
			name: "HKDF",
			hash: "SHA-256",
			salt: encoder.encode("questpie-queue-secret-payload-v1"),
			info: encoder.encode(dispatchId),
		},
		keyMaterial,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"],
	);
}

function associatedData(
	jobName: string,
	dispatchId: string,
	purpose: "payload" | "data-key",
): ArrayBuffer {
	return toArrayBuffer(
		encoder.encode(
			`questpie-queue-secret-v1\u0000${purpose}\u0000${jobName}\u0000${dispatchId}`,
		),
	);
}

function encodeBase64(value: Uint8Array): string {
	let binary = "";
	for (const byte of value) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function decodeBase64(value: string): ArrayBuffer {
	const binary = atob(value);
	return toArrayBuffer(
		Uint8Array.from(binary, (character) => character.charCodeAt(0)),
	);
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
	const copy = new Uint8Array(value.byteLength);
	copy.set(value);
	return copy.buffer;
}
