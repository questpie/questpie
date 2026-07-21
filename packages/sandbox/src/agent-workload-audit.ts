import type { AgentWorkloadPrincipal } from "@questpie/ai";

import type { AgentWorkloadSandboxCapabilityRequest } from "./agent-workload-capabilities.js";

export interface AgentWorkloadSandboxAuditEvent {
	readonly boundary:
		| "sandbox.open"
		| "sandbox.prepare"
		| "sandbox.create"
		| "sandbox.binding"
		| "sandbox.effect";
	readonly decision: "allowed" | "denied";
	readonly reason:
		| "policy_mismatch"
		| "capability_denied"
		| "authority_invalidated"
		| "capability_authorized"
		| "sandbox_preparation_authorized"
		| "sandbox_creation_authorized";
	readonly capability?: AgentWorkloadSandboxCapabilityRequest["kind"];
	readonly principalId: string;
	readonly runId: string;
	readonly attemptId: string;
	readonly agentActorId: string;
	readonly companyId: string;
	readonly anchorSpaceId: string;
	readonly workerId: string;
	readonly workerLeaseId: string;
}

function attribution(principal: AgentWorkloadPrincipal) {
	return {
		principalId: principal.principalId,
		runId: principal.run.id,
		attemptId: principal.run.attemptId,
		agentActorId: principal.attribution.agentActorId,
		companyId: principal.scope.companyId,
		anchorSpaceId: principal.scope.anchorSpaceId,
		workerId: principal.execution.workerId,
		workerLeaseId: principal.execution.workerLeaseId,
	};
}

export function policyDenialEvent(
	principal: AgentWorkloadPrincipal,
): AgentWorkloadSandboxAuditEvent {
	return {
		boundary: "sandbox.open",
		decision: "denied",
		reason: "policy_mismatch",
		...attribution(principal),
	};
}

export function capabilityDenialEvent(
	principal: AgentWorkloadPrincipal,
	request: AgentWorkloadSandboxCapabilityRequest,
): AgentWorkloadSandboxAuditEvent {
	return {
		boundary: request.kind === "effect" ? "sandbox.effect" : "sandbox.binding",
		decision: "denied",
		reason: "capability_denied",
		capability: request.kind,
		...attribution(principal),
	};
}

export function authorityInvalidatedEvent(
	principal: AgentWorkloadPrincipal,
	request: AgentWorkloadSandboxCapabilityRequest,
): AgentWorkloadSandboxAuditEvent {
	return {
		...capabilityDenialEvent(principal, request),
		reason: "authority_invalidated",
	};
}

export function capabilityAuthorizedEvent(
	principal: AgentWorkloadPrincipal,
	request: AgentWorkloadSandboxCapabilityRequest,
): AgentWorkloadSandboxAuditEvent {
	return {
		...capabilityDenialEvent(principal, request),
		decision: "allowed",
		reason: "capability_authorized",
	};
}

export function sandboxCreationEvent(
	principal: AgentWorkloadPrincipal,
	decision: "allowed" | "denied",
	reason:
		| "authority_invalidated"
		| "policy_mismatch"
		| "sandbox_creation_authorized",
): AgentWorkloadSandboxAuditEvent {
	return {
		boundary: "sandbox.create",
		decision,
		reason,
		...attribution(principal),
	};
}

export function sandboxPreparationEvent(
	principal: AgentWorkloadPrincipal,
	decision: "allowed" | "denied",
	reason:
		| "authority_invalidated"
		| "policy_mismatch"
		| "sandbox_preparation_authorized",
): AgentWorkloadSandboxAuditEvent {
	return {
		boundary: "sandbox.prepare",
		decision,
		reason,
		...attribution(principal),
	};
}
