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

/** Recursive canonical values accepted by the OpenTelemetry Logs AnyValueMap. */
export type ObservabilityLogValue =
	| string
	| number
	| boolean
	| null
	| ObservabilityLogValue[]
	| ObservabilityLogAttributes;

export interface ObservabilityLogAttributes {
	[key: string]: ObservabilityLogValue;
}

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
	/**
	 * Inbound propagation headers, for a span that continues someone else's
	 * trace rather than starting one.
	 *
	 * Pass the request headers at the HTTP root and nowhere else — every other
	 * span nests through the active context automatically. The framework cannot
	 * parse `traceparent` into a parent itself (no OpenTelemetry dependency, and
	 * W3C is only one of several formats an adapter might accept), so the raw
	 * carrier goes to the adapter and it decides.
	 *
	 * Ignored by adapters that do not implement propagation, which is why this
	 * is a plain record rather than anything OTel-shaped.
	 */
	carrier?: Record<string, string | undefined>;
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
	/**
	 * Emit one log record on the OTel logs signal.
	 *
	 * Optional, and a TEE rather than a replacement: the existing Pino output
	 * (console, pretty, whatever the app configured) is untouched. An app that
	 * ships logs by scraping stdout keeps working; one that wants them on OTLP
	 * gets them without changing how it logs.
	 *
	 * Trace correlation is not passed in — the adapter reads the active context
	 * itself, which is both cheaper and harder to get wrong at the call site.
	 */
	emitLog?(record: ObservabilityLogRecord): void;
	shutdown(): Promise<void>;
}

export interface ObservabilityLogRecord {
	level: "debug" | "info" | "warn" | "error";
	message: string;
	attributes?: ObservabilityLogAttributes;
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
