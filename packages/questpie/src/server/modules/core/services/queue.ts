import { createQueueClient } from "#questpie/server/modules/core/integrated/queue/service.js";
import { service } from "#questpie/server/services/define-service.js";

/**
 * Queue service — creates the QueueClient from app config.
 *
 * Depends on: logger (resolved via service container).
 * Namespace: null (top-level in AppContext as `queue`).
 */
export default service({
	namespace: null,
	lifecycle: "singleton",
	create: ({ app }) => {
		const config = app.config;

		if (!config.queue) {
			return {}; // Empty queue client if no jobs defined
		}

		if (!config.queue.adapter) {
			throw new Error(
				"QUESTPIE: Queue adapter is required when jobs are defined. Provide adapter in .build({ queue: { adapter: ... } })",
			);
		}

		return createQueueClient(config.queue.jobs, config.queue.adapter, {
			createContext: async () => app.createContext({ accessMode: "system" }),
			getDatabase: () => app.db,
			getApp: () => app,
			logger: app.logger,
			secret: app.config.secret,
		});
	},
	dispose: (instance) => (instance as any)?.stop?.(),
});
