import {
	createAuthenticatedAgentWorkloadTransport,
	createAgentWorkloadPrincipalResolver,
	type AgentWorkloadAudience,
	type AgentWorkloadAuthorityRecord,
	type AgentWorkloadAuthoritySnapshot,
} from "@questpie/ai";

import type { AgentWorkloadSandboxPolicy } from "../src/exports/index.js";

export const WORKLOAD_NOW = new Date("2026-07-19T09:00:00.000Z");

export function sandboxPolicy(): AgentWorkloadSandboxPolicy {
	return {
		companyId: "company_hreben",
		anchorSpaceId: "space_marketing",
		skillRevisionId: "skill_campaign_research_v3",
		executionPolicyRevisionId: "execution_policy_autopilot_v5",
		execution: {
			sourceSha256:
				"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			inputProjectionId: "projection_anchor_space_v1",
		},
		filesystem: { read: ["inputs/**"], write: ["outputs/**"] },
		network: { fetch: ["api.example.com:443"], import: [] },
		secrets: ["campaign-api"],
		tools: ["tasks.get"],
		effects: ["message.create"],
		disclosure: {
			mode: "anchor_space",
			anchorSpaceId: "space_marketing",
		},
	};
}

export function activeSandboxAuthority(): AgentWorkloadAuthorityRecord {
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

function authoritySnapshot(record: unknown): AgentWorkloadAuthoritySnapshot {
	return {
		freshness: "fresh_uncached",
		consistency: "transactional",
		record,
	};
}

export async function sandboxAuthorityFixture(options?: {
	readonly authorityAudience?: AgentWorkloadAudience;
	readonly now?: Date;
}) {
	let record = activeSandboxAuthority();
	let now = options?.now ?? WORKLOAD_NOW;
	if (options?.now) {
		record = {
			...record,
			execution: {
				...record.execution,
				workerLeaseExpiresAt: new Date(
					options.now.getTime() + 10 * 60_000,
				).toISOString(),
			},
		};
	}
	let reads = 0;
	const authorityStore = {
		async loadFreshConsistentAuthority() {
			reads += 1;
			return authoritySnapshot(record);
		},
	};
	const resolver = createAgentWorkloadPrincipalResolver({
		audience: "sandbox",
		authorityStore,
		now: () => now,
		principalId: () => "principal_run_marketing_launch",
	});
	const issuer =
		options?.authorityAudience && options.authorityAudience !== "sandbox"
			? createAgentWorkloadPrincipalResolver({
					audience: options.authorityAudience,
					authorityStore,
					now: () => now,
					principalId: () => "principal_run_marketing_launch",
				})
			: resolver;
	const transport = createAuthenticatedAgentWorkloadTransport({
		keyId: "sandbox-control-plane-v1",
		secret: new TextEncoder().encode(
			"hreben-sandbox-workload-transport-key-32-bytes-minimum",
		),
	});
	const principal = await issuer.resolve({
		runId: record.run.id,
		attemptId: record.run.attemptId,
	});
	const authority = transport.open(transport.seal(principal));

	return {
		authority,
		principal,
		resolver,
		reads: () => reads,
		setRecord: (next: AgentWorkloadAuthorityRecord) => {
			record = next;
		},
		setNow: (next: Date) => {
			now = next;
		},
	};
}
