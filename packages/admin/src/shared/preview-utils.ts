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
 * const page = await cms.pages.findOne({
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
