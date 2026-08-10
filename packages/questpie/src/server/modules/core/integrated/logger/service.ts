import { tryGetContext } from "#questpie/server/config/context.js";

import { PinoLoggerAdapter } from "./pino-adapter.js";
import {
	createRedactionPolicy,
	redactLogArgs,
	redactLogBindings,
	type RedactionPolicy,
} from "./redaction.js";
import type { LoggerAdapter, LoggerConfig } from "./types.js";

interface SpanIds {
	traceId: string;
	spanId: string;
}

export class LoggerService implements LoggerAdapter {
	private adapter: LoggerAdapter;
	private redaction: RedactionPolicy;
	private teeBindings: Record<string, unknown> = {};

	constructor(config: LoggerConfig | { adapter: LoggerAdapter } = {}) {
		this.redaction = createRedactionPolicy(
			"redact" in config ? config.redact : undefined,
		);
		if ("adapter" in config && config.adapter) {
			this.adapter = config.adapter;
		} else {
			this.adapter = new PinoLoggerAdapter(config as LoggerConfig);
		}
	}

	debug(msg: string, ...args: any[]) {
		this.log("debug", msg, args);
	}

	info(msg: string, ...args: any[]) {
		this.log("info", msg, args);
	}

	warn(msg: string, ...args: any[]) {
		this.log("warn", msg, args);
	}

	error(msg: string, ...args: any[]) {
		this.log("error", msg, args);
	}

	child(bindings: Record<string, any>): LoggerService {
		const safeBindings = redactLogBindings(bindings, this.redaction);
		const childAdapter = this.adapter.child(safeBindings);
		const childLogger = new LoggerService({ adapter: childAdapter });
		childLogger.redaction = this.redaction;
		childLogger.teeBindings = { ...this.teeBindings, ...safeBindings };
		return childLogger;
	}

	private log(
		level: "debug" | "info" | "warn" | "error",
		msg: string,
		args: unknown[],
	): void {
		const contextualArgs = this.safeArgs(args);
		this.adapter[level](msg, ...contextualArgs);
		this.tee(level, msg, this.withTeeBindings(contextualArgs));
	}

	private safeArgs(args: unknown[]): unknown[] {
		return redactLogArgs(this.withContext(args), this.redaction);
	}

	private withTeeBindings(args: unknown[]): unknown[] {
		if (Object.keys(this.teeBindings).length === 0) return args;
		const [first, ...rest] = args;
		if (first && typeof first === "object" && !Array.isArray(first)) {
			return [{ ...this.teeBindings, ...first }, ...rest];
		}
		return [this.teeBindings, ...args];
	}

	/**
	 * Mirror the record onto the OTel logs signal when an adapter wants it.
	 *
	 * A TEE, not a redirect — the Pino output above already happened. An app
	 * scraping stdout keeps working; one exporting OTLP gets records too.
	 *
	 * Swallows adapter failures on purpose. A telemetry backend being down must
	 * never turn a log line into a thrown error, and the one thing we could do
	 * about it — log — is the path that just failed.
	 */
	private tee(
		level: "debug" | "info" | "warn" | "error",
		msg: string,
		// `unknown[]`, not `any[]`: this only ever inspects args[0] and narrows
		// it. The surrounding methods take `any[]` because they forward to an
		// adapter with that signature; there is no reason to inherit it here.
		args: unknown[],
	): void {
		const observability = (
			tryGetContext()?.app as
				| { observability?: { emitLog?(record: unknown): void } }
				| undefined
		)?.observability;
		if (!observability?.emitLog) return;

		const first = args[0];
		const attributes =
			first && typeof first === "object" && !Array.isArray(first)
				? first instanceof Error
					? { "exception.message": first.message }
					: (first as Record<string, unknown>)
				: undefined;

		try {
			observability.emitLog({ level, message: msg, attributes });
		} catch {
			/* telemetry must not break the caller */
		}
	}

	private withContext(args: unknown[]): unknown[] {
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
