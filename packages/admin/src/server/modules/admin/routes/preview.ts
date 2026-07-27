/**
 * Preview Functions - Server-side
 *
 * RPC functions for draft mode preview.
 * Handles token minting for secure, shareable preview links.
 *
 * Browser-safe utilities (isDraftMode, createDraftModeCookie, etc.) are in @questpie/admin/shared
 */

import { ApiError, route } from "questpie";
import { z } from "zod";

import type { PreviewConfig } from "../../../augmentation.js";
import { hasAdminRole } from "../auth-helpers.js";
import { translateAdminMessage } from "./i18n-helpers.js";
import { getApp, getCollectionState, getLocale } from "./route-helpers.js";

// ============================================================================
// Token Utilities
// ============================================================================

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

type PreviewSecretResolverContext = Record<string, any>;
type PreviewSecretResolver = (
	ctx: PreviewSecretResolverContext,
) => string | Promise<string>;
type PreviewSecretSource = string | PreviewSecretResolver;
type PreviewTokenParseError = "invalidPayload" | "tokenExpired" | "invalidPath";
type PreviewTokenParseResult =
	| { payload: PreviewTokenPayload }
	| { error: PreviewTokenParseError };

function bytesFromBase64Input(
	input: string | Uint8Array | ArrayBuffer,
): Uint8Array {
	if (typeof input === "string") {
		return textEncoder.encode(input);
	}
	if (input instanceof Uint8Array) {
		return input;
	}
	return new Uint8Array(input);
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = "";
	const chunkSize = 0x8000;
	for (let i = 0; i < bytes.length; i += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
	}
	return btoa(binary);
}

function base64ToBytes(input: string): Uint8Array {
	const binary = atob(input);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

function base64UrlEncode(input: string | Uint8Array | ArrayBuffer): string {
	return bytesToBase64(bytesFromBase64Input(input))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "");
}

function base64UrlDecode(input: string): string {
	let base64 = input.replace(/-/g, "+").replace(/_/g, "/");
	const padding = base64.length % 4;
	if (padding) {
		base64 += "=".repeat(4 - padding);
	}
	return textDecoder.decode(base64ToBytes(base64));
}

