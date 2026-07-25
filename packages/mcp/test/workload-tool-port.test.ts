import { describe, expect, it } from "bun:test";

import { collection } from "questpie";
import { z } from "zod";

import { buildMockApp } from "../../questpie/test/utils/mocks/mock-app-builder.js";
import {
	createWorkloadMcpToolPort,
	mcpPublicErrorCode,
	mcpTool,
} from "../src/exports/index.js";

function errorCode(result: { _meta?: Record<string, unknown> }) {
	return (
		result["_meta"]?.["questpie/error"] as
			| { code?: string; correlationId?: string }
			| undefined
	)?.code;
}

describe("programmatic workload custom-tool port", () => {
	it("excludes generated surfaces and reauthorizes list and every call", async () => {
		let allowed = true;
		const phases: string[] = [];
		const controls: unknown[] = [];
		const bindingControls: unknown[] = [];
		const posts = collection("posts").fields(({ f }) => ({
			title: f.text(),
		}));
		const setup = await buildMockApp({
			collections: { posts },
			mcpTools: {
				read: mcpTool("tasks.read", {
					access: true,
					scopes: false,
					inputSchema: z.object({ id: z.string() }).strict(),
					workload: { capabilities: ["tasks.read"] },
				}).handler(async ({ input, signal, requestId, correlationId }) => ({
					content: [{ type: "text", text: input.id }],
					structuredContent: {
						id: input.id,
						aborted: signal.aborted,
						requestId,
						hasCorrelation: correlationId.length > 0,
					},
				})),
			},
		});
		const port = createWorkloadMcpToolPort(setup.app, {
			envelope: { issuer: "test" },
			authorizer: {
				authorize: async ({ phase }, control) => {
					phases.push(phase);
					controls.push(control);
					return allowed ? { context: "opaque" } : null;
				},
			},
			contextBinder: {
				bind: async (_input, control) => {
					bindingControls.push(control);
					return setup.app.createContext({ accessMode: "user" });
				},
			},
			config: {
				crud: {
					collections: {
						posts: {
							operations: { list: true },
							workload: { capabilities: ["posts.read"] },
						},
					},
				},
			},
		});

		try {
			expect(
				(await port.listCustomTools()).tools.map(({ name }) => name),
			).toEqual(["tasks.read"]);
			const result = await port.callCustomTool({
				name: "tasks.read",
				input: { id: "task-1" },
				requestId: "caller-request",
			});
			expect(result.structuredContent).toEqual({
				id: "task-1",
				aborted: false,
				requestId: "caller-request",
				hasCorrelation: true,
			});

			allowed = false;
			expect((await port.listCustomTools()).tools).toEqual([]);
			expect(
				errorCode(
					await port.callCustomTool({
						name: "tasks.read",
						input: { id: "task-2" },
					}),
				),
			).toBe("access_denied");
			expect(phases).toEqual(["discovery", "call", "discovery", "call"]);
			expect(controls).toHaveLength(4);
			expect(controls[1]).toEqual(
				expect.objectContaining({
					signal: expect.any(AbortSignal),
					requestId: "caller-request",
					correlationId: expect.any(String),
				}),
			);
			expect(bindingControls).toHaveLength(2);
		} finally {
			await setup.cleanup();
		}
	});

	it("returns stable invalid-input, output-budget, and redacted internal errors", async () => {
		const diagnostics: unknown[] = [];
		const setup = await buildMockApp({
			mcpTools: {
				bounded: mcpTool("tasks.bounded", {
					access: true,
					scopes: false,
					inputSchema: z.object({ value: z.string() }).strict(),
					workload: { capabilities: ["tasks.read"] },
				}).handler(async ({ input }) => ({
					content: [{ type: "text", text: input.value.repeat(100) }],
				})),
				fails: mcpTool("tasks.fails", {
					access: true,
					scopes: false,
					workload: { capabilities: ["tasks.read"] },
				}).handler(async () => {
					throw new Error(
						"postgres://admin:password@db.local Bearer top-secret",
					);
				}),
				invalidOutput: mcpTool("tasks.invalid-output", {
					access: true,
					scopes: false,
					outputSchema: z.object({ ok: z.boolean() }),
					workload: { capabilities: ["tasks.read"] },
				}).handler(async () => ({
					content: [{ type: "text", text: "invalid" }],
					structuredContent: { secretShape: true },
				})),
			},
		});
		const port = createWorkloadMcpToolPort(setup.app, {
			envelope: "opaque",
			authorizer: {
				authorize: async () => ({ context: "opaque" }),
			},
			contextBinder: {
				bind: async () => setup.app.createContext({ accessMode: "user" }),
			},
			config: {
				execution: {
					maxOutputBytes: 128,
					onDiagnostic: (event) => {
						diagnostics.push(event);
					},
				},
			},
		});

		try {
			expect(
				errorCode(
					await port.callCustomTool({
						name: "tasks.bounded",
						input: {},
					}),
				),
			).toBe("invalid_input");
			expect(
				errorCode(
					await port.callCustomTool({
						name: "tasks.bounded",
						input: { value: "large" },
					}),
				),
			).toBe("output_too_large");
			const failed = await port.callCustomTool({
				name: "tasks.fails",
				input: {},
			});
			expect(errorCode(failed)).toBe("internal");
			expect(
				errorCode(
					await port.callCustomTool({
						name: "tasks.invalid-output",
						input: {},
					}),
				),
			).toBe("internal");
			expect(JSON.stringify(failed)).not.toContain("password");
			expect(JSON.stringify(failed)).not.toContain("top-secret");
			await Bun.sleep(0);
			expect(JSON.stringify(diagnostics)).not.toContain("password");
			expect(JSON.stringify(diagnostics)).not.toContain("top-secret");
		} finally {
			await setup.cleanup();
		}
	});

	it("shares concurrency by stable consumer key without cross-tenant interference", async () => {
		let release!: () => void;
		let markStarted!: () => void;
		const started = new Promise<void>((resolve) => {
			markStarted = resolve;
		});
		const setup = await buildMockApp({
			mcpTools: {
				wait: mcpTool("tasks.shared-wait", {
					access: true,
					scopes: false,
					inputSchema: z.object({ block: z.boolean() }),
					workload: { capabilities: ["tasks.read"] },
				}).handler(({ input }) =>
					input.block
						? new Promise((resolve) => {
								markStarted();
								release = () =>
									resolve({ content: [{ type: "text", text: "done" }] });
							})
						: Promise.resolve({
								content: [{ type: "text", text: "immediate" }],
							}),
				),
			},
		});
		const options = {
			envelope: "opaque",
			concurrencyKey: "tenant-a",
			authorizer: {
				authorize: async () => ({ context: "opaque" }),
			},
			contextBinder: {
				bind: async () => setup.app.createContext({ accessMode: "user" }),
			},
			config: {
				execution: {
					maxConcurrency: 2,
					maxConcurrencyPerPrincipal: 1,
				},
			},
		} as const;
		const firstPort = createWorkloadMcpToolPort(setup.app, options);
		const secondPort = createWorkloadMcpToolPort(setup.app, options);
		const first = firstPort.callCustomTool({
			name: "tasks.shared-wait",
			input: { block: true },
		});
		await started;

		try {
			expect(
				errorCode(
					await secondPort.callCustomTool({
						name: "tasks.shared-wait",
						input: { block: false },
					}),
				),
			).toBe("busy");
			const otherTenantPort = createWorkloadMcpToolPort(setup.app, {
				...options,
				concurrencyKey: "tenant-b",
			});
			expect(
				(
					await otherTenantPort.callCustomTool({
						name: "tasks.shared-wait",
						input: { block: false },
					})
				).isError,
			).toBeUndefined();
			release();
			expect((await first).isError).toBeUndefined();
		} finally {
			release?.();
			await setup.cleanup();
		}
	});

	it("applies one total deadline to sequential custom-tool discovery", async () => {
		const makeTool = (name: string) =>
			mcpTool(name, {
				access: true,
				scopes: false,
				workload: { capabilities: ["tasks.read"] },
			}).handler(async () => ({ content: [] }));
		const setup = await buildMockApp({
			mcpTools: {
				first: makeTool("tasks.first"),
				second: makeTool("tasks.second"),
			},
		});
		const port = createWorkloadMcpToolPort(setup.app, {
			envelope: "opaque",
			authorizer: {
				authorize: async () => {
					await Bun.sleep(8);
					return { context: "opaque" };
				},
			},
			contextBinder: {
				bind: async () => setup.app.createContext({ accessMode: "user" }),
			},
			config: { execution: { timeoutMs: 10 } },
		});
		try {
			expect(
				mcpPublicErrorCode(
					await port.listCustomTools().catch((error) => error),
				),
			).toBe("timeout");
		} finally {
			await setup.cleanup();
		}
	});

	it("propagates caller cancellation through the public port", async () => {
		let observedAbort = false;
		let markStarted!: () => void;
		const started = new Promise<void>((resolve) => {
			markStarted = resolve;
		});
		const setup = await buildMockApp({
			mcpTools: {
				wait: mcpTool("tasks.wait", {
					access: true,
					scopes: false,
					workload: { capabilities: ["tasks.read"] },
				}).handler(
					({ signal }) =>
						new Promise((resolve) => {
							markStarted();
							signal.addEventListener(
								"abort",
								() => {
									observedAbort = true;
									resolve({ content: [{ type: "text", text: "aborted" }] });
								},
								{ once: true },
							);
						}),
				),
			},
		});
		const port = createWorkloadMcpToolPort(setup.app, {
			envelope: "opaque",
			authorizer: {
				authorize: async () => ({ context: "opaque" }),
			},
			contextBinder: {
				bind: async () => setup.app.createContext({ accessMode: "user" }),
			},
		});
		const controller = new AbortController();
		const result = port.callCustomTool({
			name: "tasks.wait",
			input: {},
			signal: controller.signal,
		});
		await started;
		controller.abort();

		try {
			expect(errorCode(await result)).toBe("cancelled");
			expect(observedAbort).toBe(true);
			expect(
				mcpPublicErrorCode(
					await port
						.listCustomTools({ signal: controller.signal })
						.catch((error) => error),
				),
			).toBe("cancelled");
		} finally {
			await setup.cleanup();
		}
	});

	it("does not bind context or emit an allowed audit after authorization is cancelled", async () => {
		let releaseAuthorization!: (value: unknown) => void;
		let markStarted!: () => void;
		let binderCalls = 0;
		const audits: unknown[] = [];
		const started = new Promise<void>((resolve) => {
			markStarted = resolve;
		});
		const setup = await buildMockApp({
			mcpTools: {
				read: mcpTool("tasks.read", {
					access: true,
					scopes: false,
					workload: { capabilities: ["tasks.read"] },
				}).handler(async () => ({
					content: [{ type: "text", text: "must-not-run" }],
				})),
			},
		});
		const port = createWorkloadMcpToolPort(setup.app, {
			envelope: "opaque",
			authorizer: {
				authorize: async () => {
					markStarted();
					return new Promise((resolve) => {
						releaseAuthorization = resolve;
					});
				},
			},
			contextBinder: {
				bind: async () => {
					binderCalls += 1;
					return setup.app.createContext({ accessMode: "user" });
				},
			},
			audit: (event) => {
				audits.push(event);
			},
		});
		const controller = new AbortController();
		const pending = port.listCustomTools({ signal: controller.signal });
		await started;
		controller.abort();
		expect(mcpPublicErrorCode(await pending.catch((error) => error))).toBe(
			"cancelled",
		);

		releaseAuthorization({ context: "opaque" });
		await Bun.sleep(5);
		try {
			expect(binderCalls).toBe(0);
			expect(audits).not.toContainEqual(
				expect.objectContaining({ decision: "allowed" }),
			);
		} finally {
			await setup.cleanup();
		}
	});

	it("does not run tool access after an allowed audit is cancelled", async () => {
		let releaseAudit!: () => void;
		let markAuditStarted!: () => void;
		let accessCalls = 0;
		const auditStarted = new Promise<void>((resolve) => {
			markAuditStarted = resolve;
		});
		const setup = await buildMockApp({
			mcpTools: {
				read: mcpTool("tasks.read", {
					access: async () => {
						accessCalls += 1;
						return true;
					},
					scopes: false,
					workload: { capabilities: ["tasks.read"] },
				}).handler(async () => ({
					content: [{ type: "text", text: "must-not-run" }],
				})),
			},
		});
		const port = createWorkloadMcpToolPort(setup.app, {
			envelope: "opaque",
			authorizer: {
				authorize: async () => ({ context: "opaque" }),
			},
			contextBinder: {
				bind: async () => setup.app.createContext({ accessMode: "user" }),
			},
			audit: async (event) => {
				if (event.decision !== "allowed") return;
				markAuditStarted();
				await new Promise<void>((resolve) => {
					releaseAudit = resolve;
				});
			},
		});
		const controller = new AbortController();
		const pending = port.listCustomTools({ signal: controller.signal });
		await auditStarted;
		controller.abort();
		expect(mcpPublicErrorCode(await pending.catch((error) => error))).toBe(
			"cancelled",
		);

		releaseAudit();
		await Bun.sleep(5);
		try {
			expect(accessCalls).toBe(0);
		} finally {
			await setup.cleanup();
		}
	});
});
