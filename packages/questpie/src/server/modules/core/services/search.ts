import { service } from "#questpie/server/services/define-service.js";
import { createSearchService } from "#questpie/server/modules/core/integrated/search/service.js";

/**
 * Search service — creates the SearchService from app config.
 *
 * Depends on: db, logger (resolved via service container).
 * Namespace: null (top-level in AppContext as `search`).
 */
export default service({
	namespace: null,
	lifecycle: "singleton",
	create: ({ app }) => {
		const search = createSearchService(
			app.config.search,
			app.db,
			app.logger,
		);

		// Initialize search adapter asynchronously (lazy init on first use)
		search.initialize().catch((err: unknown) => {
			app.logger.error(
				"[QUESTPIE] Failed to initialize search adapter:",
				err,
			);
		});

		return search;
	},
});