async function signPayload(payload: string, secret: string): Promise<string> {
	const subtle = globalThis.crypto?.subtle;
	if (!subtle) {
		throw new Error(
			"[preview] Web Crypto API is required to sign preview tokens.",
		);
	}

	const key = await subtle.importKey(
		"raw",
		textEncoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await subtle.sign("HMAC", key, textEncoder.encode(payload));
	return base64UrlEncode(signature);
}

function timingSafeEqualAscii(a: string, b: string): boolean {
	const aBytes = textEncoder.encode(a);
	const bBytes = textEncoder.encode(b);
	let diff = aBytes.length ^ bBytes.length;
	const maxLength = Math.max(aBytes.length, bBytes.length);
	for (let i = 0; i < maxLength; i++) {
		diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
	}
	return diff === 0;
}

function defaultPreviewSecret(ctx: PreviewSecretResolverContext): string {
	return getApp(ctx).config.secret ?? "dev-preview-secret";
}

async function resolvePreviewSecret(
	source: PreviewSecretSource,
	ctx: PreviewSecretResolverContext,
): Promise<string> {
	const secret = typeof source === "function" ? await source(ctx) : source;
	if (!secret) {
		throw new Error("[preview] Preview token secret must not be empty.");
	}
	return secret;
}

function parsePreviewTokenPayload(
	encodedPayload: string,
): PreviewTokenParseResult {
	try {
		const payload = JSON.parse(
			base64UrlDecode(encodedPayload),
		) as PreviewTokenPayload;

		if (!payload?.exp || typeof payload.exp !== "number") {
			return { error: "invalidPayload" };
		}

		if (payload.exp < Date.now()) {
			return { error: "tokenExpired" };
		}

		if (!payload.path || typeof payload.path !== "string") {
			return { error: "invalidPath" };
		}

		return { payload };
	} catch {
		return { error: "invalidPayload" };
	}
}

async function verifyPreviewSignature(
	encodedPayload: string,
	signature: string,
	secret: string,
): Promise<boolean> {
	const expectedSignature = await signPayload(encodedPayload, secret);
	return timingSafeEqualAscii(signature, expectedSignature);
}

// ============================================================================
// Schema Definitions
// ============================================================================

const mintPreviewTokenSchema = z.object({
	path: z.string().min(1),
	ttlMs: z.number().positive().optional(),
});

const mintPreviewTokenOutputSchema = z.object({
	token: z.string(),
	expiresAt: z.number(),
});

const verifyPreviewTokenSchema = z.object({
	token: z.string(),
});

const verifyPreviewTokenOutputSchema = z.object({
	valid: z.boolean(),
	path: z.string().optional(),
	error: z.string().optional(),
});

// ============================================================================
// Preview Token Payload
// ============================================================================

export interface PreviewTokenPayload {
	path: string;
	exp: number;
}

// ============================================================================
// Functions Factory
// ============================================================================

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Create preview-related RPC functions.
 *
 * @param secret - Secret key or resolver for signing tokens. Defaults to
 *   `app.config.secret` from the current route context.
 * @returns Object with preview functions
 */
export function createPreviewFunctions(
	secret: PreviewSecretSource = defaultPreviewSecret,
) {
	/**
	 * Mint a preview token for draft mode access.
	 *
	 * Requires authenticated admin session.
	 * Token contains the target path and expiration time.
	 *
	 * @example
	 * ```ts
	 * const { token } = await client.routes.mintPreviewToken.post({
	 *   path: "/pages/about",
	 *   ttlMs: 30 * 60 * 1000, // 30 minutes
	 * });
	 * // Use: /api/preview?token=${token}
	 * ```
	 */
	const mintPreviewToken = route()
		.post()
		.access(
			(ctx): boolean =>
				(ctx as { session?: { user?: { role?: unknown } } }).session?.user
					?.role === "admin",
		)
		.schema(mintPreviewTokenSchema)
		.outputSchema(mintPreviewTokenOutputSchema)
		.handler(async (ctx) => {
			const { input } = ctx;
			const locale = getLocale(ctx);
			const t = (key: string, params?: Record<string, unknown>) =>
				translateAdminMessage(locale, key, params);
			// Require authenticated admin session even for direct handler calls.
			if (!hasAdminRole(ctx)) {
				throw ApiError.unauthorized(t("preview.adminSessionRequired"));
			}

			const { path, ttlMs = DEFAULT_TTL_MS } = input;
			const expiresAt = Date.now() + ttlMs;

			const payload: PreviewTokenPayload = { path, exp: expiresAt };
			const payloadString = JSON.stringify(payload);
			const encodedPayload = base64UrlEncode(payloadString);
			const signature = await signPayload(
				encodedPayload,
				await resolvePreviewSecret(secret, ctx),
			);

			return {
				token: `${encodedPayload}.${signature}`,
				expiresAt,
			};
		});

	/**
	 * Verify a preview token.
	 *
	 * Used by the preview route to validate tokens before setting draft mode cookie.
	 * Does not require authentication (token IS the authentication).
	 *
	 * @example
	 * ```ts
	 * const result = await client.routes.verifyPreviewToken.post({ token });
	 * if (result.valid) {
	 *   // Redirect to result.path with draft mode cookie
	 * }
	 * ```
	 */
	const verifyPreviewToken = route()
		.post()
		.schema(verifyPreviewTokenSchema)
		.outputSchema(verifyPreviewTokenOutputSchema)
		.handler(async (ctx) => {
			const { input } = ctx;
			const locale = getLocale(ctx);
			const t = (key: string, params?: Record<string, unknown>) =>
				translateAdminMessage(locale, key, params);
			const { token } = input;

			const [encodedPayload, signature] = token.split(".");
			if (!encodedPayload || !signature) {
				return { valid: false, error: t("preview.invalidTokenFormat") };
			}

			// Verify signature
			const isValidSignature = await verifyPreviewSignature(
				encodedPayload,
				signature,
				await resolvePreviewSecret(secret, ctx),
			);

			if (!isValidSignature) {
				return { valid: false, error: t("preview.invalidSignature") };
			}

			// Parse and validate payload
			const parsed = parsePreviewTokenPayload(encodedPayload);
			if ("error" in parsed) {
				return { valid: false, error: t(`preview.${parsed.error}`) };
			}

			return { valid: true, path: parsed.payload.path };
		});

	return {
		mintPreviewToken,
		verifyPreviewToken,
	};
}

// ============================================================================
// Standalone Token Verification (for route handlers)
// ============================================================================

/**
 * Verify a preview token without RPC.
 * Used directly in route handlers where RPC is not available.
 *
 * @param token - The preview token to verify
 * @param secret - The secret used to sign the token
 * @returns The payload if valid, null otherwise
 */
export async function verifyPreviewTokenDirect(
	token: string,
	secret: string,
): Promise<PreviewTokenPayload | null> {
	const [encodedPayload, signature] = token.split(".");
	if (!encodedPayload || !signature) return null;

	if (!(await verifyPreviewSignature(encodedPayload, signature, secret))) {
		return null;
	}

	const parsed = parsePreviewTokenPayload(encodedPayload);
	return "payload" in parsed ? parsed.payload : null;
}

// ============================================================================
// Factory & Helpers
// ============================================================================

/**
 * Create a preview token verifier with bound secret.
 * Use this in route handlers to avoid passing secret repeatedly.
 *
 * @param secret - The secret used to sign tokens.
 * @returns A verify function that only needs the token
 *
 * @example
 * ```ts
 * // Create once at module level
 * const verifyPreviewToken = createPreviewTokenVerifier(secret);
 *
 * // Use in route handler
 * const payload = await verifyPreviewToken(token);
 * if (!payload) {
 *   return new Response("Invalid token", { status: 401 });
 * }
 * ```
 */
export function createPreviewTokenVerifier(
	secret: string,
): (token: string) => Promise<PreviewTokenPayload | null> {
	return (token: string): Promise<PreviewTokenPayload | null> => {
		return verifyPreviewTokenDirect(token, secret);
	};
}

// ============================================================================
// Preview URL Generation
// ============================================================================

const getPreviewUrlSchema = z.object({
	collection: z.string().min(1),
	record: z.record(z.string(), z.unknown()),
	locale: z.string().optional(),
});

const getPreviewUrlOutputSchema = z.object({
	url: z.string().nullable(),
	error: z.string().optional(),
});

/**
 * Get preview URL for a collection record.
 *
 * Calls the server-side url() function from the collection's .preview() config.
 * This is needed because url() is a function that cannot be serialized to JSON.
 *
 * @example
 * ```ts
 * const { url } = await client.routes.getPreviewUrl.post({
 *   collection: "pages",
 *   record: { slug: "about", title: "About Us" },
 *   locale: "en",
 * });
 * // Returns: "/about?preview=true"
 * ```
 */
const getPreviewUrl = route()
	.post()
	.access(
		(ctx): boolean =>
			(ctx as { session?: { user?: { role?: unknown } } }).session?.user
				?.role === "admin",
	)
	.schema(getPreviewUrlSchema)
	.outputSchema(getPreviewUrlOutputSchema)
	.handler(async (ctx) => {
		const { input } = ctx;
		const messageLocale = getLocale(ctx) ?? input.locale;
		const t = (key: string, params?: Record<string, unknown>) =>
			translateAdminMessage(messageLocale, key, params);
		// Require authenticated admin session even for direct handler calls.
		if (!hasAdminRole(ctx)) {
			return { url: null, error: t("preview.adminSessionRequired") };
		}

		const { collection: collectionName, record, locale } = input;
		const app = getApp(ctx);

		// Get collection from app
		const collections = app.getCollections();
		const collection = collections[collectionName];

		if (!collection) {
			return {
				url: null,
				error: t("preview.collectionNotFound", { collection: collectionName }),
			};
		}

		// Get preview config from collection state
		const previewConfig = getCollectionState(collection).adminPreview as
			| PreviewConfig
			| undefined;

		if (!previewConfig?.url) {
			return {
				url: null,
				error: t("preview.noUrlConfigured"),
			};
		}

		if (previewConfig.enabled === false) {
			return { url: null, error: t("preview.disabledForCollection") };
		}

		try {
			const url = previewConfig.url({ record, locale });
			return { url };
		} catch (err) {
			return {
				url: null,
				error: t("preview.generateUrlFailed", {
					message: err instanceof Error ? err.message : t("error.unknown"),
				}),
			};
		}
	});

// ============================================================================
// Default Functions Bundle
// ============================================================================

/**
 * Default preview functions bundle. The route handlers resolve the token
 * secret from `app.config.secret` at request time.
 * Used by the `adminModule` to register preview RPC functions.
 */
export const previewFunctions = {
	...createPreviewFunctions(),
	getPreviewUrl,
};
