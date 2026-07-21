import { describe, expect, it } from "bun:test";

import {
	AgentWorkloadAuthorityError,
	type AgentWorkloadAuthorityRecord,
} from "../exports/index.js";
import { activeAuthority, resolverFor } from "./agent-workload-fixture.js";

describe("Agent workload persisted binding integrity", () => {
	it("fails closed when joined authority records do not describe one exact workload", async () => {
		const base = activeAuthority();
		const cases: AgentWorkloadAuthorityRecord[] = [
			{ ...base, run: { ...base.run, companyId: "company_other" } },
			{
				...base,
				anchorSpace: { ...base.anchorSpace, companyId: "company_other" },
			},
			{
				...base,
				company: { ...base.company, membershipActorId: "actor_other" },
			},
			{
				...base,
				policies: { ...base.policies, skillAgentActorId: "actor_other" },
			},
			{
				...base,
				execution: {
					...base.execution,
					workerLeaseRunId: "run_other",
				},
			},
			{
				...base,
				execution: {
					...base.execution,
					workerLeaseWorkerId: "worker_other",
				},
			},
			{
				...base,
				run: {
					...base.run,
					rootRunId: "run_root",
					parentRunId: base.run.id,
					delegationDepth: 1,
				},
			},
			{
				...base,
				run: {
					...base.run,
					parentRunId: "run_parent",
					delegationDepth: 1,
				},
			},
		];

		for (const record of cases) {
			await expect(
				resolverFor(record).resolve({
					runId: "run_marketing_launch",
					attemptId: "attempt_01",
				}),
			).rejects.toEqual(
				expect.objectContaining({
					code: "authority_state_inconsistent",
				} satisfies Partial<AgentWorkloadAuthorityError>),
			);
		}
	});

	it("never falls back to requester, session, OAuth, Worker service, or system authority", async () => {
		let reads = 0;
		const resolve = resolverFor(activeAuthority(), () => reads++)
			.resolve as unknown as (
			input: Record<string, unknown>,
		) => Promise<unknown>;
		const forbiddenFallbacks = [
			"user",
			"session",
			"cookie",
			"oauth",
			"workerService",
			"system",
			"requesterActorId",
			"parentAgentActorId",
		];

		for (const fallback of forbiddenFallbacks) {
			await expect(
				resolve({
					runId: "run_marketing_launch",
					attemptId: "attempt_01",
					[fallback]: "ambient-authority",
				}),
			).rejects.toEqual(
				expect.objectContaining({
					code: "invalid_resolution_input",
				} satisfies Partial<AgentWorkloadAuthorityError>),
			);
		}
		expect(reads).toBe(0);
	});
});
