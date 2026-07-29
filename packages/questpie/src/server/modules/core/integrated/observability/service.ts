import { tryGetContext } from "#questpie/server/config/context.js";

import {
	noopMeter,
	noopTracer,
	type Meter,
	type ObservabilityAttributes,
	type ObservabilityLogRecord,
	type ObservabilityConfig,
	type ObservabilitySpan,
	type StartSpanOptions,
	type Tracer,
} from "./types.js";

/**
 * Observability service — resolves the configured adapter, or stays a no-op.
 *
 * Tracers and meters are cached per name: instrument creation is not free in a
 * real SDK, and the seams below ask for the same names on every request.
 */
export class ObservabilityService {
	private readonly config: ObservabilityConfig;
	private readonly tracers = new Map<string, Tracer>();
	private readonly meters = new Map<string, Meter>();

	constructor(config: ObservabilityConfig = {}) {
		this.config = config;
	}

	/** True when a real adapter is wired. Seams can skip work entirely when false. */
	get enabled(): boolean {
		return Boolean(this.config.adapter);
	}

	/**
	 * Ids of the active span, when an adapter is wired and one is open.
	 * Used by the logger to correlate records with the trace.
	 */
	activeSpanContext(): { traceId: string; spanId: string } | undefined {
		return this.config.adapter?.activeSpanContext?.();
	}

	/**
	 * Mirror a log record onto the adapter's logs signal. No-op without one.
	 * Called by LoggerService for every record it writes.
	 */
	emitLog(record: ObservabilityLogRecord): void {
		this.config.adapter?.emitLog?.(record);
	}

	tracer(name = "questpie"): Tracer {
		const cached = this.tracers.get(name);
		if (cached) return cached;
		const resolved = this.config.adapter?.tracer(name) ?? noopTracer;
		this.tracers.set(name, resolved);
		return resolved;
	}

	meter(name = "questpie"): Meter {
		const cached = this.meters.get(name);
		if (cached) return cached;
		const resolved = this.config.adapter?.meter(name) ?? noopMeter;
		this.meters.set(name, resolved);
		return resolved;
	}

	/**
	 * Run `fn` inside a span.
	 *
	 * Correlation with logs: QUESTPIE already carries `requestId`/`traceId` on
	 * the ambient context (`server/adapters/http.ts` derives them from the
	 * incoming `traceparent`, falling back to `x-request-id`). Those are stamped
	 * onto the span here so traces and logs line up even before an adapter takes
	 * over W3C propagation. Once the adapter owns propagation, the span's own
	 * trace id is authoritative and these become plain correlation attributes.
	 *
	 * Errors are recorded on the span and rethrown — this never swallows.
	 */
	span<T>(
		name: string,
		fn: (span: ObservabilitySpan) => T,
		options: StartSpanOptions = {},
	): T {
		if (!this.enabled) return fn(noopSpanForDisabledPath);

		return this.tracer().startActiveSpan(name, options, (span) => {
			const ctx = tryGetContext() as
				| { requestId?: string; traceId?: string }
				| undefined;
			if (ctx?.requestId)
				span.setAttribute("questpie.request_id", ctx.requestId);
			if (ctx?.traceId) span.setAttribute("questpie.trace_id", ctx.traceId);

			let result: T;
			try {
				result = fn(span);
			} catch (error) {
				span.recordError(error);
				span.end();
				throw error;
			}

			// A promise must not end the span before it settles, or every async
			// seam reports ~0ms.
			if (result instanceof Promise) {
				return result.then(
					(value) => {
						span.end();
						return value;
					},
					(error: unknown) => {
						span.recordError(error);
						span.end();
						throw error;
					},
				) as T;
			}

			span.end();
			return result;
		});
	}

	async shutdown(): Promise<void> {
		await this.config.adapter?.shutdown();
	}
}

/**
 * Handed to callbacks on the disabled path. Importing the frozen singleton
 * directly keeps the no-adapter case allocation-free.
 */
const noopSpanForDisabledPath: ObservabilitySpan = {
	setAttribute() {},
	setAttributes() {},
	recordError() {},
	addEvent() {},
	end() {},
};

export type { ObservabilityAttributes };
