import { createFilesStorage } from "#questpie/server/modules/core/integrated/storage/create-driver.js";
import { service } from "#questpie/server/services/define-service.js";

/**
 * Storage service — creates the direct Files SDK-backed storage instance.
 *
 * Namespace: null (top-level in AppContext as `storage`).
 */
export default service({
	namespace: null,
	lifecycle: "singleton",
	create: ({ app }) => createFilesStorage(app.config),
});
