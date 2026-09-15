import type { BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** A redirect Better Auth accepts for a `web` client: https on a non-loopback host. */
function isWebRedirect(uri: unknown): boolean {
	if (typeof uri !== "string") return false;
	try {
		const url = new URL(uri);
		return url.protocol === "https:" && !LOOPBACK_HOSTS.has(url.hostname);
	} catch {
		return false;
	}
}

/**
 * MCP clients that run on the user's machine (Claude Code, Cursor, IDE
 * extensions) self-register with an `http://localhost:<port>/callback` or a
 * private-use scheme redirect and no `application_type`. Better Auth 1.7
 * defaults a dynamic registration to `web`, and a web client may only use
 * https non-loopback redirects, so those clients could no longer connect.
 *
 * A type-less registration carrying any redirect a web client may not use is
 * registered as `native` (RFC 8252). `application_type` only selects which
 * redirect rules Better Auth applies, and native rules still reject every
 * unsafe form (non-exact loopback hosts, https loopback, malformed private-use
 * schemes), so this opens nothing. An explicit type is always kept, and a
 * registration whose redirects are all web-valid stays `web`.
 *
 * @internal
 */
export function createOAuthNativeLoopbackRegistrationPlugin(): BetterAuthPlugin {
	return {
		id: "questpie-oauth-native-loopback-registration",
		hooks: {
			before: [
				{
					matcher: (context) => context.path === "/oauth2/register",
					handler: createAuthMiddleware(async (context) => {
						const body = context.body as Record<string, unknown> | undefined;
						if (!body || body.application_type !== undefined) return;
						const redirects = body.redirect_uris;
						if (!Array.isArray(redirects) || redirects.every(isWebRedirect)) {
							return;
						}
						return {
							context: { body: { ...body, application_type: "native" } },
						};
					}),
				},
			],
		},
	};
}
