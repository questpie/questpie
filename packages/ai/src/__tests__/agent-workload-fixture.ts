import {
	createAgentWorkloadPrincipalResolver,
	type AgentWorkloadAuthorityRecord,
	type AgentWorkloadAuthoritySnapshot,
} from "../exports/index.js";

export const WORKLOAD_NOW = new Date("2026-07-19T09:00:00.000Z");

export function activeAuthority(): AgentWorkloadAuthorityRecord {
	return {
		run: {
			id: "run_marketing_launch",
			attemptId: "attempt_01",
			workRequestId: "request_marketing_launch",
			companyId: "company_hreben",
			anchorSpaceId: "space_marketing",
			agentActorId: "actor_autopilot",
			requesterActorId: "actor_lucia",
			status: "working",
			rootRunId: "run_marketing_launch",
			parentRunId: null,
			delegationDepth: 0,
			lineageFingerprint: "lineage:marketing-launch",
			grantEpoch: 7,
			revocationEpoch: 3,
		},
		agent: {
			actorId: "actor_autopilot",
			companyId: "company_hreben",
			status: "active",
		},
		requesterActorId: "actor_lucia",
		company: {
			id: "company_hreben",
			membershipActorId: "actor_autopilot",
			status: "active",
			membershipStatus: "active",
		},
		anchorSpace: {
			id: "space_marketing",
			companyId: "company_hreben",
			membershipActorId: "actor_autopilot",
			status: "active",
			membershipStatus: "active",
		},
		policies: {
			skillRevisionId: "skill_campaign_research_v3",
			skillAgentActorId: "actor_autopilot",
			skillStatus: "active",
			requestPolicyRevisionId: "request_policy_autopilot_v2",
			requestPolicyAgentActorId: "actor_autopilot",
			requestPolicyStatus: "active",
			executionPolicyRevisionId: "execution_policy_autopilot_v5",
			executionPolicyAgentActorId: "actor_autopilot",
			executionPolicyStatus: "active",
		},
		grants: {
			company: ["company.members.read"],
			anchorSpace: ["messages.read", "messages.create", "tasks.read"],
		},
		capabilities: {
			tools: ["tasks.get", "messages.reply"],
			effects: ["message.create"],
		},
		execution: {
			providerConnectionId: "provider_anthropic_hreben",
			providerConnectionRevision: "provider_revision_4",
			modelOfferingId: "model_claude_phase_0",
			runtime: "direct_generation",
			workMachineId: "machine_default",
			workerId: "worker_embedded_01",
			workerCapabilitiesRevision: "worker_capabilities_8",
			workerStatus: "online",
			workerLeaseId: "lease_run_marketing_launch",
			workerLeaseRunId: "run_marketing_launch",
			workerLeaseAttemptId: "attempt_01",
			workerLeaseWorkerId: "worker_embedded_01",
			workerLeaseEpoch: 11,
			workerLeaseExpiresAt: "2026-07-19T09:10:00.000Z",
			currentWorkerLeaseId: "lease_run_marketing_launch",
			currentWorkerLeaseEpoch: 11,
			workerLeaseStatus: "active",
			workerSupportsRuntime: true,
		},
		currentEpochs: { grant: 7, revocation: 3 },
	};
}

export function authoritySnapshot(
	record: unknown,
): AgentWorkloadAuthoritySnapshot {
	return {
		freshness: "fresh_uncached",
		consistency: "transactional",
		record,
	};
}

export function resolverFor(
	record: AgentWorkloadAuthorityRecord | null = activeAuthority(),
	onRead?: () => void,
	now: () => Date = () => WORKLOAD_NOW,
) {
	return createAgentWorkloadPrincipalResolver({
		audience: "executor",
		authorityStore: {
			loadFreshConsistentAuthority: async () => {
				onRead?.();
				return record ? authoritySnapshot(record) : null;
			},
		},
		now,
		principalId: () => "principal_run_marketing_launch",
	});
}
