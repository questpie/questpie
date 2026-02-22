import type { LoggerAdapter } from "../../../src/server/integrated/logger/types.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
	level: LogLevel;
	message: string;
	args: any[];
	timestamp: Date;
}

/**
 * Mock Logger for testing
 * Captures all log messages for inspection in tests
 */
export class MockLogger implements LoggerAdapter {
	private logs: LogEntry[] = [];

	/**
	 * Get all log entries (test utility)
	 */
	getLogs(): LogEntry[] {
		return [...this.logs];
	}

	/**
	 * Get logs by level (test utility)
	 */
	getLogsByLevel(level: LogLevel): LogEntry[] {
		return this.logs.filter((log) => log.level === level);
	}

	/**
	 * Get logs containing specific message (test utility)
	 */
	getLogsContaining(text: string): LogEntry[] {
		return this.logs.filter((log) => log.message.includes(text));
	}

	/**
	 * Check if message was logged (test utility)
	 */
	wasLogged(level: LogLevel, message: string): boolean {
		return this.logs.some(
			(log) => log.level === level && log.message === message,
		);
	}

	/**
	 * Check if any error was logged (test utility)
	 */
	hasErrors(): boolean {
		return this.logs.some((log) => log.level === "error");
	}

	/**
	 * Check if any warning was logged (test utility)
	 */
	hasWarnings(): boolean {
		return this.logs.some((log) => log.level === "warn");
	}

	/**
	 * Get count of logs (test utility)
	 */
	getLogCount(): number {
		return this.logs.length;
	}

	/**
	 * Clear all logs (test utility)
	 */
	clearLogs(): void {
		this.logs = [];
	}

	debug(msg: string, ...args: any[]): void {
		this.logs.push({
			level: "debug",
			message: msg,
			args,
			timestamp: new Date(),
		});
	}

	info(msg: string, ...args: any[]): void {
		this.logs.push({
			level: "info",
			message: msg,
			args,
			timestamp: new Date(),
		});
	}

	warn(msg: string, ...args: any[]): void {
		this.logs.push({
			level: "warn",
			message: msg,
			args,
			timestamp: new Date(),
		});
	}

	error(msg: string, ...args: any[]): void {
		this.logs.push({
			level: "error",
			message: msg,
			args,
			timestamp: new Date(),
		});
	}

	child(_bindings: Record<string, any>): LoggerAdapter {
		// Return a new instance that shares the same logs array
		const childLogger = new MockLogger();
		childLogger.logs = this.logs;
		return childLogger;
	}
}
