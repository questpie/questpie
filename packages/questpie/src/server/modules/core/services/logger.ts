import { service } from "#questpie/server/services/define-service.js";

/**
 * Logger service — exposes the LoggerService instance.
 *
 * Namespace: null (top-level in AppContext as `logger`).
 */
export default service({
	namespace: null,
	lifecycle: "singleton",
	create: ({ logger }) => logger,
});
