import { service } from "#questpie/server/services/define-service.js";

/**
 * Globals API service — exposes the typed CRUD API for globals.
 *
 * Namespace: null (top-level in AppContext as `globals`).
 */
export default service({
	namespace: null,
	lifecycle: "singleton",
	create: ({ globals }) => globals,
});
