import { service } from "#questpie/server/services/define-service.js";

/**
 * Collections API service — exposes the typed CRUD API for collections.
 *
 * Namespace: null (top-level in AppContext as `collections`).
 */
export default service({
	namespace: null,
	lifecycle: "singleton",
	create: ({ collections }) => collections,
});
