import { isNativeError, isProxy } from "node:util/types";

import type { ErrorReport, ErrorReportingAdapter } from "questpie/errors";

import {
	buildEvent,
	createDelivery,
	type DeliveryOptions,
} from "./envelope.js";
import { sanitizeError, type SanitizedException } from "./sanitize.js";

export interface SentryServerOptions extends Omit<DeliveryOptions, "tunnel"> {
	/**
	 * Absolute path of the deployed app. Frames in files under it are sent as
	 * `app:///<relative path>`; frames anywhere else keep line and column but
	 * lose their filename.
	 * @default process.cwd()
	 */
	filenameRoot?: string;
	/**
	 * Your own error class names that are safe to send as the exception type
	 * (e.g. `["ApiError"]`). Built-in names (`TypeError`, …) are always sent;
	 * any other name is reported as `Error`.
	 */
	errorNames?: readonly string[];
}

/**
 * Sentry adapter for `runtimeConfig({ errors: { adapter } })`.
 *
 * Error-only: no Sentry client is initialised, so there is no global scope,
 * no auto-instrumentation, no tracing, logs, sessions, replay or breadcrumbs,
 * and no OpenTelemetry provider, propagator or context manager is registered.
 * Your `@questpie/observability` setup is untouched.
 *
 * Without a `dsn` the adapter is a no-op, so it can be wired unconditionally
 * and enabled by environment.
 */
export function sentryErrorReporting(
	options: SentryServerOptions = {},
): ErrorReportingAdapter {
	const delivery = createDelivery(options);
	if (!delivery) return { report() {} };
	const filenameRoot = options.filenameRoot ?? process.cwd();
	const errorNames = new Set(options.errorNames);
	let closed = false;

	return {
		report(error, report) {
			if (closed) return;
			const exceptions: SanitizedException[] =
				error === undefined && report.kind === "returned"
					? [{ type: "HttpServerError", frames: [], rawFilenames: new Map() }]
					: sanitizeError(error, {
							isProxy,
							isNativeError,
							filenameRoot,
							errorNames,
						});
			return delivery.send(
				buildEvent({
					platform: "node",
					exceptions,
					value: describe(report),
					mechanism: `questpie.${report.source}`,
					handled: report.source === "manual" || report.source === "background",
					transaction: transactionOf(report),
					tags: tagsOf(report),
					trace: report.trace,
					release: options.release,
					environment: options.environment,
				}),
			);
		},
		flush: (timeoutMs) => delivery.flush(timeoutMs),
		async shutdown(timeoutMs) {
			closed = true;
			await delivery.flush(timeoutMs);
		},
	};
}

// Built from the validated report only — the error message is never sent.
function describe(report: ErrorReport): string {
	if (report.source === "http") {
		const status = report.status ? `HTTP ${report.status}` : "HTTP error";
		const where = report.route ? ` ${report.method ?? ""} ${report.route}` : "";
		return `${status}${where}${report.kind ? ` (${report.kind})` : ""}`.trim();
	}
	if (report.source === "job") {
		return `Job ${report.job ?? "unknown"} failed${report.final ? " (final attempt)" : ""}`;
	}
	return `${report.source} error`;
}

function transactionOf(report: ErrorReport): string | undefined {
	if (report.route) return `${report.method ?? ""} ${report.route}`.trim();
	if (report.job) return `job ${report.job}`;
	return undefined;
}

function tagsOf(report: ErrorReport): Record<string, string> {
	const tags: Record<string, string> = { "questpie.source": report.source };
	if (report.kind) tags["questpie.kind"] = report.kind;
	if (report.method) tags["http.method"] = report.method;
	if (report.status) tags["http.status_code"] = String(report.status);
	if (report.route) tags["http.route"] = report.route;
	if (report.job) tags["questpie.job"] = report.job;
	if (report.final !== undefined) tags["questpie.final"] = String(report.final);
	return tags;
}
