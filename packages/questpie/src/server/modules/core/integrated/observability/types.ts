/**
 * Observability seam — tracing and metrics interfaces with no-op defaults.
 *
 * `packages/questpie` deliberately has NO `@opentelemetry/*` dependency. These
 * are the minimal shapes a real adapter (`@questpie/observability`) implements,
 * mirroring how `LoggerAdapter` lets Pino be swapped out.
 *
 * The shapes are OTel-compatible on purpose — an adapter should be a thin
 * translation, not a re-modelling — but nothing here names OpenTelemetry, so an
 * app can ship a Datadog or a homegrown adapter just as easily.
 */

/**
 * Attribute values a span or metric can carry. Mirrors OTel's AttributeValue.
 *
 * Arrays must be homogeneous. A mixed `(string | number)[]` is not a valid OTLP
 * attribute and would be dropped or rejected at export time, so allowing it here
 * would only move the failure from compile time to production.
 */
export type ObservabilityAttributeValue =
	| string
	| number
	| boolean
	| string[]
	| number[]
	| boolean[];

export type ObservabilityAttributes = Record<
	string,
	ObservabilityAttributeValue | undefined
>;

/** What a span looks like from the framework's side. */
export interface ObservabilitySpan {
	setAttribute(key: string, value: ObservabilityAttributeValue): void;
	setAttributes(attributes: ObservabilityAttributes): void;
	/** Marks the span failed and records the error. Does NOT end the span. */
	recordError(error: unknown): void;
	addEvent(name: string, attributes?: ObservabilityAttributes): void;
	end(): void;
}

export type SpanKind =
	| "internal"
	| "server"
	| "client"
	| "producer"
	| "consumer";

export interface StartSpanOptions {
	kind?: SpanKind;
	attributes?: ObservabilityAttributes;
}

export interface Tracer {
	/**
	 * Start a span and make it the active parent for the duration of `fn`.
	 *
	 * The callback form is the only one exposed because it is the only one that
	 * cannot leak an unended span, and because it lets the adapter own context
	 * propagation instead of the caller.
	 */
	startActiveSpan<T>(
		name: string,
		options: StartSpanOptions,
		fn: (span: ObservabilitySpan) => T,
	): T;
}

export interface Counter {
	add(value: number, attributes?: ObservabilityAttributes): void;
}

export interface Histogram {
	record(value: number, attributes?: ObservabilityAttributes): void;
}

export interface InstrumentOptions {
	description?: string;
	/** UCUM unit, e.g. "ms", "By", "1". */
	unit?: string;
}

export interface Meter {
	createCounter(name: string, options?: InstrumentOptions): Counter;
	createHistogram(name: string, options?: InstrumentOptions): Histogram;
}

/**
 * What an observability package provides. `shutdown()` must flush — a process
 * that exits without it loses whatever is still batched.
 */
export interface ObservabilityAdapter {
	tracer(name: string): Tracer;
	meter(name: string): Meter;
	/**
	 * Trace and span id of the CURRENTLY ACTIVE span, for correlating logs.
	 *
	 * Optional so an existing adapter keeps compiling, and read through the
	 * adapter because the framework has no OpenTelemetry dependency — only the
	 * adapter can see the active context.
	 *
	 * This is not the same thing as `ctx.traceId`, which the HTTP layer derives
	 * from the incoming `traceparent` (falling back to `x-request-id`). Once an
	 * adapter owns propagation, the SPAN's ids are the ones a backend joins logs
	 * to; the ambient value can differ, and on a request with no inbound header
	 * it is not a trace id at all.
	 */
	activeSpanContext?(): { traceId: string; spanId: string } | undefined;
	shutdown(): Promise<void>;
}

export interface ObservabilityConfig {
	adapter?: ObservabilityAdapter;
}

// ────────────────────────────────────────────────────────────────────────────
// No-op implementations — the default when no adapter is configured.
//
// These exist as frozen singletons rather than fresh objects per call so that
// the disabled path allocates nothing. `span()` on an unconfigured app should
// cost a function call and nothing else.
// ────────────────────────────────────────────────────────────────────────────

const NOOP_SPAN: ObservabilitySpan = Object.freeze({
	setAttribute() {},
	setAttributes() {},
	recordError() {},
	addEvent() {},
	end() {},
});

const NOOP_COUNTER: Counter = Object.freeze({ add() {} });
const NOOP_HISTOGRAM: Histogram = Object.freeze({ record() {} });

const NOOP_TRACER: Tracer = Object.freeze({
	startActiveSpan<T>(
		_name: string,
		_options: StartSpanOptions,
		fn: (span: ObservabilitySpan) => T,
	): T {
		return fn(NOOP_SPAN);
	},
});

const NOOP_METER: Meter = Object.freeze({
	createCounter: () => NOOP_COUNTER,
	createHistogram: () => NOOP_HISTOGRAM,
});

export const noopTracer = NOOP_TRACER;
export const noopMeter = NOOP_METER;
export const noopSpan = NOOP_SPAN;
