/**
 * Preview Functions - Server-side
 *
 * RPC functions for draft mode preview.
 * Handles token minting for secure, shareable preview links.
 *
 * Browser-safe utilities (isDraftMode, createDraftModeCookie, etc.) are in @questpie/admin/shared
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { fn, type Questpie } from "questpie";
import { z } from "zod";
import { getPreviewSecret } from "#questpie/admin/shared/preview-utils.js";
import type { PreviewConfig } from "../../../augmentation.js";

// ============================================================================
// Token Utilities
// ============================================================================

function base64UrlEncode(input: string | Buffer): string {
	const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
	return buffer
		.toString("base64")
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
	return Buffer.from(base64, "base64").toString("utf8");
}

// ============================================================================
// Schema Definitions
// ============================================================================

const mintPreviewTokenSchema = z.object({
	path: z.string().min(1, "Path is required"),
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
 * @param secret - Secret key for signing tokens
 * @returns Object with preview functions
 */
export function createPreviewFunctions(secret: string) {
	const signPayload = (payload: string): string => {
		const signature = createHmac("sha256", secret).update(payload).digest();
		return base64UrlEncode(signature);
	};

	/**
	 * Mint a preview token for draft mode access.
	 *
	 * Requires authenticated admin session.
	 * Token contains the target path and expiration time.
	 *
	 * @example
	 * ```ts
	 * const { token } = await client.rpc.mintPreviewToken({
	 *   path: "/pages/about",
	 *   ttlMs: 30 * 60 * 1000, // 30 minutes
	 * });
	 * // Use: /api/preview?token=${token}
	 * ```
	 */
	const mintPreviewToken = fn({
		type: "mutation",
		schema: mintPreviewTokenSchema,
		outputSchema: mintPreviewTokenOutputSchema,
		handler: async ({ input, session }) => {
			// Require authenticated admin session
			if (!session) {
				throw new Error("Unauthorized: Admin session required");
			}

			const { path, ttlMs = DEFAULT_TTL_MS } = input;
			const expiresAt = Date.now() + ttlMs;

			const payload: PreviewTokenPayload = { path, exp: expiresAt };
			const payloadString = JSON.stringify(payload);
			const encodedPayload = base64UrlEncode(payloadString);
			const signature = signPayload(encodedPayload);

			return {
				token: `${encodedPayload}.${signature}`,
				expiresAt,
			};
		},
	});

	/**
	 * Verify a preview token.
	 *
	 * Used by the preview route to validate tokens before setting draft mode cookie.
	 * Does not require authentication (token IS the authentication).
	 *
	 * @example
	 * ```ts
	 * const result = await client.rpc.verifyPreviewToken({ token });
	 * if (result.valid) {
	 *   // Redirect to result.path with draft mode cookie
	 * }
	 * ```
	 */
	const verifyPreviewToken = fn({
		type: "query",
		schema: verifyPreviewTokenSchema,
		outputSchema: verifyPreviewTokenOutputSchema,
		handler: async ({ input }) => {
			const { token } = input;

			const [encodedPayload, signature] = token.split(".");
			if (!encodedPayload || !signature) {
				return { valid: false, error: "Invalid token format" };
			}

			// Verify signature
			const expectedSignature = signPayload(encodedPayload);
			const signatureBuffer = Uint8Array.from(Buffer.from(signature));
			const expectedBuffer = Uint8Array.from(Buffer.from(expectedSignature));

			if (signatureBuffer.length !== expectedBuffer.length) {
				return { valid: false, error: "Invalid signature" };
			}

			if (!timingSafeEqual(signatureBuffer, expectedBuffer)) {
				return { valid: false, error: "Invalid signature" };
			}

			// Parse and validate payload
			try {
				const payload = JSON.parse(
					base64UrlDecode(encodedPayload),
				) as PreviewTokenPayload;

				if (!payload?.exp || typeof payload.exp !== "number") {
					return { valid: false, error: "Invalid payload" };
				}

				if (payload.exp < Date.now()) {
					return { valid: false, error: "Token expired" };
				}

				if (!payload.path || typeof payload.path !== "string") {
					return { valid: false, error: "Invalid path" };
				}

				return { valid: true, path: payload.path };
			} catch {
				return { valid: false, error: "Invalid payload" };
			}
		},
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
export function verifyPreviewTokenDirect(
	token: string,
	secret: string,
): PreviewTokenPayload | null {
	const [encodedPayload, signature] = token.split(".");
	if (!encodedPayload || !signature) return null;

	const expectedSignature = base64UrlEncode(
		createHmac("sha256", secret).update(encodedPayload).digest(),
	);

	const signatureBuffer = Uint8Array.from(Buffer.from(signature));
	const expectedBuffer = Uint8Array.from(Buffer.from(expectedSignature));

	if (signatureBuffer.length !== expectedBuffer.length) return null;
	if (!timingSafeEqual(signatureBuffer, expectedBuffer)) return null;

	try {
		const payload = JSON.parse(
			base64UrlDecode(encodedPayload),
		) as PreviewTokenPayload;

		if (!payload?.exp || typeof payload.exp !== "number") return null;
		if (payload.exp < Date.now()) return null;
		if (!payload.path || typeof payload.path !== "string") return null;

		return payload;
	} catch {
		return null;
	}
}

// ============================================================================
// Factory & Helpers
// ============================================================================

/**
 * Create a preview token verifier with bound secret.
 * Use this in route handlers to avoid passing secret repeatedly.
 *
 * @param secret - The secret used to sign tokens (optional, uses env if not provided)
 * @returns A verify function that only needs the token
 *
 * @example
 * ```ts
 * // Create once at module level
 * const verifyPreviewToken = createPreviewTokenVerifier();
 *
 * // Use in route handler
 * const payload = verifyPreviewToken(token);
 * if (!payload) {
 *   return new Response("Invalid token", { status: 401 });
 * }
 * ```
 */
export function createPreviewTokenVerifier(secret?: string) {
	const resolvedSecret = secret ?? getPreviewSecret();

	return (token: string): PreviewTokenPayload | null => {
		return verifyPreviewTokenDirect(token, resolvedSecret);
	};
}

// ============================================================================
// Preview URL Generation
// ============================================================================

const getPreviewUrlSchema = z.object({
	collection: z.string().min(1, "Collection name is required"),
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
 * const { url } = await client.rpc.getPreviewUrl({
 *   collection: "pages",
 *   record: { slug: "about", title: "About Us" },
 *   locale: "en",
 * });
 * // Returns: "/about?preview=true"
 * ```
 */
export const getPreviewUrl = fn({
	type: "query",
	schema: getPreviewUrlSchema,
	outputSchema: getPreviewUrlOutputSchema,
	handler: async ({ input, app: appInstance, session }) => {
		// Require authenticated admin session
		if (!session) {
			return { url: null, error: "Unauthorized: Admin session required" };
		}

		const { collection: collectionName, record, locale } = input;
		const app = appInstance as Questpie<any>;

		// Get collection from app
		const collections = app.getCollections();
		const collection = collections[collectionName];

		if (!collection) {
			return { url: null, error: `Collection '${collectionName}' not found` };
		}

		// Get preview config from collection state
		const previewConfig = (collection.state as any).adminPreview as
			| PreviewConfig
			| undefined;

		if (!previewConfig?.url) {
			return {
				url: null,
				error: "No preview URL configured for this collection",
			};
		}

		if (previewConfig.enabled === false) {
			return { url: null, error: "Preview is disabled for this collection" };
		}

		try {
			const url = previewConfig.url({ record, locale });
			return { url };
		} catch (err) {
			return {
				url: null,
				error: `Failed to generate preview URL: ${err instanceof Error ? err.message : "Unknown error"}`,
			};
		}
	},
});

// ============================================================================
// Default Functions Bundle
// ============================================================================

/**
 * Default preview functions bundle with env-based secret.
 * Used by adminModule to register preview RPC functions.
 */
export const previewFunctions = {
	...createPreviewFunctions(getPreviewSecret()),
	getPreviewUrl,
};
