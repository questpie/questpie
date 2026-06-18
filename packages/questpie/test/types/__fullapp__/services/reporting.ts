/**
 * Full-app gate fixture — a service whose `create((ctx) => …)` references the
 * app `ctx` (`ServiceCreateContext` → `AppContext`). This is the §2.2 asymmetry:
 * a `services` member VALUE carries an `AppContext` back-reference. Shipped by a
 * fixture module (see ../modules.ts) so that folding module `services` over
 * `typeof _modules` is genuinely cyclic — the acceptance probe (`_ModuleServices
 * = ExtractModulePropArr<typeof _modules, "services">`) turns the gate RED.
 */
import { service } from "#questpie/server/services/define-service.js";

export const reportingService = service({
	create: (ctx) => ({
		async countArticles() {
			// Touch the app context surface so this service VALUE carries the
			// AppContext back-reference that makes a module-services fold cyclic.
			return ctx.collections.articles.count({});
		},
	}),
});

export default reportingService;
