import pino from "pino";

import type { LoggerAdapter, LoggerConfig } from "./types.js";

export class PinoLoggerAdapter implements LoggerAdapter {
	private logger: pino.Logger;

	constructor(config: LoggerConfig = {}) {
		const isDev = process.env.NODE_ENV === "development";

		this.logger = pino({
			level: config.level || "info",
			redact: config.redact,
			transport:
				(config.pretty ?? isDev)
					? {
							target: "pino-pretty",
							options: {
								colorize: true,
								ignore: "pid,hostname",
								translateTime: "HH:MM:ss Z",
							},
						}
					: undefined,
		});
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
