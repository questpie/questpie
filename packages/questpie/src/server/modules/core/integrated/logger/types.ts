export interface LoggerAdapter {
	debug(msg: string, ...args: any[]): void;
	info(msg: string, ...args: any[]): void;
	warn(msg: string, ...args: any[]): void;
	error(msg: string, ...args: any[]): void;
	child(bindings: Record<string, any>): LoggerAdapter;
}

export interface RequestLogMeta {
	event: "http.request";
	requestId: string;
	traceId: string;
	method: string;
	path: string;
	route?: string;
	status: number;
	durationMs: number;
	slow: boolean;
	error?: {
		name: string;
		message: string;
	};
}

export type RequestLoggingConfig =
	| boolean
	| {
			/**
			 * Enable QUESTPIE HTTP access logs.
			 *
			 * Request and trace identifiers are still propagated when this is false.
			 */
			enabled?: boolean;
			/**
			 * Log successful non-slow requests. Disable this when the host
			 * framework/platform already emits access logs.
			 *
			 * Errors and slow requests are still logged.
			 */
			logSuccessfulRequests?: boolean;
			/**
			 * Successful requests at or above this duration are logged at warn.
			 *
			 * @default 1000
			 */
			slowThresholdMs?: number;
			/**
			 * Suppress successful request logs for noisy paths such as health checks.
			 * Failing matching requests are still logged.
			 */
			ignorePaths?: Array<string | RegExp>;
			/**
			 * Custom final filter. Return true to suppress a request log.
			 */
			ignore?: (meta: RequestLogMeta) => boolean;
	  };

export interface LoggerConfig {
	/**
	 * Custom logger adapter
	 */
	adapter?: LoggerAdapter;
	/**
	 * Log level (debug, info, warn, error)
	 * Defaults to 'info'
	 */
	level?: string;
	/**
	 * Enable pretty printing (useful for dev)
	 * Defaults to false (true if NODE_ENV is development)
	 */
	pretty?: boolean;
	/**
	 * Redact keys (e.g. ["req.headers.authorization"])
	 */
	redact?: string[];
	/**
	 * QUESTPIE HTTP request logging defaults. Can be overridden per adapter via
	 * `createFetchHandler(app, { requestLogging })`.
	 */
	requests?: RequestLoggingConfig;
}
