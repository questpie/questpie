import { service } from "#questpie/server/services/define-service.js";

/**
 * Search service — exposes the SearchService instance.
 *
 * Namespace: null (top-level in AppContext as `search`).
 */
export default service({
	namespace: null,
	lifecycle: "singleton",
	create: ({ search }) => search,
});
