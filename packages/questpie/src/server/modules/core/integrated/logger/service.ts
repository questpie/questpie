import { tryGetContext } from "#questpie/server/config/context.js";

import { PinoLoggerAdapter } from "./pino-adapter.js";
import type { LoggerAdapter, LoggerConfig } from "./types.js";

interface SpanIds {
	traceId: string;
	spanId: string;
}

export class LoggerService implements LoggerAdapter {
	private adapter: LoggerAdapter;

	constructor(config: LoggerConfig | { adapter: LoggerAdapter } = {}) {
		if ("adapter" in config && config.adapter) {
			this.adapter = config.adapter;
		} else {
			this.adapter = new PinoLoggerAdapter(config as LoggerConfig);
		}
	}

	debug(msg: string, ...args: any[]) {
		this.adapter.debug(msg, ...this.withContext(args));
	}

	info(msg: string, ...args: any[]) {
		this.adapter.info(msg, ...this.withContext(args));
	}

	warn(msg: string, ...args: any[]) {
		this.adapter.warn(msg, ...this.withContext(args));
	}

	error(msg: string, ...args: any[]) {
		this.adapter.error(msg, ...this.withContext(args));
	}

	child(bindings: Record<string, any>): LoggerService {
		const childAdapter = this.adapter.child(bindings);
		return new LoggerService({ adapter: childAdapter });
	}

	private withContext(args: any[]): any[] {
		const ctx = tryGetContext();
		// `trace_id`/`span_id` in snake_case on purpose: those are the OTel
		// semantic-convention keys that log backends join to traces on. The
		// camelCase `traceId` beside them is the framework's own correlation id
		// derived from the inbound `traceparent`/`x-request-id`, which is NOT the
		// same value once an adapter owns propagation — both are emitted because
		// they answer different questions.
		// Structural, not an import: the logger sits below observability in the
		// module graph and importing the service type back would close a cycle.
		const span = (
			ctx?.app as
				| {
						observability?: {
							activeSpanContext?(): SpanIds | undefined;
						};
				  }
				| undefined
		)?.observability?.activeSpanContext?.();
		const bindings = {
			...(ctx?.requestId ? { requestId: ctx.requestId } : {}),
			...(ctx?.traceId ? { traceId: ctx.traceId } : {}),
			...(span ? { trace_id: span.traceId, span_id: span.spanId } : {}),
		};
		if (Object.keys(bindings).length === 0) {
			return args;
		}

		const [first, ...rest] = args;
		if (first instanceof Error) {
			return [{ err: first, ...bindings }, ...rest];
		}
		if (first && typeof first === "object" && !Array.isArray(first)) {
			return [{ ...first, ...bindings }, ...rest];
		}
		return [bindings, ...args];
	}
}
