import { ObservabilityService } from "#questpie/server/modules/core/integrated/observability/service.js";
import { service } from "#questpie/server/services/define-service.js";

/**
 * Observability service — tracing and metrics from app config.
 *
 * Namespace: null (top-level in AppContext as `observability`).
 *
 * With no adapter configured this is a no-op: `observability.span(...)` calls
 * through to the callback and allocates nothing, so framework seams can wrap
 * unconditionally without paying for an unused feature.
 */
export default service({
	namespace: null,
	lifecycle: "singleton",
	create: ({ app }) => new ObservabilityService(app.config.observability),
});
