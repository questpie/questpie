import { ErrorReportingService } from "#questpie/server/modules/core/integrated/errors/service.js";
import { service } from "#questpie/server/services/define-service.js";

/**
 * Error reporting service — unexpected failures to the configured adapter.
 *
 * Namespace: null (top-level in AppContext as `errors`).
 *
 * Without an adapter `errors.report(...)` returns immediately. Disposal drains
 * pending reports within `shutdownTimeoutMs` before the adapter shuts down;
 * it resolves after observability in `_INFRA_SERVICES`, so it is disposed
 * just before it — after queue and HTTP-facing services stop producing.
 */
export default service({
	namespace: null,
	lifecycle: "singleton",
	create: ({ app }) =>
		new ErrorReportingService(app.config.errors, () =>
			app.observability?.activeSpanContext(),
		),
	dispose: (instance) => (instance as ErrorReportingService)?.shutdown?.(),
});
