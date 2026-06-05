import type { RouteAccessContext, RouteAccessRule } from "questpie/services";
import type { RequestContext } from "questpie/types";

import {
	MINIAPP_TOKEN_HEADER,
	resolveMiniAppTokenSecret,
	verifyMiniAppToken,
} from "../apps/mini-app-token";

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

export const sessionOnly: RouteAccessRule = ({ session }) => {
	const auth = session as RequestContext["session"];
	return isNonEmptyString(auth?.user?.id);
};

/**
 * The mini-app BRIDGE access policy — strictly tighter than {@link sessionOnly}.
 *
 * `.private/miniapps-v2-design.md` §3.3: the named-action route + the fs route are
 * cookie-auth POST endpoints the untrusted iframe reaches via the parent's proxy.
 * "Some admin is logged in" (`sessionOnly`) is NOT enough — the request MUST also
 * carry a valid `x-miniapp-token` that BINDS the caller to `{appId, action,
 * session, user}`. This factory produces an access rule that:
 *   1. requires an authenticated session (the same baseline as `sessionOnly`), AND
 *   2. requires + verifies the `x-miniapp-token` against the route's `{appId}`
 *      (from `params`), the run's `{userId, sessionId}` (from `session`), and the
 *      requested `action` (resolved per-route — the named action for `[fn]`, the
 *      `fs:read`/`fs:write` pseudo-action for the fs route).
 *
 * CSRF: the token rides a non-cookie header an attacker's cross-origin form/script
 * cannot set, so requiring it (atop the SameSite session cookie) blocks the
 * cross-origin POST. ORIGIN is ALSO validated parent-side on every postMessage
 * (`miniapp-bridge.ts`); the token — not the (null) sandbox origin — is the real
 * authenticator server-side.
 *
 * Fails closed: a missing/expired/forged/mismatched token → access denied (403),
 * never a fallback to "logged in is enough".
 *
 * @param resolveAction - derive the action name being authorized from the route
 *   ctx (e.g. `(c) => c.params.fn` for the named-action route, or a fixed
 *   `fs:read`/`fs:write` keyed off the HTTP method for the fs route).
 */
export function miniAppTokenAccess(
	resolveAction: (ctx: RouteAccessContext) => string | undefined,
): RouteAccessRule {
	return (ctx) => {
		const auth = ctx.session as RequestContext["session"];
		const userId = auth?.user?.id;
		const sessionId = (
			auth as { session?: { id?: string | null } | null } | null | undefined
		)?.session?.id;
		if (!isNonEmptyString(userId) || !isNonEmptyString(sessionId)) return false;

		const appId = ctx.params?.appId;
		if (!isNonEmptyString(appId)) return false;

		const token = ctx.request?.headers.get(MINIAPP_TOKEN_HEADER);
		if (!isNonEmptyString(token)) return false;

		let secret: string;
		try {
			secret = resolveMiniAppTokenSecret(
				(ctx as { app?: { config?: { secret?: string } } }).app ?? {},
			);
		} catch {
			// No signing secret configured → the bridge is unavailable; deny.
			return false;
		}

		const result = verifyMiniAppToken(secret, token, {
			appId,
			userId,
			sessionId,
			action: resolveAction(ctx),
		});
		return result.ok;
	};
}

/** Map an fs-route request to its pseudo-action by HTTP method. */
export function fsPseudoAction(
	ctx: RouteAccessContext,
): "fs:read" | "fs:write" | undefined {
	const method = ctx.request?.method?.toUpperCase();
	if (method === "GET" || method === "HEAD") return "fs:read";
	if (method === "PUT" || method === "POST" || method === "PATCH") {
		return "fs:write";
	}
	// DELETE / unknown — no fs pseudo-action defined; deny via the wildcard-only
	// path (the token must then carry `*`).
	return undefined;
}
