export interface LoggerAdapter {
	debug(msg: string, ...args: any[]): void;
	info(msg: string, ...args: any[]): void;
	warn(msg: string, ...args: any[]): void;
	error(msg: string, ...args: any[]): void;
	child(bindings: Record<string, any>): LoggerAdapter;
}

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
}
