import { service } from "#questpie/server/services/define-service.js";

/**
 * Realtime service — exposes the RealtimeService instance.
 *
 * Namespace: null (top-level in AppContext as `realtime`).
 */
export default service({
	namespace: null,
	lifecycle: "singleton",
	create: ({ realtime }) => realtime,
});
