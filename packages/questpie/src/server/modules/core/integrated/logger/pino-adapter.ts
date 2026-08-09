import pino from "pino";
import pinoPretty from "pino-pretty";

import { getNodeEnv } from "#questpie/server/utils/env.js";

import type { LoggerAdapter, LoggerConfig } from "./types.js";

export class PinoLoggerAdapter implements LoggerAdapter {
	private logger: pino.Logger;

	constructor(config: LoggerConfig = {}) {
		const isDev = getNodeEnv() === "development";
		const options: pino.LoggerOptions = {
			level: config.level || "info",
			redact: config.redact,
		};

		this.logger =
			(config.pretty ?? isDev)
				? pino(
						options,
						pinoPretty({
							colorize: true,
							ignore: "pid,hostname",
							translateTime: "HH:MM:ss Z",
						}),
					)
				: pino(options);
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

	child(bindings: Record<string, any>): LoggerAdapter {
		const childAdapter = new PinoLoggerAdapter();
		childAdapter.logger = this.logger.child(bindings);
		return childAdapter;
	}

	private log(
		level: "debug" | "info" | "warn" | "error",
		msg: string,
		args: any[],
	) {
		const [first, ...rest] = args;
		if (first instanceof Error) {
			this.logger[level]({ err: first }, msg, ...rest);
			return;
		}
		if (first && typeof first === "object" && !Array.isArray(first)) {
			this.logger[level](first, msg, ...rest);
			return;
		}
		this.logger[level](msg, ...args);
	}
}
