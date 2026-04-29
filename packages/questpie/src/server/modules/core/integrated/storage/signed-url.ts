import type { StorageVisibility } from "#questpie/server/config/types.js";

export interface SignedUrlPayload {
	key: string;
	expires: number;
}

/**
 * Generate HMAC-SHA256 signature for a payload
 */
async function generateSignature(
	payload: string,
	secret: string,
): Promise<string> {
	const encoder = new TextEncoder();
	const keyData = encoder.encode(secret);
	const data = encoder.encode(payload);

	const cryptoKey = await crypto.subtle.importKey(
		"raw",
		keyData,
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);

	const signature = await crypto.subtle.sign("HMAC", cryptoKey, data);
	return btoa(String.fromCharCode(...new Uint8Array(signature)))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

/**
 * Verify HMAC-SHA256 signature
 */
async function verifySignature(
	payload: string,
	signature: string,
	secret: string,
): Promise<boolean> {
	const expectedSignature = await generateSignature(payload, secret);
	return expectedSignature === signature;
}

/**
 * Generate a signed URL token for private file access
 */
export async function generateSignedUrlToken(
	key: string,
	secret: string,
	expirationSeconds: number,
): Promise<string> {
	const expires = Math.floor(Date.now() / 1000) + expirationSeconds;
	const payload: SignedUrlPayload = { key, expires };
	const payloadStr = JSON.stringify(payload);
	const signature = await generateSignature(payloadStr, secret);

	const token = btoa(JSON.stringify({ ...payload, sig: signature }))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");

	return token;
}

/**
 * Verify and decode a signed URL token
 * Returns the payload if valid, null if invalid or expired
 */
export async function verifySignedUrlToken(
	token: string,
	secret: string,
): Promise<SignedUrlPayload | null> {
	try {
		// Restore base64 padding
		const padded = token.replace(/-/g, "+").replace(/_/g, "/");
		const decoded = JSON.parse(atob(padded));

		const { key, expires, sig } = decoded;

		if (!key || !expires || !sig) {
			return null;
		}

		// Check expiration
		const now = Math.floor(Date.now() / 1000);
		if (expires < now) {
			return null;
		}

		// Verify signature
		const payload: SignedUrlPayload = { key, expires };
		const payloadStr = JSON.stringify(payload);
		const isValid = await verifySignature(payloadStr, sig, secret);

		if (!isValid) {
			return null;
		}

		return payload;
	} catch {
		return null;
	}
}

/**
 * Build the full URL for accessing a file
 */
export function buildStorageFileUrl(
	baseUrl: string,
	basePath: string,
	key: string,
	token?: string,
): string {
	// Normalize basePath to avoid double slashes
	const normalizedBasePath = basePath.endsWith("/")
		? basePath.slice(0, -1)
		: basePath;
	const url = new URL(
		`${normalizedBasePath}/storage/files/${encodeURIComponent(key)}`,
		baseUrl,
	);
	if (token) {
		url.searchParams.set("token", token);
	}
	return url.toString();
}

/**
 * Configuration for URL generation
 */
export interface StorageUrlConfig {
	baseUrl: string;
	basePath: string;
	secret: string;
	signedUrlExpiration: number;
}

/**
 * Generate URL for a file based on visibility
 */
export async function generateFileUrl(
	key: string,
	visibility: StorageVisibility,
	config: StorageUrlConfig,
): Promise<string> {
	if (visibility === "private") {
		const token = await generateSignedUrlToken(
			key,
			config.secret,
			config.signedUrlExpiration,
		);
		return buildStorageFileUrl(config.baseUrl, config.basePath, key, token);
	}

	return buildStorageFileUrl(config.baseUrl, config.basePath, key);
}
