import { service } from "#questpie/server/services/define-service.js";

/**
 * Key-value store service — exposes the KVService instance.
 *
 * Namespace: null (top-level in AppContext as `kv`).
 */
export default service({
	namespace: null,
	lifecycle: "singleton",
	create: ({ kv }) => kv,
});
