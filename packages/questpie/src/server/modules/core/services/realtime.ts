import { service } from "#questpie/server/services/define-service.js";
import { RealtimeService } from "#questpie/server/modules/core/integrated/realtime/service.js";

/**
 * Realtime service — creates the RealtimeService from app config.
 *
 * Depends on: db (resolved via service container).
 * Namespace: null (top-level in AppContext as `realtime`).
 */
export default service({
	namespace: null,
	lifecycle: "singleton",
	create: ({ app }) => {
		const realtime = new RealtimeService(
			// Widen — RealtimeService takes the general client type; the generated
			// `app.db` is narrowed to the app's concrete drizzle schema.
			app.db as any,
			app.config.realtime,
			app._pgConnectionString,
			app.logger,
		);

		// Set subscription context for dependency resolution
		realtime.setSubscriptionContext({
			resolveCollectionDependencies: (baseCollection, withConfig) => {
				return app._resolveCollectionDependencies(baseCollection, withConfig);
			},
			resolveGlobalDependencies: (globalName, withConfig) => {
				return app._resolveGlobalDependencies(globalName, withConfig);
			},
		});

		return realtime;
	},
	dispose: (instance) => instance.destroy(),
});
