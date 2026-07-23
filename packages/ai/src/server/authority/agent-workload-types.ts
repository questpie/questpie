export type AgentWorkloadAudience =
	| "mcp"
	| "sandbox"
	| "executor"
	| "effect"
	| "projection";

export type AgentWorkloadRunStatus =
	| "requested"
	| "queued"
	| "evaluating"
	| "working"
	| "responding"
	| "waiting_for_permission"
	| "completed"
	| "failed"
	| "rejected"
	| "timed_out"
	| "cancelled";

export interface AgentWorkloadAuthorityRecord {
	readonly run: {
		readonly id: string;
		readonly attemptId: string;
		readonly workRequestId: string;
		readonly companyId: string;
		readonly anchorSpaceId: string;
		readonly agentActorId: string;
		readonly requesterActorId: string;
		readonly status: AgentWorkloadRunStatus;
		readonly rootRunId: string;
		readonly parentRunId: string | null;
		readonly delegationDepth: number;
		readonly lineageFingerprint: string;
		readonly grantEpoch: number;
		readonly revocationEpoch: number;
	};
	readonly agent: {
		readonly actorId: string;
		readonly companyId: string;
		readonly status: "active" | "inactive" | "suspended" | "archived";
	};
	readonly requesterActorId: string;
	readonly company: {
		readonly id: string;
		readonly membershipActorId: string;
		readonly status: "active" | "archived";
		readonly membershipStatus: "active" | "suspended" | "archived" | "missing";
	};
	readonly anchorSpace: {
		readonly id: string;
		readonly companyId: string;
		readonly membershipActorId: string;
		readonly status: "active" | "archived";
		readonly membershipStatus: "active" | "suspended" | "archived" | "missing";
	};
	readonly policies: {
		readonly skillRevisionId: string;
		readonly skillAgentActorId: string;
		readonly skillStatus: "active" | "missing" | "archived" | "incompatible";
		readonly requestPolicyRevisionId: string;
		readonly requestPolicyAgentActorId: string;
		readonly requestPolicyStatus: "active" | "missing" | "archived";
		readonly executionPolicyRevisionId: string;
		readonly executionPolicyAgentActorId: string;
		readonly executionPolicyStatus: "active" | "missing" | "archived";
	};
	readonly grants: {
		readonly company: readonly string[];
		readonly anchorSpace: readonly string[];
	};
	readonly capabilities: {
		readonly tools: readonly string[];
		readonly effects: readonly string[];
	};
	readonly execution: {
		readonly providerConnectionId: string;
		readonly providerConnectionRevision: string;
		readonly modelOfferingId: string;
		readonly runtime: string;
		readonly workMachineId: string;
		readonly workerId: string;
		readonly workerCapabilitiesRevision: string;
		readonly workerStatus:
			| "online"
			| "busy"
			| "draining"
			| "offline"
			| "revoked";
		readonly workerLeaseId: string;
		readonly workerLeaseRunId: string;
		readonly workerLeaseAttemptId: string;
		readonly workerLeaseWorkerId: string;
		readonly workerLeaseEpoch: number;
		readonly workerLeaseExpiresAt: string;
		readonly currentWorkerLeaseId: string;
		readonly currentWorkerLeaseEpoch: number;
		readonly workerLeaseStatus: "active" | "expired" | "released";
		readonly workerSupportsRuntime: boolean;
	};
	readonly currentEpochs: {
		readonly grant: number;
		readonly revocation: number;
	};
}

export interface AgentWorkloadPrincipalClaims {
	readonly kind: "agent_workload";
	readonly schemaVersion: 1;
	readonly principalId: string;
	readonly audience: AgentWorkloadAudience;
	readonly run: {
		readonly id: string;
		readonly attemptId: string;
		readonly workRequestId: string;
		readonly status: Exclude<
			AgentWorkloadRunStatus,
			"completed" | "failed" | "rejected" | "timed_out" | "cancelled"
		>;
		readonly rootRunId: string;
		readonly parentRunId: string | null;
		readonly delegationDepth: number;
		readonly lineageFingerprint: string;
	};
	readonly attribution: {
		readonly agentActorId: string;
		readonly requesterActorId: string;
	};
	readonly scope: {
		readonly companyId: string;
		readonly anchorSpaceId: string;
	};
	readonly policies: {
		readonly skillRevisionId: string;
		readonly requestPolicyRevisionId: string;
		readonly executionPolicyRevisionId: string;
	};
	readonly grants: {
		readonly company: readonly string[];
		readonly anchorSpace: readonly string[];
	};
	readonly capabilities: {
		readonly tools: readonly string[];
		readonly effects: readonly string[];
	};
	readonly execution: {
		readonly providerConnectionId: string;
		readonly providerConnectionRevision: string;
		readonly modelOfferingId: string;
		readonly runtime: string;
		readonly workMachineId: string;
		readonly workerId: string;
		readonly workerCapabilitiesRevision: string;
		readonly workerLeaseId: string;
		readonly workerLeaseEpoch: number;
		readonly workerLeaseExpiresAt: string;
	};
	readonly disclosure: {
		readonly mode: "anchor_space";
		readonly anchorSpaceId: string;
	};
	readonly epochs: {
		readonly grant: number;
		readonly revocation: number;
	};
	readonly issuedAt: string;
	readonly expiresAt: string;
}

declare const authorizedAgentWorkloadPrincipal: unique symbol;

export interface AgentWorkloadPrincipal extends AgentWorkloadPrincipalClaims {
	readonly [authorizedAgentWorkloadPrincipal]: true;
}

declare const authenticatedAgentWorkloadEnvelope: unique symbol;

export interface AuthenticatedAgentWorkloadEnvelope {
	readonly kind: "authenticated_agent_workload_envelope";
	readonly version: 1;
	readonly [authenticatedAgentWorkloadEnvelope]: true;
}

export interface AgentWorkloadAuthoritySnapshot {
	readonly freshness: "fresh_uncached";
	readonly consistency: "transactional";
	readonly record: unknown;
}

export interface AgentWorkloadAuthorityStore {
	/**
	 * Reads every authority and lineage binding from one fresh, uncached,
	 * transactionally consistent snapshot. The effect-commit transaction must
	 * still recheck its target operation and epochs immediately before commit.
	 */
	loadFreshConsistentAuthority(input: {
		runId: string;
		attemptId: string;
	}): Promise<AgentWorkloadAuthoritySnapshot | null>;
}

export interface ResolveAgentWorkloadPrincipalInput {
	readonly runId: string;
	readonly attemptId: string;
}

export type AgentWorkloadGrantRequirement =
	| {
			readonly scope: "company";
			readonly companyId: string;
			readonly grant: string;
	  }
	| {
			readonly scope: "anchor_space";
			readonly companyId: string;
			readonly anchorSpaceId: string;
			readonly grant: string;
	  };
