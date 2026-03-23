/**
 * Globals API singleton service definition.
 * Provides typed CRUD access to all registered globals.
 */
import { service } from "#questpie/server/services/define-service.js";

export default service()
	.lifecycle("singleton")
	.namespace(null)
	.create((ctx: any) => {
		const app = ctx.app;
		if (app?.globals) return app.globals;
		if (app?.api?.globals) return app.api.globals;
		return {};
	});
