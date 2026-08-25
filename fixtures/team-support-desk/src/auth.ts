import { defineCredentialResolver, defineService, principal } from "questpie";

import { demoIds } from "./demo-ids";

export const browserSessionCookieName = "questpie_team_support_session";
export const integrationCredentialHeader = "x-team-support-integration-key";

export const localAuthDefaults = Object.freeze({
	sessionKey: "team-support-desk-local-session-signing-key-v1",
	integrationKey: "team-support-desk-local-integration-key-v1",
});

const encoder = new TextEncoder();

function base64Url(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString("base64url");
}

async function importHmacKey(key: string): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		"raw",
		encoder.encode(key),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign", "verify"],
	);
}

async function signature(value: string, key: string): Promise<string> {
	const signed = await crypto.subtle.sign(
		"HMAC",
		await importHmacKey(key),
		encoder.encode(value),
	);
	return base64Url(new Uint8Array(signed));
}

function sessionPayload(principalId: string, expiresAt: number): string {
	return `v1.${principalId}.${expiresAt}`;
}

export async function createBrowserSessionCookieValue(input: {
	readonly principalId: string;
	readonly expiresAt: number;
	readonly signingKey: string;
}): Promise<string> {
	const payload = sessionPayload(input.principalId, input.expiresAt);
	return `${payload}.${await signature(payload, input.signingKey)}`;
}

async function verifyBrowserSession(
	value: string,
	signingKey: string,
	nowSeconds: number,
): Promise<string | null> {
	const members = value.split(".");
	if (members.length !== 4) return null;
	const [version, principalId, rawExpiry, suppliedSignature] = members;
	if (
		version !== "v1" ||
		principalId === undefined ||
		rawExpiry === undefined ||
		suppliedSignature === undefined ||
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
			principalId,
		) ||
		!/^[0-9]+$/u.test(rawExpiry)
	)
		return null;
	const expiresAt = Number(rawExpiry);
	if (!Number.isSafeInteger(expiresAt) || expiresAt <= nowSeconds) return null;
	let suppliedBytes: Uint8Array<ArrayBuffer>;
	try {
		const decoded = Buffer.from(suppliedSignature, "base64url");
		suppliedBytes = new Uint8Array(decoded.byteLength);
		suppliedBytes.set(decoded);
	} catch {
		return null;
	}
	if (suppliedBytes.byteLength !== 32) return null;
	const payload = sessionPayload(principalId, expiresAt);
	const valid = await crypto.subtle.verify(
		"HMAC",
		await importHmacKey(signingKey),
		suppliedBytes,
		encoder.encode(payload),
	);
	return valid ? principalId : null;
}

function oneCookie(headers: Headers, name: string): string | null {
	const raw = headers.get("cookie");
	if (raw === null) return null;
	let value: string | null = null;
	for (const rawPair of raw.split(";")) {
		const pair = rawPair.trim();
		const separator = pair.indexOf("=");
		if (separator <= 0) continue;
		if (pair.slice(0, separator).trim() !== name) continue;
		if (value !== null) return null;
		value = pair.slice(separator + 1).trim();
	}
	return value;
}

function equalText(left: string, right: string): boolean {
	const leftBytes = encoder.encode(left);
	const rightBytes = encoder.encode(right);
	const length = Math.max(leftBytes.byteLength, rightBytes.byteLength);
	let difference = leftBytes.byteLength ^ rightBytes.byteLength;
	for (let index = 0; index < length; index += 1)
		difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
	return difference === 0;
}

export const supportCredentials = defineService({
	name: "teamSupport.credentials",
	lifetime: "application",
	effect: "external",
	create: () =>
		Object.freeze({
			sessionKey: localAuthDefaults.sessionKey,
			integrationKey: localAuthDefaults.integrationKey,
		}),
});

export const applicationCredentials = defineCredentialResolver({
	name: "teamSupport.applicationCredentials",
	service: supportCredentials,
	resolve: async ({ request, service }) => {
		const integrationKey = request.headers.get(integrationCredentialHeader);
		if (
			integrationKey !== null &&
			equalText(integrationKey, service.integrationKey)
		)
			return {
				kind: "resolved",
				principal: principal.service({ name: demoIds.principals.integration }),
			};

		const cookie = oneCookie(request.headers, browserSessionCookieName);
		if (cookie === null) return { kind: "anonymous" };
		const principalId = await verifyBrowserSession(
			cookie,
			service.sessionKey,
			Math.floor((performance.timeOrigin + performance.now()) / 1_000),
		);
		return principalId === null
			? { kind: "anonymous" }
			: { kind: "resolved", principal: principal.user({ id: principalId }) };
	},
});
