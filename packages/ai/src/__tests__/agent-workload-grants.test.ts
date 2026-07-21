import { describe, expect, it } from "bun:test";

import {
	allowsExactScopedGrant,
	type ExactScopedGrantAuthority,
} from "../exports/index.js";
import { activeAuthority, resolverFor } from "./agent-workload-fixture.js";

describe("Agent workload exact-scope grants", () => {
	it("does not treat a Company grant as anchor-Space content access", async () => {
		const resolver = resolverFor(activeAuthority());
		const principal = await resolver.resolve({
			runId: "run_marketing_launch",
			attemptId: "attempt_01",
		});

		expect(
			await resolver.hasGrant(principal, {
				scope: "company",
				companyId: "company_hreben",
				grant: "company.members.read",
			}),
		).toBe(true);
		expect(
			await resolver.hasGrant(principal, {
				scope: "anchor_space",
				companyId: "company_hreben",
				anchorSpaceId: "space_marketing",
				grant: "company.members.read",
			}),
		).toBe(false);
		expect(
			await resolver.hasGrant(principal, {
				scope: "anchor_space",
				companyId: "company_hreben",
				anchorSpaceId: "space_product",
				grant: "messages.read",
			}),
		).toBe(false);
	});

	it("uses one actor-kind-neutral evaluator for equal Human and Agent bindings", async () => {
		const resolver = resolverFor(activeAuthority());
		const agent = await resolver.resolve({
			runId: "run_marketing_launch",
			attemptId: "attempt_01",
		});
		const humanAuthority: ExactScopedGrantAuthority = {
			scope: {
				companyId: "company_hreben",
				anchorSpaceId: "space_marketing",
			},
			grants: {
				company: ["company.members.read"],
				anchorSpace: ["messages.read", "messages.create", "tasks.read"],
			},
		};
		const requirements = [
			{
				scope: "company" as const,
				companyId: "company_hreben",
				grant: "company.members.read",
			},
			{
				scope: "anchor_space" as const,
				companyId: "company_hreben",
				anchorSpaceId: "space_marketing",
				grant: "messages.create",
			},
			{
				scope: "anchor_space" as const,
				companyId: "company_hreben",
				anchorSpaceId: "space_marketing",
				grant: "providers.manage",
			},
		];

		for (const requirement of requirements) {
			expect(allowsExactScopedGrant(humanAuthority, requirement)).toBe(
				await resolver.hasGrant(agent, requirement),
			);
		}
	});
});
