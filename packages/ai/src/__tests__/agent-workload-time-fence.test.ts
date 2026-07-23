import { describe, expect, it } from "bun:test";

import {
	createAgentWorkloadPrincipalResolver,
	type AgentWorkloadAuthorityRecord,
} from "../exports/index.js";
import {
	activeAuthority,
	authoritySnapshot,
} from "./agent-workload-fixture.js";

const workloadReference = {
	runId: "run_marketing_launch",
	attemptId: "attempt_01",
} as const;

describe("Agent workload post-read time fence", () => {
	it("rejects a principal that expires while its fresh authority snapshot is loading", async () => {
		let currentTime = new Date("2026-07-19T09:00:00.000Z");
		let reads = 0;
		const resolver = createAgentWorkloadPrincipalResolver({
			audience: "executor",
			authorityStore: {
				loadFreshConsistentAuthority: async () => {
					reads += 1;
					if (reads === 2) {
						currentTime = new Date("2026-07-19T09:06:00.000Z");
					}
					return authoritySnapshot(activeAuthority());
				},
			},
			now: () => currentTime,
		});
		const principal = await resolver.resolve(workloadReference);
		currentTime = new Date("2026-07-19T09:04:59.000Z");

		await expect(resolver.validate(principal)).rejects.toEqual(
			expect.objectContaining({ code: "principal_expired" }),
		);
		expect(reads).toBe(2);
	});

	it("rejects a Worker lease that expires while the snapshot is loading", async () => {
		let currentTime = new Date("2026-07-19T09:00:00.000Z");
		let reads = 0;
		const record: AgentWorkloadAuthorityRecord = {
			...activeAuthority(),
			execution: {
				...activeAuthority().execution,
				workerLeaseExpiresAt: "2026-07-19T09:05:00.000Z",
			},
		};
		const resolver = createAgentWorkloadPrincipalResolver({
			audience: "executor",
			authorityStore: {
				loadFreshConsistentAuthority: async () => {
					reads += 1;
					if (reads === 2) {
						currentTime = new Date("2026-07-19T09:05:01.000Z");
					}
					return authoritySnapshot(record);
				},
			},
			now: () => currentTime,
		});
		const principal = await resolver.resolve(workloadReference);
		currentTime = new Date("2026-07-19T09:04:59.000Z");

		await expect(resolver.validate(principal)).rejects.toEqual(
			expect.objectContaining({ code: "worker_lease_stale" }),
		);
		expect(reads).toBe(2);
	});

	it("mints only after the first snapshot returns and its lease is still live", async () => {
		let currentTime = new Date("2026-07-19T09:04:59.000Z");
		let reads = 0;
		const record: AgentWorkloadAuthorityRecord = {
			...activeAuthority(),
			execution: {
				...activeAuthority().execution,
				workerLeaseExpiresAt: "2026-07-19T09:05:00.000Z",
			},
		};
		const resolver = createAgentWorkloadPrincipalResolver({
			audience: "executor",
			authorityStore: {
				loadFreshConsistentAuthority: async () => {
					reads += 1;
					currentTime = new Date("2026-07-19T09:05:01.000Z");
					return authoritySnapshot(record);
				},
			},
			now: () => currentTime,
		});

		await expect(resolver.resolve(workloadReference)).rejects.toEqual(
			expect.objectContaining({ code: "worker_lease_stale" }),
		);
		expect(reads).toBe(1);
	});
});
