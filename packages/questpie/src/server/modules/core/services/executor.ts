import { ExecutorService } from "#questpie/server/modules/core/integrated/executor/service.js";
import { service } from "#questpie/server/services/define-service.js";

/**
 * Executor service — creates the ExecutorService from app config.
 *
 * Namespace: null (top-level in AppContext as `executor`).
 * Opt-in: when `app.config.executor` is undefined the service is constructed
 * disabled and any `executor.run` call throws a clear error.
 */
export default service({
	namespace: null,
	lifecycle: "singleton",
	create: ({ app }) => new ExecutorService(app.config.executor),
});
