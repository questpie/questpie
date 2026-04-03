import { service } from "#questpie/server/services/define-service.js";
import { KVService } from "#questpie/server/modules/core/integrated/kv/service.js";

/**
 * Key-value store service — creates the KVService from app config.
 *
 * Namespace: null (top-level in AppContext as `kv`).
 */
export default service({
	namespace: null,
	lifecycle: "singleton",
	create: ({ app }) => new KVService(app.config.kv),
});
