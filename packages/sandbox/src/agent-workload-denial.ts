export const AGENT_WORKLOAD_SANDBOX_DENIAL_MESSAGE =
	"The workload is not authorized for this sandbox operation.";

export class AgentWorkloadSandboxDeniedError extends Error {
	readonly code = "sandbox_authority_denied" as const;

	constructor() {
		super(AGENT_WORKLOAD_SANDBOX_DENIAL_MESSAGE);
		this.name = "AgentWorkloadSandboxDeniedError";
	}
}
