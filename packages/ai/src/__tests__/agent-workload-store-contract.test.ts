import { describe, expect, it } from "bun:test";

import { createAgentWorkloadPrincipalResolver } from "../exports/index.js";
import { authoritySnapshot, WORKLOAD_NOW } from "./agent-workload-fixture.js";

const workloadReference = {
	runId: "run_marketing_launch",
	attemptId: "attempt_01",
} as const;

describe("Agent workload authority store boundary", () => {
	it("maps malformed persisted records to a typed secret-safe failure", async () => {
		const resolver = createAgentWorkloadPrincipalResolver({
			audience: "executor",
			authorityStore: {
				loadFreshConsistentAuthority: async () =>
					authoritySnapshot({ run: null }),
			},
			now: () => WORKLOAD_NOW,
		});

		await expect(resolver.resolve(workloadReference)).rejects.toEqual(
			expect.objectContaining({
				name: "AgentWorkloadAuthorityError",
				code: "authority_state_invalid",
			}),
		);
	});

	it("never exposes secret-bearing database exceptions", async () => {
		const resolver = createAgentWorkloadPrincipalResolver({
			audience: "executor",
			authorityStore: {
				loadFreshConsistentAuthority: async () => {
					throw new Error(
						"postgres://agent:supersecret@db/internal relation=actor_role_bindings",
					);
				},
			},
			now: () => WORKLOAD_NOW,
		});

		let caught: unknown;
		try {
			await resolver.resolve(workloadReference);
		} catch (error) {
			caught = error;
		}
		expect(caught).toEqual(
			expect.objectContaining({
				name: "AgentWorkloadAuthorityError",
				code: "authority_store_unavailable",
			}),
		);
		expect((caught as Error).message).not.toContain("supersecret");
		expect((caught as Error).message).not.toContain("actor_role_bindings");
	});

	it("rejects a store result that is not marked fresh and transactional", async () => {
		const resolver = createAgentWorkloadPrincipalResolver({
			audience: "executor",
			authorityStore: {
				loadFreshConsistentAuthority: async () =>
					({
						freshness: "cached",
						consistency: "eventually_consistent",
						record: {},
					}) as never,
			},
			now: () => WORKLOAD_NOW,
		});

		await expect(resolver.resolve(workloadReference)).rejects.toEqual(
			expect.objectContaining({ code: "authority_state_invalid" }),
		);
	});

	it("maps hostile snapshot accessors to the same secret-safe shape failure", async () => {
		const resolver = createAgentWorkloadPrincipalResolver({
			audience: "executor",
			authorityStore: {
				loadFreshConsistentAuthority: async () =>
					({
						freshness: "fresh_uncached",
						consistency: "transactional",
						get record() {
							throw new Error("vault-token=store-secret");
						},
					}) as never,
			},
			now: () => WORKLOAD_NOW,
		});

		let caught: unknown;
		try {
			await resolver.resolve(workloadReference);
		} catch (error) {
			caught = error;
		}
		expect(caught).toEqual(
			expect.objectContaining({ code: "authority_state_invalid" }),
		);
		expect((caught as Error).message).not.toContain("store-secret");
	});
});
