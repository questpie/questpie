import {
	assertPostgres13ForRealtimeTxid,
	QUESTPIE_SCHEMA_INTROSPECTION_ENV,
} from "#questpie/server/db/postgres-version.js";
import { RealtimeService } from "#questpie/server/modules/core/integrated/realtime/service.js";
import { service } from "#questpie/server/services/define-service.js";
import { getEnv } from "#questpie/server/utils/env.js";

/**
 * Realtime service — creates the RealtimeService from app config.
 *
 * Depends on: db (resolved via service container).
 * Namespace: null (top-level in AppContext as `realtime`).
 */
export default service({
	namespace: null,
	lifecycle: "singleton",
	create: async ({ app }) => {
		await assertPostgres13ForRealtimeTxid(app.db);
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
			resolveCollectionRelationNames: (baseCollection) =>
				new Set(
					Object.keys(
						(app.getCollections() as Record<string, any>)[baseCollection]?.state
							.relations ?? {},
					),
				),
			resolveGlobalDependencies: (globalName, withConfig) => {
				return app._resolveGlobalDependencies(globalName, withConfig);
			},
		});
		if (getEnv(QUESTPIE_SCHEMA_INTROSPECTION_ENV) !== "1") {
			await realtime.initialize();
		}

		return realtime;
	},
	dispose: (instance) => instance.destroy(),
});
