export type ExecutorWorkloadAuthorityErrorCode =
	| "invalid_principal"
	| "worker_incompatible"
	| "worker_lease_stale";

const MESSAGES: Record<ExecutorWorkloadAuthorityErrorCode, string> = {
	invalid_principal: "The workload authority is invalid.",
	worker_incompatible: "The workload runtime is unavailable.",
	worker_lease_stale: "The workload lease is no longer current.",
};

export class ExecutorWorkloadAuthorityError extends Error {
	readonly code: ExecutorWorkloadAuthorityErrorCode;

	constructor(code: ExecutorWorkloadAuthorityErrorCode) {
		super(MESSAGES[code]);
		this.name = "AgentWorkloadAuthorityError";
		this.code = code;
	}
}
