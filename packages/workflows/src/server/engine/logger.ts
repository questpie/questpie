/**
 * Workflow Logger
 *
 * Structured logger for workflow handlers. Accumulates log entries
 * in-memory and flushes them in batch to the `wf_log` collection.
 *
 * Dual output: every entry goes to the `wf_log` collection (queryable in
 * admin UI) AND to an optional external logger (pino, console, etc.).
 */

import type { WorkflowLogger } from "../workflow/types.js";

// ============================================================================
// Types
// ============================================================================

/** Log severity level. */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** A single accumulated log entry. */
export interface LogEntry {
	level: LogLevel;
	message: string;
	data: Record<string, unknown> | null;
	timestamp: Date;
}

/** Numeric log level ordering for filtering. */
const LOG_LEVEL_ORDER: Record<LogLevel | "none", number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
	none: 4,
};

/**
 * Optional external logger interface.
 * Matches common logger APIs (pino, console, etc.).
 */
export interface ExternalLogger {
	debug(message: string, data?: Record<string, unknown>): void;
	info(message: string, data?: Record<string, unknown>): void;
	warn(message: string, data?: Record<string, unknown>): void;
	error(message: string, data?: Record<string, unknown>): void;
}

/**
 * Callback to persist log entries to the wf_log collection.
 * Called by `flush()` with all accumulated entries.
 */
export type FlushCallback = (
	instanceId: string,
	entries: LogEntry[],
) => Promise<void>;

// ============================================================================
// WorkflowLoggerImpl
// ============================================================================

/**
 * In-memory workflow logger implementation.
 *
 * Accumulates entries until `flush()` is called. Each log method also
 * forwards to an external logger if provided.
 */
export class WorkflowLoggerImpl implements WorkflowLogger {
	private readonly entries: LogEntry[] = [];
	private readonly minLevel: number;

	constructor(
		private readonly instanceId: string,
		private readonly options: {
			/** Minimum log level to record. */
			logLevel?: LogLevel | "none";
			/** External logger for dual output. */
			externalLogger?: ExternalLogger;
			/** Prefix for external logger messages. */
			prefix?: string;
		} = {},
	) {
		this.minLevel = LOG_LEVEL_ORDER[options.logLevel ?? "info"];
	}

	debug(message: string, data?: Record<string, unknown>): void {
		this.log("debug", message, data);
	}

	info(message: string, data?: Record<string, unknown>): void {
		this.log("info", message, data);
	}

	warn(message: string, data?: Record<string, unknown>): void {
		this.log("warn", message, data);
	}

	error(message: string, data?: Record<string, unknown>): void {
		this.log("error", message, data);
	}

	/**
	 * Get all accumulated entries (for testing / inspection).
	 */
	getEntries(): readonly LogEntry[] {
		return this.entries;
	}

	/**
	 * Flush all accumulated entries via the provided callback.
	 * Clears the internal buffer after successful flush.
	 */
	async flush(flushCallback: FlushCallback): Promise<void> {
		if (this.entries.length === 0) return;

		const toFlush = [...this.entries];
		await flushCallback(this.instanceId, toFlush);
		this.entries.length = 0;
	}

	// ── Internal ──────────────────────────────────────────────

	private log(
		level: LogLevel,
		message: string,
		data?: Record<string, unknown>,
	): void {
		const levelOrder = LOG_LEVEL_ORDER[level];

		// Forward to external logger regardless of minLevel filter
		// (external logger has its own filtering)
		if (this.options.externalLogger) {
			const prefixedMessage = this.options.prefix
				? `${this.options.prefix} ${message}`
				: message;
			this.options.externalLogger[level](prefixedMessage, data);
		}

		// Only accumulate if above minimum level
		if (levelOrder < this.minLevel) return;

		this.entries.push({
			level,
			message,
			data: data ?? null,
			timestamp: new Date(),
		});
	}
}
