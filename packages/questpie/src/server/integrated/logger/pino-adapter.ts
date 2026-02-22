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
		this.logger.debug(msg, ...args);
	}

	info(msg: string, ...args: any[]) {
		this.logger.info(msg, ...args);
	}

	warn(msg: string, ...args: any[]) {
		this.logger.warn(msg, ...args);
	}

	error(msg: string, ...args: any[]) {
		this.logger.error(msg, ...args);
	}

	child(bindings: Record<string, any>): LoggerAdapter {
		const childAdapter = new PinoLoggerAdapter();
		childAdapter.logger = this.logger.child(bindings);
		return childAdapter;
	}
}
