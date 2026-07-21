import { AgentWorkloadAuthorityError } from "./agent-workload-error.js";
import { parseAgentWorkloadAuthorityRecord } from "./agent-workload-schema.js";
import type {
	AgentWorkloadAuthorityRecord,
	AgentWorkloadAuthorityStore,
	AgentWorkloadPrincipal,
	ResolveAgentWorkloadPrincipalInput,
} from "./agent-workload-types.js";

export type ResolvableAgentWorkloadAuthorityRecord =
	AgentWorkloadAuthorityRecord & {
		readonly run: AgentWorkloadAuthorityRecord["run"] & {
			readonly status: AgentWorkloadPrincipal["run"]["status"];
		};
	};

export interface CurrentAgentWorkloadAuthoritySnapshot {
	readonly record: ResolvableAgentWorkloadAuthorityRecord;
	readonly observedAt: Date;
}

function assertBindings(record: AgentWorkloadAuthorityRecord): void {
	const actorId = record.agent.actorId;
	const companyId = record.company.id;
	const run = record.run;
	const execution = record.execution;
	const invalidLineage =
		!Number.isInteger(run.delegationDepth) ||
		run.delegationDepth < 0 ||
		run.delegationDepth > 3 ||
		(run.delegationDepth === 0 &&
			(run.rootRunId !== run.id || run.parentRunId !== null)) ||
		(run.delegationDepth > 0 &&
			(run.parentRunId === null ||
				run.parentRunId === run.id ||
				run.rootRunId === run.id));
	if (
		record.agent.companyId !== companyId ||
		record.company.membershipActorId !== actorId ||
		record.anchorSpace.companyId !== companyId ||
		record.anchorSpace.membershipActorId !== actorId ||
		run.companyId !== companyId ||
		run.anchorSpaceId !== record.anchorSpace.id ||
		run.agentActorId !== actorId ||
		run.requesterActorId !== record.requesterActorId ||
		record.policies.skillAgentActorId !== actorId ||
		record.policies.requestPolicyAgentActorId !== actorId ||
		record.policies.executionPolicyAgentActorId !== actorId ||
		execution.workerLeaseRunId !== run.id ||
		execution.workerLeaseAttemptId !== run.attemptId ||
		execution.workerLeaseWorkerId !== execution.workerId ||
		invalidLineage
	) {
		throw new AgentWorkloadAuthorityError("authority_state_inconsistent");
	}
}

function assertActorAndScope(record: AgentWorkloadAuthorityRecord): void {
	if (record.agent.status !== "active") {
		throw new AgentWorkloadAuthorityError("agent_unavailable");
	}
	if (record.company.status !== "active") {
		throw new AgentWorkloadAuthorityError("company_unavailable");
	}
	if (record.company.membershipStatus !== "active") {
		throw new AgentWorkloadAuthorityError("company_membership_inactive");
	}
	if (record.anchorSpace.status !== "active") {
		throw new AgentWorkloadAuthorityError("anchor_space_unavailable");
	}
	if (record.anchorSpace.membershipStatus !== "active") {
		throw new AgentWorkloadAuthorityError("space_membership_inactive");
	}
}

function assertPolicies(record: AgentWorkloadAuthorityRecord): void {
	if (record.policies.skillStatus !== "active") {
		throw new AgentWorkloadAuthorityError("skill_incompatible");
	}
	if (
		record.policies.requestPolicyStatus !== "active" ||
		record.policies.executionPolicyStatus !== "active"
	) {
		throw new AgentWorkloadAuthorityError("policy_unavailable");
	}
}

function assertWorker(record: AgentWorkloadAuthorityRecord, at: Date): void {
	if (
		!record.execution.workerSupportsRuntime ||
		record.execution.workerStatus === "offline" ||
		record.execution.workerStatus === "revoked"
	) {
		throw new AgentWorkloadAuthorityError("worker_incompatible");
	}
	const leaseExpiresAt = new Date(
		record.execution.workerLeaseExpiresAt,
	).getTime();
	if (
		record.execution.workerLeaseStatus !== "active" ||
		record.execution.workerLeaseId !== record.execution.currentWorkerLeaseId ||
		record.execution.workerLeaseEpoch !==
			record.execution.currentWorkerLeaseEpoch ||
		!Number.isFinite(leaseExpiresAt) ||
		leaseExpiresAt <= at.getTime()
	) {
		throw new AgentWorkloadAuthorityError("worker_lease_stale");
	}
}

function assertRun(
	record: AgentWorkloadAuthorityRecord,
): asserts record is ResolvableAgentWorkloadAuthorityRecord {
	switch (record.run.status) {
		case "completed":
		case "failed":
		case "rejected":
		case "timed_out":
		case "cancelled":
			throw new AgentWorkloadAuthorityError("run_attempt_terminal");
	}
	if (
		record.run.grantEpoch !== record.currentEpochs.grant ||
		record.run.revocationEpoch !== record.currentEpochs.revocation
	) {
		throw new AgentWorkloadAuthorityError("authority_epoch_stale");
	}
}

export async function loadCurrentAgentWorkloadAuthority(
	store: AgentWorkloadAuthorityStore,
	input: ResolveAgentWorkloadPrincipalInput,
	now: () => Date,
): Promise<CurrentAgentWorkloadAuthoritySnapshot> {
	let snapshot: Awaited<
		ReturnType<AgentWorkloadAuthorityStore["loadFreshConsistentAuthority"]>
	>;
	try {
		snapshot = await store.loadFreshConsistentAuthority(input);
	} catch {
		throw new AgentWorkloadAuthorityError("authority_store_unavailable");
	}
	if (!snapshot) {
		throw new AgentWorkloadAuthorityError("authority_not_found");
	}
	let record: AgentWorkloadAuthorityRecord | null;
	try {
		if (
			snapshot.freshness !== "fresh_uncached" ||
			snapshot.consistency !== "transactional"
		) {
			throw new AgentWorkloadAuthorityError("authority_state_invalid");
		}
		record = parseAgentWorkloadAuthorityRecord(snapshot.record);
	} catch {
		throw new AgentWorkloadAuthorityError("authority_state_invalid");
	}
	if (
		!record ||
		record.run.id !== input.runId ||
		record.run.attemptId !== input.attemptId
	) {
		throw new AgentWorkloadAuthorityError(
			record ? "authority_not_found" : "authority_state_invalid",
		);
	}
	assertBindings(record);
	assertActorAndScope(record);
	assertPolicies(record);
	assertRun(record);
	let observedAt: Date;
	try {
		const observedAtMs = now().getTime();
		if (!Number.isFinite(observedAtMs)) {
			throw new Error("invalid clock");
		}
		observedAt = new Date(observedAtMs);
	} catch {
		throw new AgentWorkloadAuthorityError("invalid_resolver_configuration");
	}
	assertWorker(record, observedAt);
	return { record, observedAt };
}
