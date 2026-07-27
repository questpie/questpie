import { describe, expect, it } from "bun:test";

import { z } from "zod";

import { mcpTool } from "@questpie/mcp";

import { buildMockApp } from "../../questpie/test/utils/mocks/mock-app-builder.js";
import {
	BROKER_CUSTOM_ARGUMENT_CAP_BYTES,
	BROKER_CUSTOM_RESULT_CAP_BYTES,
} from "../src/broker-wire.js";
import {
	handleSandboxCustomToolsRpc as handleSandboxCustomToolsRpcRaw,
	registerSandboxCustomToolsSession as registerSandboxCustomToolsSessionRaw,
	sandboxCustomTools,
} from "../src/custom-tools.js";
import { handleSandboxBrokerRequest } from "../src/server/modules/sandbox/routes/sandbox/rpc.js";

const BROKER_ENDPOINT = "https://app.example/api/sandbox/rpc";

function registerSandboxCustomToolsSession(
	token: string,
	envelope: unknown,
	ttlMs: number,
) {
	return registerSandboxCustomToolsSessionRaw(
		token,
		BROKER_ENDPOINT,
		envelope,
		ttlMs,
	);
}

function handleSandboxCustomToolsRpc(
	input: Omit<
		Parameters<typeof handleSandboxCustomToolsRpcRaw>[0],
		"requestUrl"
	> & { requestUrl?: string },
) {
	return handleSandboxCustomToolsRpcRaw({
		...input,
		requestUrl: input.requestUrl ?? BROKER_ENDPOINT,
	});
}

function contextBinder(app: any) {
	return {
		bind: async () => app.createContext({ accessMode: "user" }),
	};
}

