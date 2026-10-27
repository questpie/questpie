import type {
	ErrorReport,
	ErrorReportInfo,
	ErrorReportingConfig,
	ErrorReportKind,
	ErrorReportSource,
} from "./types.js";

const DEFAULT_MAX_PENDING = 100;
const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * The same error object reported again within this window is dropped, so a
 * manual `errors.report(error)` followed by a rethrow does not reach the
 * backend twice. Two rotating WeakSets bound it in time without holding the
 * error alive — a single WeakSet kept for the life of the process would
 * silently swallow a long-lived error object thrown again hours later.
 */
const DEDUPE_WINDOW_MS = 60_000;

const SOURCES = new Set<ErrorReportSource>([
	"http",
	"job",
	"background",
	"manual",
]);
const KINDS = new Set<ErrorReportKind>(["thrown", "returned", "stream"]);
const METHODS = new Set([
	"GET",
	"HEAD",
	"POST",
	"PUT",
	"PATCH",
	"DELETE",
	"OPTIONS",
	"CONNECT",
	"TRACE",
]);
const ROUTE_PATTERN = /^[A-Za-z0-9_\-./:*[\]{}]{0,256}$/;
const JOB_PATTERN = /^[A-Za-z0-9_\-.:/]{1,128}$/;
const TRACE_ID = /^[0-9a-f]{32}$/;
const SPAN_ID = /^[0-9a-f]{16}$/;

/**
 * Error reporting service — hands unexpected failures to the configured
 * adapter, or does nothing.
 *
 * `report()` never throws, never awaits and never changes what the caller does
 * next: delivery runs detached, bounded by `maxPending` and `timeoutMs`, and is
 * drained by `shutdown()` within `shutdownTimeoutMs`.
 */
export class ErrorReportingService {
	private readonly config: ErrorReportingConfig;
	private readonly getActiveSpan: () =>
		| { traceId: string; spanId: string }
		| undefined;
	private readonly pending = new Set<Promise<void>>();
	private closed = false;
	private recent = new WeakSet<object>();
	private previous = new WeakSet<object>();
	private rotatedAt = Date.now();

	constructor(
		config: ErrorReportingConfig = {},
		getActiveSpan: () => { traceId: string; spanId: string } | undefined = () =>
			undefined,
	) {
		this.config = config;
		this.getActiveSpan = getActiveSpan;
	}

	/** True when an adapter is configured and the service is not shut down. */
	get enabled(): boolean {
		return Boolean(this.config.adapter) && !this.closed;
	}

	/**
	 * Report an unexpected failure. `info` is validated down to its documented
	 * fields; anything else is ignored.
	 */
	report(error: unknown, info: ErrorReportInfo): void {
		const adapter = this.config.adapter;
		if (!adapter || this.closed) return;
		try {
			if (this.alreadyReported(error)) return;
			if (this.pending.size >= (this.config.maxPending ?? DEFAULT_MAX_PENDING))
				return;
			const result = adapter.report(error, this.normalize(info));
			if (result && typeof (result as Promise<unknown>).then === "function") {
				this.track(result as Promise<unknown>);
			}
		} catch {
			// Reporting must never change the outcome of the failure it reports.
		}
	}

	/** Wait for pending reports and the adapter's buffer, up to `timeoutMs`. */
	async flush(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<void> {
		const deadline = Date.now() + timeoutMs;
		await withDeadline(Promise.allSettled(this.pending), timeoutMs);
		const adapter = this.config.adapter;
		if (adapter?.flush) {
			await withDeadline(
				adapter.flush(Math.max(0, deadline - Date.now())),
				Math.max(0, deadline - Date.now()),
			);
		}
	}

	/** Stop accepting reports, drain, and shut the adapter down. Idempotent. */
	async shutdown(): Promise<void> {
		if (this.closed) return;
		const timeoutMs = this.config.shutdownTimeoutMs ?? DEFAULT_TIMEOUT_MS;
		const deadline = Date.now() + timeoutMs;
		await withDeadline(Promise.allSettled(this.pending), timeoutMs);
		this.closed = true;
		const adapter = this.config.adapter;
		if (adapter?.shutdown) {
			const remaining = Math.max(0, deadline - Date.now());
			await withDeadline(adapter.shutdown(remaining), remaining);
		}
	}

	private track(result: Promise<unknown>): void {
		const settled: Promise<void> = withDeadline(
			result,
			this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		).then(() => {
			this.pending.delete(settled);
		});
		this.pending.add(settled);
	}

	private alreadyReported(error: unknown): boolean {
		if (
			error === null ||
			(typeof error !== "object" && typeof error !== "function")
		) {
			return false;
		}
		const now = Date.now();
		const elapsed = now - this.rotatedAt;
		if (elapsed >= DEDUPE_WINDOW_MS) {
			this.previous =
				elapsed >= DEDUPE_WINDOW_MS * 2 ? new WeakSet() : this.recent;
			this.recent = new WeakSet();
			this.rotatedAt = now;
		}
		if (this.recent.has(error) || this.previous.has(error)) return true;
		this.recent.add(error);
		return false;
	}

	private normalize(info: ErrorReportInfo): ErrorReport {
		const report: ErrorReport = {
			source: SOURCES.has(info?.source) ? info.source : "manual",
		};
		if (info?.kind && KINDS.has(info.kind)) report.kind = info.kind;
		if (typeof info?.method === "string") {
			const method = info.method.toUpperCase();
			report.method = METHODS.has(method) ? method : "OTHER";
		}
		if (typeof info?.route === "string" && ROUTE_PATTERN.test(info.route)) {
			report.route = info.route;
		}
		if (
			Number.isInteger(info?.status) &&
			(info.status as number) >= 100 &&
			(info.status as number) <= 599
		) {
			report.status = info.status;
		}
		if (typeof info?.job === "string" && JOB_PATTERN.test(info.job)) {
			report.job = info.job;
		}
		if (typeof info?.final === "boolean") report.final = info.final;

		const span = this.getActiveSpan();
		if (
			span &&
			typeof span.traceId === "string" &&
			typeof span.spanId === "string" &&
			TRACE_ID.test(span.traceId) &&
			SPAN_ID.test(span.spanId)
		) {
			report.trace = { traceId: span.traceId, spanId: span.spanId };
		}
		return report;
	}
}

/** Resolve when `promise` settles or `timeoutMs` passes; never rejects. */
function withDeadline(
	promise: PromiseLike<unknown>,
	timeoutMs: number,
): Promise<void> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	return Promise.race([
		Promise.resolve(promise).then(
			() => {},
			() => {},
		),
		new Promise<void>((resolve) => {
			timer = setTimeout(resolve, timeoutMs);
			(timer as { unref?: () => void }).unref?.();
		}),
	]).finally(() => clearTimeout(timer));
}
