import { tryGetContext } from "#questpie/server/config/context.js";

export interface RuntimeLogger {
	debug(message: string, ...args: unknown[]): void;
	info(message: string, ...args: unknown[]): void;
	warn(message: string, ...args: unknown[]): void;
	error(message: string, ...args: unknown[]): void;
}

function isRuntimeLogger(value: unknown): value is RuntimeLogger {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<RuntimeLogger>;
	return (
		typeof candidate.debug === "function" &&
		typeof candidate.info === "function" &&
		typeof candidate.warn === "function" &&
		typeof candidate.error === "function"
	);
}

/** Resolve an injected logger first, then the active request/job logger. */
export function resolveRuntimeLogger(
	explicit?: unknown,
): RuntimeLogger | undefined {
	if (isRuntimeLogger(explicit)) return explicit;
	const context = tryGetContext();
	if (isRuntimeLogger(context?.logger)) return context.logger;
	const appLogger = (context?.app as { logger?: unknown } | undefined)?.logger;
	return isRuntimeLogger(appLogger) ? appLogger : undefined;
}
