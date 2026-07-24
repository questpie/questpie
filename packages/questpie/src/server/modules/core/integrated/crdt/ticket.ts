import { Buffer } from "node:buffer";
import { createHmac, randomBytes as cryptoRandomBytes } from "node:crypto";

import { isCrdtTicketCredentialV1 } from "#questpie/shared/crdt-protocol.js";

export class CrdtTicketRejectedError extends Error {
	constructor() {
		super("CRDT ticket rejected");
		this.name = "CrdtTicketRejectedError";
	}
}

export function createCrdtTicketCredential(input: {
	ticketId: string;
	secretKey: string;
	randomSecret?: Uint8Array;
}): Readonly<{ token: string; secretHash: Uint8Array }> {
	assertTicketId(input.ticketId);
	const secretKey = ticketSecretKey(input.secretKey);
	const secret = Buffer.from(input.randomSecret ?? cryptoRandomBytes(32));
	if (secret.byteLength !== 32) {
		throw new TypeError("CRDT ticket secret entropy must be exactly 256 bits");
	}
	const encodedSecret = secret.toString("base64url");
	return Object.freeze({
		token: `${input.ticketId}.${encodedSecret}`,
		secretHash: ticketSecretHash(input.ticketId, secret, secretKey),
	});
}

export function parseCrdtTicketCredential(input: {
	token: string;
	secretKey: string;
}): Readonly<{ ticketId: string; secretHash: Uint8Array }> {
	try {
		if (
			typeof input.token !== "string" ||
			input.token.length > 256 ||
			!isCrdtTicketCredentialV1(input.token)
		) {
			throw new Error();
		}
		const separator = input.token.indexOf(".");
		const ticketId = input.token.slice(0, separator);
		const encodedSecret = input.token.slice(separator + 1);
		assertTicketId(ticketId);
		const secret = Buffer.from(encodedSecret, "base64url");
		if (
			secret.byteLength !== 32 ||
			secret.toString("base64url") !== encodedSecret
		) {
			throw new Error();
		}
		return Object.freeze({
			ticketId,
			secretHash: ticketSecretHash(
				ticketId,
				secret,
				ticketSecretKey(input.secretKey),
			),
		});
	} catch (error) {
		if (
			error instanceof TypeError &&
			error.message === "CRDT ticket secret key must be at least 256 bits"
		) {
			throw error;
		}
		throw new CrdtTicketRejectedError();
	}
}

export function canonicalizeCrdtBrowserOrigin(input: {
	origin: string | null;
	appUrl: string;
	allowedOrigins?: readonly string[];
}): string {
	const allowed = new Set<string>();
	allowed.add(configuredAppOrigin(input.appUrl));
	for (const candidate of input.allowedOrigins ?? []) {
		allowed.add(configuredAllowedOrigin(candidate));
	}

	const origin = requestOrigin(input.origin);
	if (!allowed.has(origin)) {
		throw new CrdtTicketRejectedError();
	}
	return origin;
}

function configuredAppOrigin(value: string): string {
	try {
		const url = new URL(value);
		assertHttpOriginUrl(url);
		return url.origin;
	} catch {
		throw new TypeError("QUESTPIE app URL must have a valid HTTP(S) origin");
	}
}

function configuredAllowedOrigin(value: string): string {
	try {
		return strictOrigin(value);
	} catch {
		throw new TypeError("CRDT allowed origin must be an HTTP(S) origin");
	}
}

function requestOrigin(value: string | null): string {
	try {
		if (value === null || value === "null") throw new Error();
		return strictOrigin(value);
	} catch {
		throw new CrdtTicketRejectedError();
	}
}

function strictOrigin(value: string): string {
	if (
		value.trim() !== value ||
		!/^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#\\]+$/.test(value)
	) {
		throw new Error();
	}
	const url = new URL(value);
	assertHttpOriginUrl(url);
	if (url.hostname.endsWith(".")) throw new Error();
	return url.origin;
}

function assertHttpOriginUrl(url: URL): void {
	if (
		(url.protocol !== "http:" && url.protocol !== "https:") ||
		url.username !== "" ||
		url.password !== "" ||
		url.origin === "null"
	) {
		throw new Error();
	}
}

function ticketSecretHash(
	ticketId: string,
	secret: Uint8Array,
	secretKey: Uint8Array,
): Uint8Array {
	const hash = createHmac("sha256", secretKey);
	hash.update("questpie-crdt-ticket-v1\0");
	hash.update(ticketId);
	hash.update("\0");
	hash.update(secret);
	return hash.digest();
}

function ticketSecretKey(value: string): Uint8Array {
	const bytes = Buffer.from(value, "utf8");
	if (bytes.byteLength < 32) {
		throw new TypeError("CRDT ticket secret key must be at least 256 bits");
	}
	return bytes;
}

function assertTicketId(value: string): void {
	if (
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
			value,
		)
	) {
		throw new TypeError("CRDT ticket ID must be a UUID");
	}
}
