import type { WorkflowLogger, WorkflowLogLevel } from "questpie";

/**
 * Create a dual-output workflow logger.
 *
 * Every log call writes to:
 * 1. The `wf_log` collection (queryable in admin UI)
 * 2. The external logger (Datadog, Grafana, etc.)
 *
 * DB writes are fire-and-forget to avoid blocking workflow execution.
 * Logging failures are silently swallowed — logging must never break the workflow.
 */
export function createWorkflowLogger(
	instanceId: string,
	app: any,
	stepName?: string,
): WorkflowLogger {
	const write = (
		level: WorkflowLogLevel,
		message: string,
		data?: unknown,
	) => {
		const prefix = `[wf:${instanceId}${stepName ? `:${stepName}` : ""}]`;

		// 1. External logger (synchronous call, logger buffers internally)
		if (app.logger?.[level]) {
			app.logger[level](`${prefix} ${message}`, data);
		}

		// 2. DB write (fire-and-forget, non-blocking)
		const collections = app.api?.collections;
		if (collections?.wf_log) {
			collections.wf_log
				.create(
					{
						instanceId,
						level,
						message,
						data: data !== undefined ? data : null,
						stepName: stepName ?? null,
					},
					{ accessMode: "system" },
				)
				.catch(() => {
					/* swallow — logging must not break execution */
				});
		}
	};

	return {
		debug: (message: string, data?: unknown) => write("debug", message, data),
		info: (message: string, data?: unknown) => write("info", message, data),
		warn: (message: string, data?: unknown) => write("warn", message, data),
		error: (message: string, data?: unknown) => write("error", message, data),
	};
}

/**
 * Create a scoped logger for a specific step within a workflow.
 * Returns a new logger with the step name attached to all output.
 */
export function scopeLogger(
	logger: WorkflowLogger,
	instanceId: string,
	app: any,
	stepName: string,
): WorkflowLogger {
	return createWorkflowLogger(instanceId, app, stepName);
}
