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
	// Without this, destroy() skips the service entirely (it iterates
	// _INFRA_SERVICES and `continue`s on anything with no dispose), so an
	// exporter batching over an OTLP endpoint loses whatever is still queued.
	// The adapter contract says as much: "shutdown() must flush - a process that
	// exits without it loses whatever is still batched."
	//
	// Disposal walks _INFRA_SERVICES in reverse, and observability sits in
	// tier 0, so it is torn down second-to-last: db, queue, realtime and search
	// have all finished emitting their closing spans by the time it flushes.
	dispose: (instance) => (instance as ObservabilityService)?.shutdown?.(),
});
