import type { LoggerAdapter } from "../../src/server/modules/core/integrated/logger/types.js";

export interface CapturedLogRecord {
	level: "debug" | "info" | "warn" | "error";
	message?: string;
	args?: unknown[];
}

export interface CapturingLoggerOptions {
	captureArgs?: boolean;
	captureChildBindings?: boolean;
	captureMessages?: boolean;
}

export function createCapturingLogger(options: CapturingLoggerOptions = {}) {
	const {
		captureArgs = true,
		captureChildBindings = true,
		captureMessages = true,
	} = options;
	const records: CapturedLogRecord[] = [];
	const childBindings: Array<Record<string, unknown>> = [];
	const capture = (
		level: CapturedLogRecord["level"],
		message: string,
		args: unknown[],
	) => {
		records.push({
			level,
			...(captureMessages ? { message } : {}),
			...(captureArgs ? { args } : {}),
		});
	};
	const adapter: LoggerAdapter = {
		debug: (message, ...args) => capture("debug", message, args),
		info: (message, ...args) => capture("info", message, args),
		warn: (message, ...args) => capture("warn", message, args),
		error: (message, ...args) => capture("error", message, args),
		child: (bindings) => {
			if (captureChildBindings) childBindings.push(bindings);
			return adapter;
		},
	};
	return { adapter, childBindings, records };
}
