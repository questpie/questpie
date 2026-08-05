import { extractAppServices } from "#questpie/server/config/app-context.js";
import type { RequestContext } from "#questpie/server/config/context.js";
import type { Questpie } from "#questpie/server/config/questpie.js";

import type { ChannelServiceContext } from "./service.js";

/**
 * Build the context a channel `authorize` / `presence` rule runs in.
 *
 * `ChannelOperationContext` is `AppContext & { params }`, so rules legitimately
 * read `collections`, `globals`, `services`, `kv`, ... . Nothing hands them that
 * surface for free: `app.createContext()` returns the LEAN `RequestContext`
 * (session, locale, accessMode, db, principal, resolved context extensions), and
 * every path that runs user code folds the service surface in itself —
 * `executeRoute` for route handlers, `executeAccessRule` for collection access.
 *
 * The SSE endpoint has no route handler and no access rule, so it must fold the
 * surface in here. Before this existed it passed the bare `RequestContext`
 * straight through, so `context.collections` was `undefined` and any rule that
 * touched it threw — which the service then reported as a plain denial.
 *
 * `accessMode` is pinned to `"user"`: these are client-originated subscribe and
 * publish requests, and the rule must never be evaluated as the system actor.
 */
export function createChannelServiceContext(
	app: Questpie<any>,
	context: RequestContext,
): ChannelServiceContext {
	const services = extractAppServices(app, {
		db: context.db ?? app.db,
		session: context.session,
		locale: context.locale,
		accessMode: "user",
		principal: context.principal,
		actor: context.actor,
	});
	return {
		...services,
		// The request context wins over the service surface for the keys they
		// share (db/session/locale/principal): it is the request's own identity.
		...context,
		accessMode: "user",
	} as ChannelServiceContext;
}
