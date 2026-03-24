import { service } from "#questpie/server/services/define-service.js";

/**
 * Queue service — exposes the QueueClient instance.
 *
 * Namespace: null (top-level in AppContext as `queue`).
 */
export default service({
	namespace: null,
	lifecycle: "singleton",
	create: ({ queue }) => queue,
});
