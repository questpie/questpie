import { describe, expect, it } from "bun:test";
import { homedir } from "node:os";

import { createAgentWorkloadSandboxBoundary } from "../src/exports/index.js";
import {
	sandboxAuthorityFixture,
	sandboxPolicy,
} from "./agent-workload-fixture.js";

describe("Agent workload sandbox policy pinning", () => {
	it("rejects root, HOME, the process cwd, and relative work-root fallbacks", async () => {
		const fixture = await sandboxAuthorityFixture();
		const forbiddenRoots = [
			"/",
			homedir(),
			process.cwd(),
			"relative/workloads",
		];

		for (const workRootBase of forbiddenRoots) {
			expect(() =>
				createAgentWorkloadSandboxBoundary({
					resolver: fixture.resolver,
					workRootBase,
					policy: sandboxPolicy(),
				}),
			).toThrow(/workRootBase/);
		}
	});

	it("rejects every policy not pinned to the exact Company, Space, Skill, execution policy, disclosure, tool, and effect ceiling", async () => {
		const mutations = [
			(policy: ReturnType<typeof sandboxPolicy>) => ({
				...policy,
				companyId: "company_hidden",
			}),
			(policy: ReturnType<typeof sandboxPolicy>) => ({
				...policy,
				anchorSpaceId: "space_finance",
			}),
			(policy: ReturnType<typeof sandboxPolicy>) => ({
				...policy,
				skillRevisionId: "skill_unpinned",
			}),
			(policy: ReturnType<typeof sandboxPolicy>) => ({
				...policy,
				executionPolicyRevisionId: "execution_policy_unpinned",
			}),
			(policy: ReturnType<typeof sandboxPolicy>) => ({
				...policy,
				disclosure: {
					...policy.disclosure,
					anchorSpaceId: "space_finance",
				},
			}),
			(policy: ReturnType<typeof sandboxPolicy>) => ({
				...policy,
				tools: [...policy.tools, "admin.hidden"],
			}),
			(policy: ReturnType<typeof sandboxPolicy>) => ({
				...policy,
				effects: [...policy.effects, "company.delete"],
			}),
		] as const;

		for (const mutate of mutations) {
			const fixture = await sandboxAuthorityFixture();
			const policy = mutate(sandboxPolicy());
			const boundary = createAgentWorkloadSandboxBoundary({
				resolver: fixture.resolver,
				workRootBase: "/var/lib/questpie/workloads",
				policy,
			});

			let denial: unknown;
			try {
				await boundary.open(fixture.authority);
			} catch (error) {
				denial = error;
			}
			expect(denial).toEqual(
				expect.objectContaining({
					code: "sandbox_authority_denied",
					message: "The workload is not authorized for this sandbox operation.",
				}),
			);
			const serialized = JSON.stringify(denial);
			expect(serialized).not.toContain("company_hidden");
			expect(serialized).not.toContain("space_finance");
			expect(serialized).not.toContain("admin.hidden");
			expect(serialized).not.toContain("company.delete");
		}
	});

	it("rejects unpinned execution and allow-all capability policy entries", async () => {
		const fixture = await sandboxAuthorityFixture();
		const unsafePolicies = [
			{
				...sandboxPolicy(),
				execution: {
					...sandboxPolicy().execution,
					sourceSha256: "unpinned",
				},
			},
			{
				...sandboxPolicy(),
				execution: {
					...sandboxPolicy().execution,
					inputProjectionId: "*",
				},
			},
			{ ...sandboxPolicy(), filesystem: { read: ["**"], write: [] } },
			{ ...sandboxPolicy(), filesystem: { read: [], write: ["/**"] } },
			{ ...sandboxPolicy(), network: { fetch: ["*"], import: [] } },
			{ ...sandboxPolicy(), secrets: ["*"] },
			{ ...sandboxPolicy(), tools: ["*"] },
			{ ...sandboxPolicy(), effects: ["*"] },
		] as const;

		for (const policy of unsafePolicies) {
			expect(() =>
				createAgentWorkloadSandboxBoundary({
					resolver: fixture.resolver,
					workRootBase: "/var/lib/questpie/workloads",
					policy,
				}),
			).toThrow(/default-deny/);
		}
	});
});
