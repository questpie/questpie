import { service } from "#questpie/server/services/define-service.js";

/**
 * Storage service — exposes the DriveManager (flydrive) instance.
 *
 * Namespace: null (top-level in AppContext as `storage`).
 */
export default service({
	namespace: null,
	lifecycle: "singleton",
	create: ({ storage }) => storage,
});
