export interface LoggerConfig {
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
}
