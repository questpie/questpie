import type { AgentWorkloadSandboxAdmissionClaims } from "./agent-workload-admission.js";

export type AgentWorkloadRuntimeAdmissionDecision = "allowed" | "denied";

export type AgentWorkloadRuntimeAdmissionReason =
	| "admission_authorized"
	| "body_mismatch"
	| "expired"
	| "invalid"
	| "missing"
	| "non_agent_unauthorized"
	| "replay"
	| "source_mismatch"
	| "unknown_mode"
	| "wrong_instance";

export interface AgentWorkloadRuntimeAdmissionAuditEvent {
	readonly event: "questpie.sandbox.agent_admission";
	readonly boundary: "sandbox.runtime_admission";
	readonly decision: AgentWorkloadRuntimeAdmissionDecision;
	readonly reason: AgentWorkloadRuntimeAdmissionReason;
	readonly principalId?: string;
	readonly runId?: string;
	readonly attemptId?: string;
	readonly agentActorId?: string;
	readonly companyId?: string;
	readonly anchorSpaceId?: string;
	readonly workerId?: string;
	readonly workerLeaseId?: string;
	readonly supervisorInstanceId?: string;
}

/**
 * Build the supervisor's deliberately redacted admission event. Valid signed
 * claims make a denial attributable, while request hashes, source digests,
 * policy targets, paths, and secret material never cross this audit seam.
 */
export function createAgentWorkloadRuntimeAdmissionAuditEvent(
	decision: AgentWorkloadRuntimeAdmissionDecision,
	reason: AgentWorkloadRuntimeAdmissionReason,
	claims?: AgentWorkloadSandboxAdmissionClaims,
): AgentWorkloadRuntimeAdmissionAuditEvent {
	return Object.freeze({
		event: "questpie.sandbox.agent_admission",
		boundary: "sandbox.runtime_admission",
		decision,
		reason,
		...(claims
			? {
					principalId: claims.principalId,
					runId: claims.runId,
					attemptId: claims.attemptId,
					agentActorId: claims.agentActorId,
					companyId: claims.companyId,
					anchorSpaceId: claims.anchorSpaceId,
					workerId: claims.workerId,
					workerLeaseId: claims.workerLeaseId,
					supervisorInstanceId: claims.supervisorInstanceId,
				}
			: {}),
	});
}
