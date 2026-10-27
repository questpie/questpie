import { AsyncLocalStorage } from "node:async_hooks";

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
 * Errors already reported in the current occurrence — one HTTP request or one
 * job attempt. A manual `errors.report(error)` followed by a rethrow reaches
 * the backend once; the same error object failing another request or another
 * attempt is a new occurrence and is reported again. The set dies with the
 * occurrence. Outside any occurrence there is no dedupe: every call reports.
 */
const occurrenceStorage = new AsyncLocalStorage<WeakSet<object>>();

export type ErrorReportOccurrence = WeakSet<object>;

/** Start a new occurrence. Pass the same one again to re-enter it later. */
export function createErrorReportOccurrence(): ErrorReportOccurrence {
	return new WeakSet();
}

/** Run `callback` inside `occurrence` (framework-internal). */
export function runInErrorReportOccurrence<T>(
	occurrence: ErrorReportOccurrence,
	callback: () => T,
): T {
	return occurrenceStorage.run(occurrence, callback);
}

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
	private shutdownPromise: Promise<void> | undefined;

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

	/**
	 * Wait for pending reports and the adapter's buffer, up to `timeoutMs`.
	 * Never rejects, even if the adapter throws.
	 */
	async flush(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<void> {
		const deadline = Date.now() + timeoutMs;
		await withDeadline(Promise.allSettled(this.pending), timeoutMs);
		const adapter = this.config.adapter;
		if (adapter?.flush) {
			const remaining = Math.max(0, deadline - Date.now());
			await withDeadline(
				invoke(() => adapter.flush!(remaining)),
				remaining,
			);
		}
	}

	/**
	 * Stop accepting reports, drain what is pending, and shut the adapter down,
	 * all within `shutdownTimeoutMs`. Reports are refused from the moment this
	 * is called; concurrent and repeated calls share one shutdown. Never
	 * rejects, even if the adapter throws.
	 */
	shutdown(): Promise<void> {
		this.closed = true;
		this.shutdownPromise ??= this.drainAndShutdown();
		return this.shutdownPromise;
	}

	private async drainAndShutdown(): Promise<void> {
		const timeoutMs = this.config.shutdownTimeoutMs ?? DEFAULT_TIMEOUT_MS;
		const deadline = Date.now() + timeoutMs;
		await withDeadline(Promise.allSettled(this.pending), timeoutMs);
		const adapter = this.config.adapter;
		if (adapter?.shutdown) {
			const remaining = Math.max(0, deadline - Date.now());
			await withDeadline(
				invoke(() => adapter.shutdown!(remaining)),
				remaining,
			);
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
		const occurrence = occurrenceStorage.getStore();
		if (
			!occurrence ||
			error === null ||
			(typeof error !== "object" && typeof error !== "function")
		) {
			return false;
		}
		if (occurrence.has(error)) return true;
		occurrence.add(error);
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

/** Call an adapter method; a synchronous throw becomes a rejection. */
function invoke(callback: () => PromiseLike<unknown>): Promise<unknown> {
	return new Promise((resolve) => resolve(callback()));
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
