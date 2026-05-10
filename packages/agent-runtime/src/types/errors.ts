export type AgentRuntimeErrorCode =
	| "RUNTIME_NOT_INSTALLED"
	| "RUNTIME_AUTH_MISSING"
	| "RUNTIME_AUTH_MISSING_IN_ISOLATED_HOME"
	| "RUNTIME_EXITED_NON_ZERO"
	| "RUNTIME_SPAWN_FAILED"
	| "RUNTIME_TIMEOUT"
	| "RUNTIME_USAGE_LIMIT"
	| "SESSION_NOT_FOUND_ON_VOLUME"
	| "SESSION_VOLUME_OFFLINE"
	| "VOLUME_LOCKED"
	| "ADAPTER_NOT_FOUND"
	| "COMMAND_CANCELLED"
	| "UNSUPPORTED_PROFILE_FEATURE"
	| "UNKNOWN";

export class AgentRuntimeError extends Error {
	readonly code: AgentRuntimeErrorCode;
	readonly runtime?: string;

	constructor(
		code: AgentRuntimeErrorCode,
		message: string,
		options?: { runtime?: string; cause?: unknown },
	) {
		super(message, { cause: options?.cause });
		this.code = code;
		this.runtime = options?.runtime;
	}
}
