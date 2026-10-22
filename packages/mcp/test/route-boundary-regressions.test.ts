import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ApiError, route } from "questpie";
import { z } from "zod";

import { buildMockApp } from "../../questpie/test/utils/mocks/mock-app-builder.js";
import {
	createMcpServer,
	createWorkloadMcpServer,
} from "../src/exports/index.js";
import {
	McpProductError,
	McpPublicError,
} from "../src/server/execution-boundary.js";

function errorCode(result: CallToolResult) {
	expect(result.isError).toBe(true);
	expect(result.structuredContent).toBeUndefined();
	return result._meta?.["questpie/error"];
}

describe("route execution boundary regressions", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	let human: Awaited<ReturnType<typeof createMcpServer>>;
	let workload: Awaited<ReturnType<typeof createWorkloadMcpServer>>;
	let humanClient: Client;
	let workloadClient: Client;
	let transforms = 0;
	let policyCalls = 0;
	let handoffCalls = 0;
	let credentialsAllowed = true;
	let policyFailure: unknown;
	let failure: unknown;
	const diagnostics: unknown[] = [];

	beforeAll(async () => {
		const base = () => route().post().schema(z.object({}));
		setup = await buildMockApp({
			routes: {
				"good:POST": base()
					.access(true)
					.meta({ mcp: { expose: true, name: "good" } })
					.handler(() => ({ ok: true })),
				"bad:POST": base()
					.access(true)
					.meta({ mcp: { expose: true, name: "bad" } })
					.handler(() => ({ ok: true })),
				"static:POST": base()
					.access(false)
					.meta({ mcp: { expose: true, name: "static" } })
					.handler(() => ({ ok: true })),
				"staticObject:POST": base()
					.access({ execute: false })
					.meta({ mcp: { expose: true, name: "staticObject" } })
					.handler(() => ({ ok: true })),
				"input:POST": route()
					.post()
					.schema(
						z.object({
							title: z.string().transform((value) => {
								transforms++;
								return value.length;
							}),
						}),
					)
					.access((ctx) => {
						policyCalls++;
						return (
							(ctx as unknown as { input: { title: number } }).input.title > 0
						);
					})
					.meta({ mcp: { expose: true, name: "input" } })
					.handler(({ input }) => {
						if (failure) throw failure;
						return input;
					}),
			},
		});
		const routes = Object.fromEntries(
			["good", "bad", "static", "staticObject", "input"].map((name) => [
				name,
				{
					operations: {
						execute:
							name === "bad"
								? () => {
										if (policyFailure) throw policyFailure;
										return true;
									}
								: true,
					},
					requiredScopes: false as const,
					workload: {
						capabilities: [name],
						...(name === "input" ? { handoff: "approve" } : {}),
					},
				},
			]),
		);
		human = await createMcpServer(setup.app, {
			config: {
				routes: { routes },
				execution: {
					onDiagnostic: (event) => {
						diagnostics.push(event);
					},
				},
			},
		});
		workload = await createWorkloadMcpServer(setup.app, {
			envelope: { opaque: true },
			authorizer: {
				authorize: async () =>
					credentialsAllowed ? { context: { opaque: true } } : null,
			},
			contextBinder: {
				bind: async () => ({
					...(await setup.app.createContext({ accessMode: "user" })),
				}),
			},
			handoff: {
				execute: async ({ invoke }) => {
					handoffCalls++;
					return invoke();
				},
			},
			config: { routes: { routes } },
		});
		for (const [index, server] of [human, workload].entries()) {
			const [ct, st] = InMemoryTransport.createLinkedPair();
			const client = new Client({ name: "route-regression", version: "1" });
			await server.connect(st);
			await client.connect(ct);
			if (index === 0) humanClient = client;
			else workloadClient = client;
		}
	});

	afterAll(async () => {
		await humanClient?.close();
		await workloadClient?.close();
		await human?.close();
		await workload?.close();
		await setup?.cleanup();
	});

	it("hides statically denied routes and never evaluates input-dependent product rules during discovery", async () => {
		const before = policyCalls;
		for (const client of [humanClient, workloadClient]) {
			const names = (await client.listTools()).tools.map((tool) => tool.name);
			expect(names).toContain("input");
			expect(names).not.toContain("static");
			expect(names).not.toContain("staticObject");
		}
		expect(policyCalls).toBe(before);
		const denied = await humanClient.callTool({
			name: "input",
			arguments: { title: "" },
		});
		expect(errorCode(denied)).toMatchObject({ code: "FORBIDDEN" });
		expect(policyCalls).toBe(before + 1);
	});

	it("skips only the failing discovery tool for legacy and explicit product policy failures", async () => {
		try {
			for (const error of [
				ApiError.forbidden({ operation: "read", resource: "route" }),
				new McpProductError(ApiError.conflict("secret-policy")),
			]) {
				policyFailure = error;
				const names = (await workloadClient.listTools()).tools.map(
					(tool) => tool.name,
				);
				expect(names).toContain("good");
				expect(names).not.toContain("bad");
			}
			policyFailure = new McpPublicError("busy");
			await expect(workloadClient.listTools()).rejects.toThrow("busy");
		} finally {
			policyFailure = undefined;
		}
	});

	it("authorizes credentials before transforms, parses once before handoff and preserves canonical failures", async () => {
		const before = { transforms, handoffCalls, policyCalls };
		credentialsAllowed = false;
		try {
			const denied = await workloadClient.callTool({
				name: "input",
				arguments: { title: "hello" },
			});
			expect(errorCode(denied)).toMatchObject({ code: "access_denied" });
			expect(transforms).toBe(before.transforms);
		} finally {
			credentialsAllowed = true;
		}
		const invalid = await workloadClient.callTool({
			name: "input",
			arguments: { title: 123 },
		});
		expect(errorCode(invalid)).toMatchObject({ code: "VALIDATION_ERROR" });
		expect(
			JSON.parse((invalid.content[0] as { text: string }).text).error
				.fieldErrors[0].path,
		).toBe("title");
		expect(handoffCalls).toBe(before.handoffCalls);
		expect(policyCalls).toBe(before.policyCalls);
		const ok = await workloadClient.callTool({
			name: "input",
			arguments: { title: "hello" },
		});
		expect(ok.structuredContent).toEqual({ title: 5 });
		expect(transforms).toBe(before.transforms + 1);
		expect(handoffCalls).toBe(before.handoffCalls + 1);
		try {
			failure = ApiError.conflict("Stale version");
			const conflict = await workloadClient.callTool({
				name: "input",
				arguments: { title: "hello" },
			});
			expect(errorCode(conflict)).toMatchObject({ code: "CONFLICT" });
			expect(
				JSON.parse((conflict.content[0] as { text: string }).text).error.code,
			).toBe("CONFLICT");
		} finally {
			failure = undefined;
		}
	});

	it("retains secret-safe diagnostics for canonical internal route errors", async () => {
		try {
			failure = new Error("postgres://private-password");
			const result = await humanClient.callTool({
				name: "input",
				arguments: { title: "hello" },
			});
			expect(errorCode(result)).toMatchObject({
				code: "INTERNAL_SERVER_ERROR",
			});
			await Bun.sleep(0);
			expect(diagnostics.at(-1)).toMatchObject({
				code: "INTERNAL_SERVER_ERROR",
				internalError: { kind: "Error" },
			});
			expect(JSON.stringify([result, diagnostics])).not.toContain(
				"private-password",
			);
		} finally {
			failure = undefined;
		}
	});
});