describe("sandbox custom-tools boundary", () => {
	it("rejects unsafe limit configuration instead of silently clamping it", async () => {
		const base = {
			authorizer: {
				authorize: async () => ({ context: "opaque" }),
			},
			contextBinder: {
				bind: async () => {
					throw new Error("not reached");
				},
			},
		};

		for (const limits of [
			{ maxTools: 0 },
			{ maxCalls: 1.5 },
			{ timeoutMs: Number.POSITIVE_INFINITY },
			{ concurrency: 17 },
			{ maxResultBytes: 768 * 1024 + 1 },
			{ maxArgumentBytes: Number.NaN },
			{ maxArgumentBytes: 64 * 1024 },
		]) {
			expect(() => sandboxCustomTools({ ...base, limits })).toThrow(
				"sandbox custom-tool limits are invalid",
			);
		}

		const session = registerSandboxCustomToolsSession(
			"invalid-runtime-config",
			{},
			5_000,
		);
		try {
			expect(
				await handleSandboxCustomToolsRpc({
					app: {} as never,
					config: { ...base, limits: { maxCalls: 0 } },
					token: "invalid-runtime-config",
					method: "tools.list",
					args: {},
				}),
			).toEqual({
				ok: false,
				error: {
					code: "execution_error",
					message: "sandbox custom tool configuration is invalid",
				},
			});
		} finally {
			session.revoke();
		}

		let evidenceAborted = false;
		const evidenceConfig = sandboxCustomTools({
			...base,
			evidenceTimeoutMs: 5,
			evidence: (_event, { signal }) =>
				new Promise<void>((resolve) => {
					signal.addEventListener(
						"abort",
						() => {
							evidenceAborted = signal.aborted;
							resolve();
						},
						{ once: true },
					);
				}),
		});
		const evidenceSession = registerSandboxCustomToolsSession(
			"bounded-evidence",
			{},
			5_000,
		);
		try {
			expect(
				await handleSandboxCustomToolsRpc({
					app: {} as never,
					config: evidenceConfig,
					token: "bounded-evidence",
					method: "tools.call",
					args: {},
				}),
			).toMatchObject({ ok: false, error: { code: "bad_args" } });
			expect(evidenceAborted).toBe(true);
		} finally {
			evidenceSession.revoke();
		}
	});

	it("lists and calls only released custom tools through the MCP workload port", async () => {
		let allowed = true;
		let toolAccessAllowed = true;
		let calls = 0;
		const authorizations: unknown[] = [];
		const evidence: unknown[] = [];
		const setup = await buildMockApp({
			mcpTools: {
				echo: mcpTool("custom.echo", {
					access: () => toolAccessAllowed,
					scopes: false,
					inputSchema: z.object({ message: z.string() }),
					outputSchema: z.object({ message: z.string() }),
					workload: { capabilities: ["custom.echo"] },
				}).handler(async ({ input }) => {
					calls += 1;
					return {
						content: [{ type: "text", text: input.message }],
						structuredContent: { message: input.message },
					};
				}),
				ambient: mcpTool("custom.ambient", {
					access: true,
					scopes: false,
				}).handler(async () => {
					calls += 1;
					return { content: [{ type: "text", text: "ambient" }] };
				}),
			},
		});
		const config = sandboxCustomTools({
			authorizer: {
				authorize: async (request) => {
					authorizations.push(request);
					return allowed ? { context: { opaque: "authorized" } } : null;
				},
			},
			contextBinder: contextBinder(setup.app),
			evidence: (event) => {
				evidence.push(event);
			},
		});
		const session = registerSandboxCustomToolsSession(
			"opaque-broker-token",
			{ consumer: "opaque" },
			5_000,
		);

		try {
			const listed = await handleSandboxCustomToolsRpc({
				app: setup.app,
				config,
				token: "opaque-broker-token",
				method: "tools.list",
				args: {},
			});
			expect(listed).toMatchObject({
				ok: true,
				value: {
					tools: [
						{
							name: "custom.echo",
							inputSchema: {
								type: "object",
								properties: { message: { type: "string" } },
								required: ["message"],
							},
							outputSchema: {
								type: "object",
								properties: { message: { type: "string" } },
								required: ["message"],
							},
						},
					],
				},
			});
			expect(JSON.stringify(listed)).not.toContain("collections.");
			expect(JSON.stringify(listed)).not.toContain("custom.ambient");

			const crossEndpoint = await handleSandboxCustomToolsRpc({
				app: setup.app,
				config,
				token: "opaque-broker-token",
				requestUrl: "https://app.example/other-app/sandbox/rpc",
				method: "tools.call",
				args: {
					name: "custom.echo",
					arguments: { message: "must-not-cross-apps" },
				},
			});
			expect(crossEndpoint).toMatchObject({
				ok: false,
				error: { code: "unauthorized" },
			});
			expect(authorizations).toHaveLength(1);
			expect(calls).toBe(0);

			const forgedAuthority = await handleSandboxCustomToolsRpc({
				app: setup.app,
				config,
				token: "opaque-broker-token",
				method: "tools.call",
				args: {
					name: "custom.echo",
					arguments: { message: "must-not-run" },
					envelope: { actor: "forged" },
				},
			});
			expect(forgedAuthority).toMatchObject({
				ok: false,
				error: { code: "bad_args" },
			});
			expect(authorizations).toHaveLength(1);
			expect(calls).toBe(0);

			const called = await handleSandboxCustomToolsRpc({
				app: setup.app,
				config,
				token: "opaque-broker-token",
				method: "tools.call",
				args: {
					name: "custom.echo",
					arguments: { message: "hello" },
				},
			});
			expect(called).toMatchObject({
				ok: true,
				value: {
					structuredContent: { message: "hello" },
				},
			});
			expect(calls).toBe(1);
			expect(authorizations).toEqual([
				expect.objectContaining({
					phase: "discovery",
					envelope: { consumer: "opaque" },
				}),
				expect.objectContaining({
					phase: "call",
					envelope: { consumer: "opaque" },
				}),
			]);

			const invalid = await handleSandboxCustomToolsRpc({
				app: setup.app,
				config,
				token: "opaque-broker-token",
				method: "tools.call",
				args: {
					name: "custom.echo",
					arguments: { message: 42 },
				},
			});
			expect(invalid).toMatchObject({
				ok: false,
				error: { code: "bad_args" },
			});
			expect(calls).toBe(1);

			toolAccessAllowed = false;
			const revokedAccess = await handleSandboxCustomToolsRpc({
				app: setup.app,
				config,
				token: "opaque-broker-token",
				method: "tools.call",
				args: {
					name: "custom.echo",
					arguments: { message: "stale-discovery" },
				},
			});
			expect(revokedAccess).toMatchObject({
				ok: false,
				error: { code: "forbidden" },
			});
			expect(calls).toBe(1);

			toolAccessAllowed = true;
			allowed = false;
			const denied = await handleSandboxCustomToolsRpc({
				app: setup.app,
				config,
				token: "opaque-broker-token",
				method: "tools.call",
				args: {
					name: "custom.echo",
					arguments: { message: "must-not-run" },
				},
			});
			expect(denied).toEqual({
				ok: false,
				error: {
					code: "forbidden",
					message: "sandbox custom tool denied",
				},
			});
			expect(calls).toBe(1);
			expect(evidence).toContainEqual(
				expect.objectContaining({
					boundary: "sandbox.tool",
					phase: "call",
					toolName: "custom.echo",
					result: "denied",
				}),
			);
			expect(JSON.stringify(evidence)).not.toContain("must-not-run");
			expect(JSON.stringify(evidence)).not.toContain("authorized");
		} finally {
			session.revoke();
			await setup.cleanup();
		}
	});

	it("fails closed for stale sessions, invalid schemas, limits, time and concurrency", async () => {
		let releases = 0;
		let concurrent = 0;
		let maxConcurrent = 0;
		const setup = await buildMockApp({
			mcpTools: {
				wait: mcpTool("custom.wait", {
					access: true,
					scopes: false,
					inputSchema: z.object({ release: z.boolean().optional() }),
					workload: { capabilities: ["custom.wait"] },
				}).handler(async ({ input }) => {
					concurrent += 1;
					maxConcurrent = Math.max(maxConcurrent, concurrent);
					try {
						if (!input.release) {
							await new Promise<void>((resolve) => {
								const check = setInterval(() => {
									if (releases > 0) {
										releases -= 1;
										clearInterval(check);
										resolve();
									}
								}, 1);
							});
						}
						return { content: [{ type: "text", text: "ok" }] };
					} finally {
						concurrent -= 1;
					}
				}),
			},
		});
		const config = sandboxCustomTools({
			authorizer: {
				authorize: async () => ({ context: "opaque" }),
			},
			contextBinder: contextBinder(setup.app),
			limits: {
				maxArgumentBytes: 64,
				maxCalls: 10,
				timeoutMs: 20,
				concurrency: 1,
			},
		});
		const session = registerSandboxCustomToolsSession("bounded", {}, 5_000);
		const expired = registerSandboxCustomToolsSession("expired", {}, 1);
		const revoked = registerSandboxCustomToolsSession("revoked", {}, 5_000);
		revoked.revoke();

		try {
			await Bun.sleep(2);
			expect(
				await handleSandboxCustomToolsRpc({
					app: setup.app,
					config,
					token: "missing",
					method: "tools.list",
					args: {},
				}),
			).toMatchObject({ ok: false, error: { code: "unauthorized" } });
			expect(
				await handleSandboxCustomToolsRpc({
					app: setup.app,
					config,
					token: "expired",
					method: "tools.list",
					args: {},
				}),
			).toMatchObject({ ok: false, error: { code: "unauthorized" } });
			expect(
				await handleSandboxCustomToolsRpc({
					app: setup.app,
					config,
					token: "revoked",
					method: "tools.list",
					args: {},
				}),
			).toMatchObject({ ok: false, error: { code: "unauthorized" } });

			expect(
				await handleSandboxCustomToolsRpc({
					app: setup.app,
					config,
					token: "bounded",
					method: "tools.call",
					args: {
						name: "custom.wait",
						arguments: { release: "x".repeat(100) },
					},
				}),
			).toMatchObject({ ok: false, error: { code: "bad_args" } });

			const first = handleSandboxCustomToolsRpc({
				app: setup.app,
				config,
				token: "bounded",
				method: "tools.call",
				args: { name: "custom.wait", arguments: {} },
			});
			await Bun.sleep(5);
			expect(
				await handleSandboxCustomToolsRpc({
					app: setup.app,
					config,
					token: "bounded",
					method: "tools.call",
					args: { name: "custom.wait", arguments: { release: true } },
				}),
			).toMatchObject({ ok: false, error: { code: "forbidden" } });
			expect(await first).toMatchObject({
				ok: false,
				error: { code: "execution_error" },
			});
			expect(maxConcurrent).toBe(1);

			expect(
				await handleSandboxCustomToolsRpc({
					app: setup.app,
					config,
					token: "bounded",
					method: "tools.call",
					args: { name: "custom.wait", arguments: { release: true } },
				}),
			).toMatchObject({ ok: false, error: { code: "forbidden" } });

			releases += 1;
			for (let attempt = 0; attempt < 20; attempt += 1) {
				if (concurrent === 0) break;
				await Bun.sleep(2);
			}
			expect(concurrent).toBe(0);
			expect(
				await handleSandboxCustomToolsRpc({
					app: setup.app,
					config,
					token: "bounded",
					method: "tools.call",
					args: { name: "custom.wait", arguments: { release: true } },
				}),
			).toMatchObject({ ok: true });

			const callBoundConfig = sandboxCustomTools({
				authorizer: {
					authorize: async () => ({ context: "opaque" }),
				},
				contextBinder: contextBinder(setup.app),
				limits: { maxCalls: 1 },
			});
			const callBoundSession = registerSandboxCustomToolsSession(
				"call-bound",
				{},
				5_000,
			);
			try {
				expect(
					await handleSandboxCustomToolsRpc({
						app: setup.app,
						config: callBoundConfig,
						token: "call-bound",
						method: "tools.list",
						args: {},
					}),
				).toMatchObject({ ok: true });
				expect(
					await handleSandboxCustomToolsRpc({
						app: setup.app,
						config: callBoundConfig,
						token: "call-bound",
						method: "tools.list",
						args: {},
					}),
				).toMatchObject({ ok: false, error: { code: "forbidden" } });
			} finally {
				callBoundSession.revoke();
			}
		} finally {
			session.revoke();
			expired.revoke();
			await setup.cleanup();
		}
	});

	it("caps abandoned sessions and proactively reclaims expired registrations", async () => {
		const active: Array<{ revoke(): void }> = [];
		try {
			for (let index = 0; index < 1_024; index += 1) {
				active.push(
					registerSandboxCustomToolsSession(`registry-cap-${index}`, {}, 5_000),
				);
			}
			expect(() =>
				registerSandboxCustomToolsSession("registry-overflow", {}, 5_000),
			).toThrow("sandbox custom-tool session could not be registered");
		} finally {
			for (const session of active) session.revoke();
		}

		const cleanupGuards = Array.from({ length: 64 }, (_, index) =>
			registerSandboxCustomToolsSession(`cleanup-live-${index}`, {}, 5_000),
		);
		registerSandboxCustomToolsSession("expired-registration", {}, 1);
		let replacement: { revoke(): void } | undefined;
		try {
			await Bun.sleep(2);
			for (let attempt = 0; attempt < 2 && !replacement; attempt += 1) {
				try {
					replacement = registerSandboxCustomToolsSession(
						"expired-registration",
						{},
						5_000,
					);
				} catch {
					// The first bounded scan may be occupied by live sessions.
				}
			}
			expect(replacement).toBeDefined();
		} finally {
			replacement?.revoke();
			for (const session of cleanupGuards) session.revoke();
		}
	});

	it("bounds discovery catalogs and successful result bodies", async () => {
		const evidence: unknown[] = [];
		const setup = await buildMockApp({
			mcpTools: {
				first: mcpTool("custom.first", {
					access: true,
					scopes: false,
					workload: { capabilities: ["custom.first"] },
				}).handler(async () => ({
					content: [{ type: "text", text: "first" }],
				})),
				large: mcpTool("custom.large", {
					access: true,
					scopes: false,
					workload: { capabilities: ["custom.large"] },
				}).handler(async () => ({
					content: [{ type: "text", text: "x".repeat(256) }],
				})),
			},
		});
		const config = sandboxCustomTools({
			authorizer: {
				authorize: async () => ({ context: "opaque" }),
			},
			contextBinder: contextBinder(setup.app),
			limits: { maxTools: 1, maxResultBytes: 64 },
			evidence: (event) => {
				evidence.push(event);
			},
		});
		const session = registerSandboxCustomToolsSession("size-bounds", {}, 5_000);
		const byteConfig = sandboxCustomTools({
			authorizer: {
				authorize: async () => ({ context: "opaque" }),
			},
			contextBinder: contextBinder(setup.app),
			limits: { maxListBytes: 64 },
		});
		const byteSession = registerSandboxCustomToolsSession(
			"list-byte-bound",
			{},
			5_000,
		);

		try {
			expect(
				await handleSandboxCustomToolsRpc({
					app: setup.app,
					config,
					token: "size-bounds",
					method: "tools.list",
					args: {},
				}),
			).toMatchObject({
				ok: false,
				error: { code: "execution_error" },
			});
			expect(
				await handleSandboxCustomToolsRpc({
					app: setup.app,
					config: byteConfig,
					token: "list-byte-bound",
					method: "tools.list",
					args: {},
				}),
			).toMatchObject({
				ok: false,
				error: { code: "execution_error" },
			});
			expect(
				await handleSandboxCustomToolsRpc({
					app: setup.app,
					config,
					token: "size-bounds",
					method: "tools.call",
					args: { name: "custom.large", arguments: {} },
				}),
			).toMatchObject({
				ok: false,
				error: { code: "execution_error" },
			});
			expect(evidence).toEqual([
				expect.objectContaining({
					phase: "discovery",
					result: "failed",
					reason: "limit_exceeded",
				}),
				expect.objectContaining({
					phase: "call",
					toolName: "custom.large",
					result: "failed",
					reason: "limit_exceeded",
				}),
			]);
		} finally {
			session.revoke();
			byteSession.revoke();
			await setup.cleanup();
		}
	});

	it("accepts exact custom argument/result caps and rejects max+1", async () => {
		let resultText = "";
		const setup = await buildMockApp({
			mcpTools: {
				echo: mcpTool("custom.echo", {
					access: true,
					scopes: false,
					inputSchema: z.object({ payload: z.string() }),
					workload: { capabilities: ["custom.echo"] },
				}).handler(async () => ({
					content: [{ type: "text", text: "ok" }],
				})),
				sized: mcpTool("custom.sized", {
					access: true,
					scopes: false,
					workload: { capabilities: ["custom.sized"] },
				}).handler(async () => ({
					content: [{ type: "text", text: resultText }],
				})),
			},
		});
		const config = sandboxCustomTools({
			authorizer: {
				authorize: async () => ({ context: "opaque" }),
			},
			contextBinder: contextBinder(setup.app),
			limits: {
				maxArgumentBytes: BROKER_CUSTOM_ARGUMENT_CAP_BYTES,
				maxResultBytes: BROKER_CUSTOM_RESULT_CAP_BYTES,
			},
		});
		const session = registerSandboxCustomToolsSession(
			"exact-byte-bounds",
			{},
			5_000,
		);
		const callViaRoute = async (args: {
			name: string;
			arguments: Record<string, unknown>;
		}) => {
			const response = await handleSandboxBrokerRequest(
				new Request(BROKER_ENDPOINT, {
					method: "POST",
					headers: {
						"content-type": "application/json",
						"x-questpie-sandbox-token": "exact-byte-bounds",
					},
					body: JSON.stringify({ method: "tools.call", args }),
				}),
				{
					handleRpc: async () => {
						throw new Error("native broker must not receive tools.call");
					},
				},
				{ app: setup.app, config },
			);
			return {
				status: response.status,
				body: await response.json(),
			};
		};

		try {
			const argumentSyntaxBytes = JSON.stringify({ payload: "" }).length;
			const exactArgument = "x".repeat(
				BROKER_CUSTOM_ARGUMENT_CAP_BYTES - argumentSyntaxBytes,
			);
			expect(
				await callViaRoute({
					name: "custom.echo",
					arguments: { payload: exactArgument },
				}),
			).toMatchObject({ status: 200, body: { ok: true } });
			expect(
				await callViaRoute({
					name: "custom.echo",
					arguments: { payload: `${exactArgument}x` },
				}),
			).toMatchObject({
				status: 400,
				body: { ok: false, error: { code: "bad_args" } },
			});

			const resultSyntaxBytes = JSON.stringify({
				content: [{ type: "text", text: "" }],
			}).length;
			resultText = "x".repeat(
				BROKER_CUSTOM_RESULT_CAP_BYTES - resultSyntaxBytes,
			);
			expect(
				await callViaRoute({ name: "custom.sized", arguments: {} }),
			).toMatchObject({ status: 200, body: { ok: true } });

			resultText += "x";
			expect(
				await callViaRoute({ name: "custom.sized", arguments: {} }),
			).toMatchObject({
				status: 500,
				body: { ok: false, error: { code: "execution_error" } },
			});
		} finally {
			session.revoke();
			await setup.cleanup();
		}
	});
});
