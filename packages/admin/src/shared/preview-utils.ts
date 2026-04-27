/**
 * Preview Utilities - Browser-safe
 *
 * Utilities that can run in both browser and server environments.
 * No Node.js dependencies (crypto, etc.)
 */

// ============================================================================
// Constants
// ============================================================================

/**
 * Cookie name for draft mode.
 * Set by /api/preview route, checked by page loaders.
 */
export const DRAFT_MODE_COOKIE = "__draft_mode";

/**
 * Header injected by `createAdminClient` (and `withAdminRequestHeader`) on
 * every admin SPA request. Inspected by {@link isAdminRequest} so access
 * rules can branch on caller intent without depending on URL structure.
 */
export const ADMIN_REQUEST_HEADER = "x-questpie-admin";

/**
 * URL prefix used by the admin SPA when mounted at the conventional
 * `/admin` path. Kept for reference and as a fallback signal for setups
 * that pre-date the header-based detection.
 */
export const ADMIN_API_PREFIX = "/admin/api/";

/**
 * Whether the given request originates from the admin panel.
 *
 * Detection strategy (in order):
 * 1. Presence of the `X-Questpie-Admin` request header — the canonical
 *    signal, injected by `createAdminClient` / `withAdminRequestHeader`.
 * 2. URL path starts with {@link ADMIN_API_PREFIX} — fallback for clients
 *    that don't inject the header (e.g. pre-3.0.6 admin SDK consumers, or
 *    direct `curl` calls to `/admin/api/...`).
 *
 * Use inside collection/global `.access()` rules to grant admin-only
 * scope (e.g. master counselor sees everything in the admin, but stays
 * scoped to their own data on the frontend).
 *
 * @example
 * ```ts
 * import { isAdminRequest } from "@questpie/admin/shared";
 *
 * .access({
 *   read: ({ session, request }) => {
 *     if (isAdminRequest(request) && isAdmin(session?.user)) return true;
 *     return { createdById: session?.user?.id };
 *   },
 * })
 * ```
 */
export function isAdminRequest(request?: Request | null): boolean {
	if (!request) return false;
	if (request.headers?.get?.(ADMIN_REQUEST_HEADER)) return true;
	try {
		return new URL(request.url).pathname.startsWith(ADMIN_API_PREFIX);
	} catch {
		return false;
	}
}

/**
 * Wrap a `fetch` implementation so every outbound request carries the
 * `X-Questpie-Admin` header. Used internally by
 * `createAdminClient` — apps building a custom admin client (or using
 * an alternate HTTP layer) can compose the wrapper themselves.
 *
 * @param baseFetch - The fetch implementation to wrap. Defaults to
 *   `globalThis.fetch`.
 *
 * @example
 * ```ts
 * import { createClient } from "questpie/client";
 * import { withAdminRequestHeader } from "@questpie/admin/shared";
 *
 * export const adminCmsClient = createClient<AppConfig>({
 *   baseURL: window.location.origin,
 *   basePath: "/api",
 *   fetch: withAdminRequestHeader(),
 * });
 * ```
 */
export function withAdminRequestHeader(
	baseFetch: typeof fetch = globalThis.fetch,
): typeof fetch {
	return ((input, init) => {
		const headers = new Headers(init?.headers);
		if (!headers.has(ADMIN_REQUEST_HEADER)) {
			headers.set(ADMIN_REQUEST_HEADER, "1");
		}
		return baseFetch(input, { ...init, headers });
	}) as typeof fetch;
}

// ============================================================================
// Browser-Safe Utilities
// ============================================================================

/**
 * Check if draft mode is enabled from cookie header.
 *
 * @param cookieHeader - The Cookie header value from request
 * @returns true if draft mode cookie is present and set to "true"
 *
 * @example
 * ```ts
 * const isDraft = isDraftMode(request.headers.get("cookie"));
 * const page = await app.pages.findOne({
 *   where: isDraft ? { slug } : { slug, isPublished: true }
 * });
 * ```
 */
export function isDraftMode(cookieHeader: string | null | undefined): boolean {
	if (!cookieHeader) return false;
	return cookieHeader.includes(`${DRAFT_MODE_COOKIE}=true`);
}

/**
 * Create Set-Cookie header value for draft mode.
 *
 * @param enabled - Whether to enable or disable draft mode
 * @param maxAge - Cookie max age in seconds (default: 1 hour)
 * @returns Set-Cookie header value
 *
 * @example
 * ```ts
 * // Enable draft mode
 * headers.set("Set-Cookie", createDraftModeCookie(true));
 *
 * // Disable draft mode
 * headers.set("Set-Cookie", createDraftModeCookie(false));
 * ```
 */
export function createDraftModeCookie(enabled: boolean, maxAge = 3600): string {
	if (enabled) {
		return `${DRAFT_MODE_COOKIE}=true; Path=/; Max-Age=${maxAge}; SameSite=Lax; HttpOnly`;
	}
	// Delete cookie by setting Max-Age=0
	return `${DRAFT_MODE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly`;
}

/**
 * Get preview secret from environment variables.
 * Falls back to SECRET if PREVIEW_SECRET is not set.
 *
 * @returns The preview secret
 */
export function getPreviewSecret(): string {
	const secret =
		process.env.PREVIEW_SECRET || process.env.SECRET || "dev-preview-secret";

	if (
		process.env.NODE_ENV === "production" &&
		secret === "dev-preview-secret"
	) {
		console.warn(
			"[preview] Using default secret in production. Set PREVIEW_SECRET or SECRET env var.",
		);
	}

	return secret;
}
