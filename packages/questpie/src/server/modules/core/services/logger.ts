import { service } from "#questpie/server/services/define-service.js";
import { LoggerService } from "#questpie/server/modules/core/integrated/logger/service.js";

/**
 * Logger service — creates the LoggerService from app config.
 *
 * Namespace: null (top-level in AppContext as `logger`).
 */
export default service({
	namespace: null,
	lifecycle: "singleton",
	create: ({ app }) => new LoggerService(app.config.logger),
});
