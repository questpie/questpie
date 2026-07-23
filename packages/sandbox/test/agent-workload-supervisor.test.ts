import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { sealAgentWorkloadSandboxAdmission } from "../src/agent-workload-admission.js";
import {
	AGENT_ADMISSION_KEY,
	AgentWorkloadHttpServerFixture,
	NON_AGENT_ADMISSION_SECRET,
	agentAdmissionClaims,
	agentRequestBody,
	denoPath,
	postAgentRequest,
} from "./agent-workload-http-server-fixture.js";

const server = new AgentWorkloadHttpServerFixture();

beforeAll(() => server.start(), 20_000);
afterAll(() => server.stop());

describe.if(!!denoPath)("Agent workload Deno supervisor admission", () => {
	it.if(process.env.SANDBOX_EXPECT_NETNS_FIREWALL === "1")(
		"loads the self-contained guest entry inside an active Linux network namespace",
		async () => {
			const response = await fetch(`${server.url}/run`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-questpie-non-agent-admission": NON_AGENT_ADMISSION_SECRET,
				},
				body: JSON.stringify({
					mode: "non_agent",
					source: "export default async () => 'netns-ready'",
					input: null,
					capabilities: {
						net: [],
						import: [],
						timeoutMs: 5_000,
						memoryMb: 128,
					},
				}),
			});
			const result = (await response.json()) as {
				ok: boolean;
				output?: unknown;
			};

			expect(result).toMatchObject({ ok: true, output: "netns-ready" });
			expect(
				await server.waitForOutputLine((line) =>
					line.includes("egress firewall: ACTIVE"),
				),
			).toContain("netns + nftables");
		},
		20_000,
	);

	it("rejects omission of execution provenance instead of downgrading to non-Agent", async () => {
		const response = await fetch(`${server.url}/run`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				source: "export default async () => 'downgraded'",
				input: null,
				capabilities: {
					net: [],
					import: [],
					timeoutMs: 5_000,
					memoryMb: 128,
				},
			}),
		});

		expect(response.status).toBe(403);
		expect(
			await server.waitForAdmissionAudit(
				(event) => event.reason === "unknown_mode",
			),
		).toEqual({
			event: "questpie.sandbox.agent_admission",
			boundary: "sandbox.runtime_admission",
			decision: "denied",
			reason: "unknown_mode",
		});
	}, 20_000);

	it("audits invalid authentication on the explicit non-Agent path", async () => {
		const response = await fetch(`${server.url}/run`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				mode: "non_agent",
				source: "export default async () => 'must-not-run'",
				input: null,
				capabilities: {
					net: [],
					import: [],
					timeoutMs: 5_000,
					memoryMb: 128,
				},
			}),
		});

		expect(response.status).toBe(403);
		expect(
			await server.waitForAdmissionAudit(
				(event) => event.reason === "non_agent_unauthorized",
			),
		).toEqual({
			event: "questpie.sandbox.agent_admission",
			boundary: "sandbox.runtime_admission",
			decision: "denied",
			reason: "non_agent_unauthorized",
		});
	}, 20_000);

	it("rejects caller-authored execution controls without workload admission", async () => {
		const response = await postAgentRequest(
			server.url,
			JSON.stringify({
				mode: "agent_workload",
				source: "export default async () => 'forged'",
				input: null,
				capabilities: {
					net: ["attacker.example:443"],
					import: [],
					timeoutMs: 5_000,
					memoryMb: 128,
				},
				secrets: { provider: "stolen" },
				bindings: {
					url: "https://attacker.example/sandbox-rpc",
					token: "forged",
				},
			}),
		);

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({
			ok: false,
			error: "The workload is not authorized for this sandbox operation.",
			logs: [],
		});
	}, 20_000);

	it("rejects a forged workload admission before spawning the Agent guest", async () => {
		const response = await postAgentRequest(
			server.url,
			agentRequestBody("export default async () => 'forged'"),
			"forged",
		);

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({
			ok: false,
			error: "The workload is not authorized for this sandbox operation.",
			logs: [],
		});
	}, 20_000);

	it("rejects a signed admission when the caller widens its exact request body", async () => {
		const admittedSource = "export default async () => 'safe'";
		const admittedBody = agentRequestBody(admittedSource, {
			secrets: {},
		});
		const admission = await sealAgentWorkloadSandboxAdmission(
			AGENT_ADMISSION_KEY,
			agentAdmissionClaims(
				new Date(Date.now() + 5_000).toISOString(),
				admittedSource,
			),
			admittedBody,
		);
		const widenedBody = JSON.stringify({
			...JSON.parse(admittedBody),
			capabilities: {
				net: ["attacker.example:443"],
				import: [],
				timeoutMs: 5_000,
				memoryMb: 128,
			},
			secrets: { provider: "stolen" },
		});

		const response = await postAgentRequest(server.url, widenedBody, admission);

		expect(response.status).toBe(403);
	}, 20_000);

	it("rejects an expired signed admission before spawning the Agent guest", async () => {
		const source = "export default async () => 'expired'";
		const requestBody = agentRequestBody(source);
		const admission = await sealAgentWorkloadSandboxAdmission(
			AGENT_ADMISSION_KEY,
			agentAdmissionClaims(new Date(Date.now() - 1).toISOString(), source),
			requestBody,
		);

		const response = await postAgentRequest(server.url, requestBody, admission);

		expect(response.status).toBe(403);
	}, 20_000);

	it("consumes each signed admission only once", async () => {
		const source = "export default async () => 'first'";
		const requestBody = agentRequestBody(source);
		const admission = await sealAgentWorkloadSandboxAdmission(
			AGENT_ADMISSION_KEY,
			agentAdmissionClaims(new Date(Date.now() + 5_000).toISOString(), source),
			requestBody,
		);

		const first = await postAgentRequest(server.url, requestBody, admission);
		const replay = await postAgentRequest(server.url, requestBody, admission);

		expect(first.status).toBe(200);
		expect(replay.status).toBe(403);
	}, 20_000);

	it("rejects signed source that differs from the pinned Skill digest", async () => {
		const requestSource = "export default async () => 'different-skill'";
		const requestBody = agentRequestBody(requestSource);
		const admission = await sealAgentWorkloadSandboxAdmission(
			AGENT_ADMISSION_KEY,
			agentAdmissionClaims(
				new Date(Date.now() + 5_000).toISOString(),
				"export default async () => 'pinned-skill'",
			),
			requestBody,
		);

		const response = await postAgentRequest(server.url, requestBody, admission);

		expect(response.status).toBe(403);
	}, 20_000);

	it("rejects admission minted for another supervisor instance", async () => {
		const source = "export default async () => 'wrong-instance'";
		const requestBody = agentRequestBody(source);
		const admission = await sealAgentWorkloadSandboxAdmission(
			AGENT_ADMISSION_KEY,
			{
				...agentAdmissionClaims(
					new Date(Date.now() + 5_000).toISOString(),
					source,
				),
				supervisorInstanceId: "sandbox_instance_other",
			},
			requestBody,
		);

		const response = await postAgentRequest(server.url, requestBody, admission);

		expect(response.status).toBe(403);
	}, 20_000);
});
