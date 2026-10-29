/**
 * Error reporting seam — provider-neutral, no-op by default.
 *
 * This is deliberately NOT built on the observability span: spans are sampled,
 * nested (one failure is recorded by every enclosing span) and carry the error
 * message as status. An incident report needs the opposite — exactly one
 * report per unexpected failure, independent of tracing, with nothing attached
 * that the framework cannot vouch for.
 *
 * The raw error stays inside the process. The adapter decides what of it may
 * leave, and `info` is a closed, validated shape: no request, session, payload,
 * URL, identifiers or free-form metadata.
 */

/**
 * Where the failure was observed. `process` is an uncaught exception or
 * unhandled rejection that is about to end the process.
 */
export type ErrorReportSource =
	| "http"
	| "job"
	| "background"
	| "manual"
	| "process";

/**
 * How an HTTP failure surfaced.
 *
 * - `thrown`: the handler or context resolution threw and the response is 5xx.
 * - `returned`: the handler returned a 5xx without throwing. There is no
 *   original error and no stack; the adapter receives `undefined`.
 * - `stream`: the response body failed after the response was handed out.
 */
export type ErrorReportKind = "thrown" | "returned" | "stream";

export interface ErrorReportInfo {
	source: ErrorReportSource;
	kind?: ErrorReportKind;
	/** HTTP method. Non-standard methods are reported as `OTHER`. */
	method?: string;
	/**
	 * Matched route TEMPLATE (e.g. `collections/:collection`), never a raw path.
	 * Only the character set and the absence of a URL scheme or host can be
	 * checked here: a raw path such as `invite/abc123` passes, so pass a template.
	 */
	route?: string;
	/** HTTP status code. */
	status?: number;
	/** Static job definition name. Never a dispatch or idempotency id. */
	job?: string;
	/** For jobs: true when the adapter will not retry this failure. */
	final?: boolean;
}

/**
 * Validated `info` as delivered to the adapter, plus correlation the framework
 * adds itself when — and only when — an observability adapter has a span open.
 */
export interface ErrorReport extends ErrorReportInfo {
	trace?: { traceId: string; spanId: string };
}

/**
 * What an error reporting package implements (e.g. `@questpie/sentry`).
 *
 * `report` is called synchronously at the failure site and must not throw;
 * if it does, or rejects, the failure is swallowed — reporting can never change
 * a response, a retry or an ack. Return a promise for asynchronous delivery so
 * the framework can bound and drain it.
 */
export interface ErrorReportingAdapter {
	report(error: unknown, report: ErrorReport): void | Promise<unknown>;
	/** Deliver everything buffered within `timeoutMs`. */
	flush?(timeoutMs: number): Promise<unknown>;
	/** Flush and release resources. Called once, on app destroy. */
	shutdown?(timeoutMs: number): Promise<unknown>;
}

export interface ErrorReportingConfig {
	adapter?: ErrorReportingAdapter;
	/**
	 * Maximum reports awaiting delivery. Further reports are dropped until
	 * one settles, so an incident storm cannot grow memory without bound.
	 * @default 100
	 */
	maxPending?: number;
	/**
	 * How long one report may stay pending before its slot is released.
	 * @default 5000
	 */
	timeoutMs?: number;
	/**
	 * Upper bound for draining pending reports and shutting the adapter down
	 * in `app.destroy()`.
	 * @default 5000
	 */
	shutdownTimeoutMs?: number;
}
