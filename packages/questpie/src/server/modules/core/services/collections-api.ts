/**
 * Collections API singleton service definition.
 * Provides typed CRUD access to all registered collections.
 */
import { service } from "#questpie/server/services/define-service.js";

export default service()
	.lifecycle("singleton")
	.namespace(null)
	.create((ctx: any) => {
		const app = ctx.app;
		if (app?.collections) return app.collections;
		if (app?.api?.collections) return app.api.collections;
		return {};
	});
