import { describe, expect, it } from "bun:test";

import type { AgentWorkloadSandboxAdmissionClaims } from "../src/agent-workload-admission.js";
import { createAgentWorkloadRuntimeAdmissionAuditEvent } from "../src/agent-workload-runtime-audit.js";

const claims: AgentWorkloadSandboxAdmissionClaims = {
	kind: "agent_workload_sandbox_admission",
	version: 1,
	admissionId: "admission_test_01",
	principalId: "principal_run_marketing_launch",
	runId: "run_marketing_launch",
	attemptId: "attempt_01",
	workRequestId: "request_marketing_launch",
	companyId: "company_hreben",
	anchorSpaceId: "space_marketing",
	agentActorId: "actor_autopilot",
	skillRevisionId: "skill_campaign_research_v3",
	executionPolicyRevisionId: "execution_policy_autopilot_v5",
	sourceSha256: "a".repeat(64),
	inputProjectionId: "projection_anchor_space_v1",
	grantEpoch: 7,
	revocationEpoch: 3,
	workerId: "worker_embedded_01",
	workerLeaseId: "lease_run_marketing_launch",
	workerLeaseEpoch: 11,
	supervisorInstanceId: "sandbox_instance_test_01",
	expiresAt: "2026-07-19T09:00:05.000Z",
	requestSha256: "b".repeat(64),
};

describe("Agent workload runtime admission audit", () => {
	it("attributes a signed denial without disclosing request, source, policy, or path material", () => {
		const event = createAgentWorkloadRuntimeAdmissionAuditEvent(
			"denied",
			"wrong_instance",
			claims,
		);

		expect(event).toEqual({
			event: "questpie.sandbox.agent_admission",
			boundary: "sandbox.runtime_admission",
			decision: "denied",
			reason: "wrong_instance",
			principalId: "principal_run_marketing_launch",
			runId: "run_marketing_launch",
			attemptId: "attempt_01",
			agentActorId: "actor_autopilot",
			companyId: "company_hreben",
			anchorSpaceId: "space_marketing",
			workerId: "worker_embedded_01",
			workerLeaseId: "lease_run_marketing_launch",
			supervisorInstanceId: "sandbox_instance_test_01",
		});
		const serialized = JSON.stringify(event);
		expect(serialized).not.toContain(claims.requestSha256);
		expect(serialized).not.toContain(claims.sourceSha256);
		expect(serialized).not.toContain(claims.skillRevisionId);
		expect(serialized).not.toContain(claims.executionPolicyRevisionId);
		expect(serialized).not.toContain(claims.workRequestId);
	});

	it("keeps an unsigned invalid admission non-attributable", () => {
		expect(
			createAgentWorkloadRuntimeAdmissionAuditEvent("denied", "invalid"),
		).toEqual({
			event: "questpie.sandbox.agent_admission",
			boundary: "sandbox.runtime_admission",
			decision: "denied",
			reason: "invalid",
		});
	});
});
