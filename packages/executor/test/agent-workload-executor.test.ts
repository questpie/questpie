import { describe, expect, it } from "bun:test";

import {
	createAuthenticatedAgentWorkloadTransport,
	type AgentWorkloadAuthorityStore,
	createAgentWorkloadPrincipalResolver,
} from "@questpie/ai";

import { activeAuthority } from "../../ai/src/__tests__/agent-workload-fixture.js";
import { createAgentWorkloadExecutorBoundary } from "../src/exports/index.js";
import {
	createExecutorFixture,
	EXECUTOR_NOW,
	EXECUTOR_TRANSPORT_SECRET,
} from "./agent-workload-executor-fixture.js";

describe("Agent workload executor boundary", () => {
	it("starts only after authenticating and freshly validating the exact leased workload", async () => {
		let reads = 0;
		const authorityStore: AgentWorkloadAuthorityStore = {
			async loadFreshConsistentAuthority() {
				reads += 1;
				return null;
			},
		};
		const resolver = createAgentWorkloadPrincipalResolver({
			audience: "executor",
			authorityStore,
			now: () => EXECUTOR_NOW,
		});
		const transport = createAuthenticatedAgentWorkloadTransport({
			keyId: "executor-control-plane-v1",
			secret: EXECUTOR_TRANSPORT_SECRET,
		});
		const boundary = createAgentWorkloadExecutorBoundary({
			resolver,
			transport,
		});

		await expect(
			boundary.start(
				{
					authority: "",
					fence: {
						runId: "run_marketing_launch",
						attemptId: "attempt_01",
						workerId: "worker_embedded_01",
						leaseId: "lease_run_marketing_launch",
						leaseEpoch: 11,
					},
				},
				async () => "must not run",
			),
		).rejects.toEqual(
			expect.objectContaining({
				name: "AgentWorkloadAuthorityError",
				code: "invalid_principal",
			}),
		);
		expect(reads).toBe(0);
	});

	it("passes only the freshly authorized principal to a start operation", async () => {
		const fixture = createExecutorFixture();
		const principal = await fixture.resolver.resolve({
			runId: fixture.fence.runId,
			attemptId: fixture.fence.attemptId,
		});
		const authority = fixture.transport.seal(principal);
		fixture.resetReads();

		const result = await fixture.boundary.start(
			{ authority, fence: fixture.fence },
			async (authorized) => ({
				principalId: authorized.principalId,
				agentActorId: authorized.attribution.agentActorId,
			}),
		);

		expect(result).toEqual({
			principalId: "principal_executor_fixture",
			agentActorId: "actor_autopilot",
		});
		expect(fixture.reads()).toBe(1);
	});

	it("resume re-resolves authority and rejects an obsolete snapshot before work", async () => {
		const fixture = createExecutorFixture();
		const principal = await fixture.resolver.resolve({
			runId: fixture.fence.runId,
			attemptId: fixture.fence.attemptId,
		});
		const authority = fixture.transport.seal(principal);
		const current = activeAuthority();
		fixture.setRecord({
			...current,
			run: { ...current.run, grantEpoch: 8 },
			currentEpochs: { ...current.currentEpochs, grant: 8 },
		});
		fixture.resetReads();
		let operations = 0;

		await expect(
			fixture.boundary.resume({ authority, fence: fixture.fence }, async () => {
				operations += 1;
			}),
		).rejects.toEqual(
			expect.objectContaining({ code: "authority_epoch_stale" }),
		);
		expect(operations).toBe(0);
		expect(fixture.reads()).toBe(1);
	});
});
