import type {
	AgentWorkloadAuthorityRecord,
	AgentWorkloadPrincipalClaims,
} from "./agent-workload-types.js";

function normalizedStrings(values: readonly string[]): string[] {
	return [...new Set(values)].sort();
}

export function recordAuthorityFingerprint(
	record: AgentWorkloadAuthorityRecord,
): string {
	return JSON.stringify({
		run: {
			id: record.run.id,
			attemptId: record.run.attemptId,
			workRequestId: record.run.workRequestId,
			status: record.run.status,
			rootRunId: record.run.rootRunId,
			parentRunId: record.run.parentRunId,
			delegationDepth: record.run.delegationDepth,
			lineageFingerprint: record.run.lineageFingerprint,
		},
		attribution: {
			agentActorId: record.agent.actorId,
			requesterActorId: record.requesterActorId,
		},
		scope: {
			companyId: record.company.id,
			anchorSpaceId: record.anchorSpace.id,
		},
		policies: {
			skillRevisionId: record.policies.skillRevisionId,
			requestPolicyRevisionId: record.policies.requestPolicyRevisionId,
			executionPolicyRevisionId: record.policies.executionPolicyRevisionId,
		},
		grants: {
			company: normalizedStrings(record.grants.company),
			anchorSpace: normalizedStrings(record.grants.anchorSpace),
		},
		capabilities: {
			tools: normalizedStrings(record.capabilities.tools),
			effects: normalizedStrings(record.capabilities.effects),
		},
		execution: {
			providerConnectionId: record.execution.providerConnectionId,
			providerConnectionRevision: record.execution.providerConnectionRevision,
			modelOfferingId: record.execution.modelOfferingId,
			runtime: record.execution.runtime,
			workMachineId: record.execution.workMachineId,
			workerId: record.execution.workerId,
			workerCapabilitiesRevision: record.execution.workerCapabilitiesRevision,
			workerLeaseId: record.execution.workerLeaseId,
			workerLeaseEpoch: record.execution.workerLeaseEpoch,
			workerLeaseExpiresAt: record.execution.workerLeaseExpiresAt,
		},
		disclosure: {
			mode: "anchor_space",
			anchorSpaceId: record.anchorSpace.id,
		},
		epochs: {
			grant: record.run.grantEpoch,
			revocation: record.run.revocationEpoch,
		},
	});
}

export function principalAuthorityFingerprint(
	principal: AgentWorkloadPrincipalClaims,
): string {
	return JSON.stringify({
		run: {
			id: principal.run.id,
			attemptId: principal.run.attemptId,
			workRequestId: principal.run.workRequestId,
			status: principal.run.status,
			rootRunId: principal.run.rootRunId,
			parentRunId: principal.run.parentRunId,
			delegationDepth: principal.run.delegationDepth,
			lineageFingerprint: principal.run.lineageFingerprint,
		},
		attribution: principal.attribution,
		scope: principal.scope,
		policies: principal.policies,
		grants: {
			company: normalizedStrings(principal.grants.company),
			anchorSpace: normalizedStrings(principal.grants.anchorSpace),
		},
		capabilities: {
			tools: normalizedStrings(principal.capabilities.tools),
			effects: normalizedStrings(principal.capabilities.effects),
		},
		execution: principal.execution,
		disclosure: principal.disclosure,
		epochs: principal.epochs,
	});
}
