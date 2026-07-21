export type AgentWorkloadAuthorityErrorCode =
	| "agent_unavailable"
	| "anchor_space_unavailable"
	| "authority_epoch_stale"
	| "authority_not_found"
	| "authority_state_invalid"
	| "authority_state_inconsistent"
	| "authority_store_unavailable"
	| "company_membership_inactive"
	| "company_unavailable"
	| "internal_transport_required"
	| "invalid_principal"
	| "invalid_resolution_input"
	| "invalid_resolver_configuration"
	| "invalid_transport_configuration"
	| "policy_unavailable"
	| "principal_expired"
	| "principal_wrong_audience"
	| "run_attempt_terminal"
	| "skill_incompatible"
	| "space_membership_inactive"
	| "worker_incompatible"
	| "worker_lease_stale";

const SAFE_MESSAGES: Record<AgentWorkloadAuthorityErrorCode, string> = {
	agent_unavailable: "The workload identity is unavailable.",
	anchor_space_unavailable: "The workload scope is unavailable.",
	authority_epoch_stale: "The workload authority is no longer current.",
	authority_not_found: "The workload authority is unavailable.",
	authority_state_invalid: "The workload authority is unavailable.",
	authority_state_inconsistent: "The workload authority is unavailable.",
	authority_store_unavailable: "The workload authority is unavailable.",
	company_membership_inactive: "The workload identity is unavailable.",
	company_unavailable: "The workload scope is unavailable.",
	internal_transport_required: "Authenticated internal transport is required.",
	invalid_principal: "The workload authority is invalid.",
	invalid_resolution_input: "The workload reference is invalid.",
	invalid_resolver_configuration:
		"The workload authority resolver is not configured safely.",
	invalid_transport_configuration:
		"The workload transport is not configured safely.",
	policy_unavailable: "The workload policy is unavailable.",
	principal_expired: "The workload authority has expired.",
	principal_wrong_audience:
		"The workload authority is invalid for this boundary.",
	run_attempt_terminal: "The workload attempt is no longer active.",
	skill_incompatible: "The workload capability is unavailable.",
	space_membership_inactive: "The workload identity is unavailable.",
	worker_incompatible: "The workload runtime is unavailable.",
	worker_lease_stale: "The workload lease is no longer current.",
};

export class AgentWorkloadAuthorityError extends Error {
	readonly code: AgentWorkloadAuthorityErrorCode;

	constructor(code: AgentWorkloadAuthorityErrorCode) {
		super(SAFE_MESSAGES[code]);
		this.name = "AgentWorkloadAuthorityError";
		this.code = code;
	}
}
