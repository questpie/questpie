/**
 * Mint a short-lived `x-miniapp-token` for the KnowledgeHost bridge.
 *
 * `POST /api/apps/{appId}/token` — called by the TRUSTED parent KnowledgeHost (an
 * authenticated admin, `sessionOnly`) BEFORE it mounts the iframe. It resolves the
 * `.app` to read the app's opt-in action surface, then mints a token bound to
 * `{appId, sessionId, userId}` whose action allowlist is exactly the app's
 * registered actions plus the two fs pseudo-actions. The parent attaches the
 * returned token to every bridged call the untrusted iframe asks it to proxy.
 *
 * The token is NOT the v1 broker token (`x-questpie-sandbox-token`, supervisor-
 * internal + SENSITIVE-stripped). It lives in the browser, so it is bound tighter
 * than `sessionOnly` — see `apps/mini-app-token.ts` for the rationale.
 *
 * Design: `.private/miniapps-v2-design.md` §3.3.
 *
 * The literal `token` segment takes trie priority over `apps/[appId]/[fn]` (the
 * matcher resolves literal > parameterized), so a guest action can never shadow
 * this mint endpoint.
 */

import { ApiError } from "questpie/errors";
import { route } from "questpie/services";

import {
	type AppResolverCollections,
	resolveApp,
} from "../../../apps/app-resolver";
import {
	MINIAPP_FS_READ_ACTION,
	MINIAPP_FS_WRITE_ACTION,
	mintMiniAppToken,
	resolveMiniAppTokenSecret,
} from "../../../apps/mini-app-token";
import { sessionOnly } from "../../../lib/route-access";

type TokenRouteContext = Questpie.AppContext & {
	request: Request;
	params: { appId: string };
	session?: {
		user?: { id?: string | null } | null;
		session?: { id?: string | null } | null;
	} | null;
	app: { config?: { secret?: string } };
};

export default route()
	.post()
	.access(sessionOnly)
	.params<{ appId: string }>()
	.raw()
	.handler(async (ctx) => {
		const c = ctx as TokenRouteContext;
		const { appId } = c.params;

		// `sessionOnly` already guaranteed a non-empty user id; read both ids that
		// bind the token. The session id (better-auth `session.session.id`) makes
		// the token follow the LIVE session — a stale/rotated session won't match.
		const userId = c.session?.user?.id ?? "";
		const sessionId = c.session?.session?.id ?? "";
		if (!userId || !sessionId) {
			// Defensive: the access rule checks user id, not session id. A request
			// with a user but no resolvable session id cannot be bound — reject.
			throw ApiError.unauthorized("No bindable session for mini-app token");
		}

		// Resolve the app so the token's action allowlist is exactly the app's
		// registered (opt-in) actions — a token minted here can never authorize an
		// action the app does not expose. Resolution also rejects an unknown app.
		const resolved = await resolveApp(
			appId,
			c.collections as unknown as AppResolverCollections,
		);
		const actions = [
			...resolved.endpoints.map((e) => e.name),
			MINIAPP_FS_READ_ACTION,
			MINIAPP_FS_WRITE_ACTION,
		];

		const secret = resolveMiniAppTokenSecret(c.app);
		const { token, claims } = mintMiniAppToken(secret, {
			appId,
			sessionId,
			userId,
			actions,
		});

		return Response.json({
			token,
			expiresAt: claims.exp,
			actions: claims.actions,
			// The app's validated `manifest.net` egress — the parent uses it as the
			// iframe CSP `connect-src` (the app's OWN data egress; NEVER `script-src`).
			// Resolved + zod-validated server-side so the client never parses the
			// untrusted inline manifest.
			net: resolved.manifest.capabilities.net ?? [],
		});
	});
