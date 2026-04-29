import { PinoLoggerAdapter } from "./pino-adapter.js";
import type { LoggerAdapter, LoggerConfig } from "./types.js";

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
		this.adapter.debug(msg, ...args);
	}

	info(msg: string, ...args: any[]) {
		this.adapter.info(msg, ...args);
	}

	warn(msg: string, ...args: any[]) {
		this.adapter.warn(msg, ...args);
	}

	error(msg: string, ...args: any[]) {
		this.adapter.error(msg, ...args);
	}

	child(bindings: Record<string, any>): LoggerService {
		const childAdapter = this.adapter.child(bindings);
		return new LoggerService({ adapter: childAdapter });
	}
}
