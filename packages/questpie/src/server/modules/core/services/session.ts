/**
 * Session scoped service — resolves current user session per request.
 *
 * - With request: async resolves via auth API (returns Promise<Session | null>)
 * - Without request (job/script): returns null (sync)
 *
 * Callers use `await ctx.session` when in HTTP scope.
 */
import { service } from "#questpie/server/services/define-service.js";

export default service()
	.lifecycle("request")
	.namespace(null)
	.create((ctx: any) => {
		if (ctx.request && ctx.auth?.api?.getSession) {
			return ctx.auth.api.getSession({ headers: ctx.request.headers }).then(
				(result: any) => result ?? null,
			).catch(() => null);
		}
		return null;
	});
