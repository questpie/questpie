import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { join } from "node:path";

import {
	createAgentWorkloadSandboxBoundary,
	httpSandboxAdapter,
} from "../src/exports/index.js";
import {
	activeSandboxAuthority,
	sandboxAuthorityFixture,
	sandboxPolicy,
} from "./agent-workload-fixture.js";
import {
	AGENT_ADMISSION_KEY,
	AgentWorkloadHttpServerFixture,
	denoPath,
	waitForAgentWorkDirectory,
} from "./agent-workload-http-server-fixture.js";

const server = new AgentWorkloadHttpServerFixture();

function sourceSha256(source: string): string {
	return createHash("sha256").update(source).digest("hex");
}

beforeAll(() => server.start(), 20_000);
afterAll(() => server.stop());

describe.if(!!denoPath)("Agent workload HTTP sandbox boundary", () => {
	it("runs through a freshly revalidated Agent adapter admission", async () => {
		const fixture = await sandboxAuthorityFixture({ now: new Date() });
		let resolvedProjectionReference: unknown;
		const agentSource = `export default async (input) => {
			await new Promise((resolve) => setTimeout(resolve, 300));
			const nodeProcess = (await import("node:process")).default;
			let network = "allowed";
			try { await fetch("https://attacker.example"); } catch { network = "denied"; }
			return {
				answer: input.value * 2,
				cwd: Deno.cwd(),
				nodeCwd: nodeProcess.cwd(),
				mainModule: Deno.mainModule,
				argv: nodeProcess.argv,
				argv0: nodeProcess.argv0,
				execPath: nodeProcess.execPath,
				secret: globalThis.__secrets?.provider ?? "absent",
				bindings: typeof globalThis.questpie,
				network,
			};
		}`;
		const boundary = createAgentWorkloadSandboxBoundary({
			resolver: fixture.resolver,
			workRootBase: server.workRootBase,
			policy: {
				...sandboxPolicy(),
				network: { fetch: [], import: [] },
				secrets: [],
				execution: {
					sourceSha256: sourceSha256(agentSource),
					inputProjectionId: "projection_anchor_space_v1",
				},
			},
		});
		const adapter = httpSandboxAdapter({
			url: server.url,
			agentWorkload: {
				boundary,
				admission: AGENT_ADMISSION_KEY,
				execution: {
					source: agentSource,
					timeoutMs: 8_000,
					memoryMb: 128,
					inputProjections: {
						resolve: async (reference) => {
							resolvedProjectionReference = reference;
							return async ({ principal, disclosure }) => ({
								value: 21,
								runId: principal.run.id,
								anchorSpaceId: disclosure.anchorSpaceId,
							});
						},
					},
				},
			},
		});

		const callerAuthoredExtras = {
			authority: fixture.authority,
			input: { value: 999, providerCredential: "must-not-cross" },
			source: "export default async () => 'forged'",
			capabilities: { net: ["attacker.example:443"] },
			secrets: { provider: "stolen" },
			bindings: {
				url: "https://attacker.example/sandbox-rpc",
				token: "forged",
			},
		};
		const run = adapter.runAgentWorkload(callerAuthoredExtras);
		const attemptRoot = join(
			server.workRootBase,
			"company_hreben",
			"request_marketing_launch",
			"attempt_01",
		);
		const admissionRoots = await waitForAgentWorkDirectory(attemptRoot);
		const result = await run;

		expect(admissionRoots).toHaveLength(1);
		expect(admissionRoots[0]).toMatch(/^[0-9a-f-]{36}$/);
		expect(result.error).toBeUndefined();
		expect(result.ok).toBe(true);
		expect(result.output).toEqual({
			answer: 42,
			cwd: "/work",
			nodeCwd: "/work",
			mainModule: "questpie://sandbox/guest-entry.ts",
			argv: ["deno", "questpie://sandbox/guest-entry.ts"],
			argv0: "/runtime/deno",
			execPath: "/runtime/deno",
			secret: "absent",
			bindings: "undefined",
			network: "denied",
		});
		expect(JSON.stringify(result.output)).not.toContain(server.workRootBase);
		expect(JSON.stringify(result.output)).not.toContain(process.cwd());
		expect(resolvedProjectionReference).toEqual({
			id: "projection_anchor_space_v1",
			skillRevisionId: "skill_campaign_research_v3",
			executionPolicyRevisionId: "execution_policy_autopilot_v5",
			sourceSha256: sourceSha256(agentSource),
		});
		expect(fixture.reads()).toBe(4);
	}, 20_000);

	it("rejects a stale Worker lease before HTTP admission or guest creation", async () => {
		const now = new Date();
		const fixture = await sandboxAuthorityFixture({ now });
		const record = activeSandboxAuthority();
		fixture.setRecord({
			...record,
			execution: {
				...record.execution,
				workerLeaseExpiresAt: new Date(
					now.getTime() + 10 * 60_000,
				).toISOString(),
				currentWorkerLeaseId: "lease_reassigned",
				currentWorkerLeaseEpoch: 12,
			},
		});
		const adapter = httpSandboxAdapter({
			url: server.url,
			agentWorkload: {
				boundary: createAgentWorkloadSandboxBoundary({
					resolver: fixture.resolver,
					workRootBase: server.workRootBase,
					policy: sandboxPolicy(),
				}),
				admission: AGENT_ADMISSION_KEY,
				execution: {
					source: "export default async () => 'must not run'",
					timeoutMs: 8_000,
					memoryMb: 128,
					inputProjections: {
						resolve: async () => async () => ({}),
					},
				},
			},
		});

		await expect(
			adapter.runAgentWorkload({ authority: fixture.authority }),
		).rejects.toEqual(expect.objectContaining({ code: "worker_lease_stale" }));
		expect(fixture.reads()).toBe(2);
	}, 20_000);

	it("rejects executable source not bound to the pinned Skill revision", async () => {
		const fixture = await sandboxAuthorityFixture({ now: new Date() });
		const expectedSource = "export default async () => 'pinned'";
		const adapter = httpSandboxAdapter({
			url: server.url,
			agentWorkload: {
				boundary: createAgentWorkloadSandboxBoundary({
					resolver: fixture.resolver,
					workRootBase: server.workRootBase,
					policy: {
						...sandboxPolicy(),
						network: { fetch: [], import: [] },
						execution: {
							sourceSha256: sourceSha256(expectedSource),
							inputProjectionId: "projection_anchor_space_v1",
						},
					},
				}),
				admission: AGENT_ADMISSION_KEY,
				execution: {
					source: "export default async () => 'different-skill'",
					timeoutMs: 8_000,
					memoryMb: 128,
					inputProjections: {
						resolve: async () => async () => ({}),
					},
				},
			},
		});

		await expect(
			adapter.runAgentWorkload({ authority: fixture.authority }),
		).rejects.toEqual(
			expect.objectContaining({ code: "sandbox_authority_denied" }),
		);
	}, 20_000);

	it("rejects a projector that self-asserts the pinned projection id", async () => {
		const fixture = await sandboxAuthorityFixture({ now: new Date() });
		const source = "export default async (input) => input";
		let substitutedProjectorRan = false;
		const adapter = httpSandboxAdapter({
			url: server.url,
			agentWorkload: {
				boundary: createAgentWorkloadSandboxBoundary({
					resolver: fixture.resolver,
					workRootBase: server.workRootBase,
					policy: {
						...sandboxPolicy(),
						network: { fetch: [], import: [] },
						execution: {
							sourceSha256: sourceSha256(source),
							inputProjectionId: "projection_anchor_space_v1",
						},
					},
				}),
				admission: AGENT_ADMISSION_KEY,
				execution: {
					source,
					timeoutMs: 8_000,
					memoryMb: 128,
					inputProjections: { resolve: async () => null },
					inputProjection: {
						id: "projection_anchor_space_v1",
						project: async () => {
							substitutedProjectorRan = true;
							return { hidden: "must-not-cross" };
						},
					},
				} as never,
			},
		});

		await expect(
			adapter.runAgentWorkload({ authority: fixture.authority }),
		).rejects.toEqual(
			expect.objectContaining({ code: "sandbox_authority_denied" }),
		);
		expect(substitutedProjectorRan).toBe(false);
	}, 20_000);

	it("revalidates after input projection and before remote spawn", async () => {
		const now = new Date();
		const fixture = await sandboxAuthorityFixture({ now });
		const source = "export default async () => 'must not spawn'";
		const record = activeSandboxAuthority();
		const adapter = httpSandboxAdapter({
			url: server.url,
			agentWorkload: {
				boundary: createAgentWorkloadSandboxBoundary({
					resolver: fixture.resolver,
					workRootBase: server.workRootBase,
					policy: {
						...sandboxPolicy(),
						network: { fetch: [], import: [] },
						execution: {
							sourceSha256: sourceSha256(source),
							inputProjectionId: "projection_anchor_space_v1",
						},
					},
				}),
				admission: AGENT_ADMISSION_KEY,
				execution: {
					source,
					timeoutMs: 8_000,
					memoryMb: 128,
					inputProjections: {
						resolve: async () => async () => {
							fixture.setRecord({
								...record,
								execution: {
									...record.execution,
									workerLeaseExpiresAt: new Date(
										now.getTime() + 10 * 60_000,
									).toISOString(),
								},
								currentEpochs: {
									...record.currentEpochs,
									revocation: 4,
								},
							});
							return {};
						},
					},
				},
			},
		});

		await expect(
			adapter.runAgentWorkload({ authority: fixture.authority }),
		).rejects.toEqual(
			expect.objectContaining({ code: "authority_epoch_stale" }),
		);
	}, 20_000);
});
