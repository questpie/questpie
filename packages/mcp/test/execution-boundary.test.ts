import { describe, expect, it } from "bun:test";

import { ApiError } from "questpie/errors";

import {
	McpExecutionBoundary,
	McpPublicError,
	McpProductError,
	mcpPublicErrorCode,
	toMcpToolError,
} from "../src/server/execution-boundary.js";
import { executeWorkloadTool } from "../src/server/workload-boundary.js";

const userContext = (sessionId = "session-1") =>
	({
		accessMode: "user",
		db: {},
		principal: {
			kind: "user",
			user: { id: "user-1" },
			session: { id: sessionId },
		},
	}) as never;

const extra = (signal = new AbortController().signal) => ({
	signal,
	requestId: "request-1",
});

const execute = (
	boundary: McpExecutionBoundary,
	options: {
		input?: unknown;
		signal?: AbortSignal;
		sessionId?: string;
		invoke: (signal: AbortSignal) => unknown | Promise<unknown>;
	},
) =>
	boundary.execute({
		operation: "test.operation",
		transport: "http",
		accessMode: "user",
		input: options.input ?? {},
		extra: extra(options.signal),
		authorize: async () => userContext(options.sessionId),
		invoke: ({ signal }) => options.invoke(signal),
	});

describe("MCP shared execution boundary", () => {
	it("preserves known public and product errors through handoff execution", async () => {
		for (const error of [
			new McpPublicError("timeout"),
			new McpProductError(ApiError.conflict("Stale version")),
		]) {
			const boundary = {
				executeHandoff: async ({ invoke }: { invoke: () => unknown }) =>
					invoke(),
			};
			const authorized = {
				tool: { handoff: "approve" },
				authorization: { context: {} },
			};
			const result = await executeWorkloadTool(
				boundary as never,
				authorized as never,
				undefined,
				{
					signal: new AbortController().signal,
					requestId: "test",
					correlationId: "test",
				},
				() => {
					throw error;
				},
			).catch((failure) => failure);
			expect(result).toBe(error);
		}
	});
	it("preserves legacy opaque ApiError classification outside route execution", async () => {
		const error = ApiError.badRequest("private-custom-error");
		const resolved = await execute(new McpExecutionBoundary(), {
			invoke: () => {
				throw error;
			},
		}).catch((failure) => failure);
		expect(mcpPublicErrorCode(resolved)).toBe("internal");
		expect(toMcpToolError(error)._meta?.["questpie/error"]).toMatchObject({
			code: "internal",
		});
		expect(JSON.stringify(toMcpToolError(error))).not.toContain(
			"private-custom-error",
		);
	});
	it("rejects oversized, over-deep, cyclic, and accessor input before invocation", async () => {
		const boundary = new McpExecutionBoundary({
			maxInputBytes: 64,
			maxInputDepth: 3,
			maxValueNodes: 20,
		});
		let calls = 0;
		const invoke = () => {
			calls += 1;
			return { ok: true };
		};
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		let getterCalls = 0;
		const accessor = Object.defineProperty({}, "secret", {
			enumerable: true,
			get() {
				getterCalls += 1;
				return "must-not-run";
			},
		});
		const customSerialization = Object.defineProperty({}, "toJSON", {
			get() {
				getterCalls += 1;
				return () => ({ secret: "must-not-run" });
			},
		});
		const sparse: unknown[] = [];
		sparse.length = 100;

		for (const input of [
			{ text: "x".repeat(100) },
			{ text: "\u0000".repeat(20) },
			{ a: { b: { c: { d: true } } } },
			cyclic,
			accessor,
			customSerialization,
			sparse,
			new Map(),
		]) {
			expect(
				mcpPublicErrorCode(
					await execute(boundary, { input, invoke }).catch((error) => error),
				),
			).toBe("input_too_large");
		}
		expect(calls).toBe(0);
		expect(getterCalls).toBe(0);
	});

	it("bounds output and redacts raw failures into single-flight diagnostics", async () => {
		const diagnostics: unknown[] = [];
		const boundary = new McpExecutionBoundary({
			maxOutputBytes: 64,
			onDiagnostic: async (event) => {
				diagnostics.push(event);
			},
		});

		expect(
			mcpPublicErrorCode(
				await execute(boundary, {
					invoke: () => ({ text: "x".repeat(100) }),
				}).catch((error) => error),
			),
		).toBe("output_too_large");
		expect(
			mcpPublicErrorCode(
				await execute(boundary, {
					invoke: () => {
						throw new Error(
							"postgres://admin:password@db.local Bearer top-secret",
						);
					},
				}).catch((error) => error),
			),
		).toBe("internal");

		await Bun.sleep(0);
		const serialized = JSON.stringify(diagnostics);
		expect(serialized).not.toContain("password");
		expect(serialized).not.toContain("top-secret");
		expect(serialized).not.toContain("admin:");
	});

	it("snapshots hostile dates without invoking custom serialization and charges exact JSON bytes", async () => {
		let getterCalls = 0;
		const date = new Date("2026-07-25T12:34:56.789Z");
		Object.defineProperty(date, "toJSON", {
			get() {
				getterCalls += 1;
				return () => "x".repeat(4 * 1024 * 1024 + 1);
			},
		});
		const serializedDate = JSON.stringify(date.toISOString());
		const exact = new McpExecutionBoundary({
			maxOutputBytes: new TextEncoder().encode(serializedDate).byteLength,
		});

		await expect(
			execute(exact, {
				invoke: () => date,
			}),
		).resolves.toBe(date.toISOString());
		expect(getterCalls).toBe(0);

		const oneByteTooSmall = new McpExecutionBoundary({
			maxOutputBytes: new TextEncoder().encode(serializedDate).byteLength - 1,
		});
		expect(
			mcpPublicErrorCode(
				await execute(oneByteTooSmall, {
					invoke: () => date,
				}).catch((error) => error),
			),
		).toBe("output_too_large");
		expect(getterCalls).toBe(0);
	});

	it("propagates cancellation, enforces deadlines, and keeps ignored work admitted", async () => {
		const cancelled = new AbortController();
		cancelled.abort();
		const boundary = new McpExecutionBoundary({
			timeoutMs: 10,
			maxConcurrency: 1,
			maxConcurrencyPerPrincipal: 1,
		});
		let calls = 0;
		expect(
			mcpPublicErrorCode(
				await execute(boundary, {
					signal: cancelled.signal,
					invoke: () => {
						calls += 1;
					},
				}).catch((error) => error),
			),
		).toBe("cancelled");
		expect(calls).toBe(0);

		let release!: () => void;
		const ignoredAbort = new Promise<void>((resolve) => {
			release = resolve;
		});
		const timedOut = execute(boundary, {
			invoke: () => ignoredAbort,
		});
		expect(mcpPublicErrorCode(await timedOut.catch((error) => error))).toBe(
			"timeout",
		);
		expect(
			mcpPublicErrorCode(
				await execute(boundary, {
					invoke: () => ({ shouldNotRun: true }),
				}).catch((error) => error),
			),
		).toBe("busy");
		release();
		await Bun.sleep(0);
		expect(await execute(boundary, { invoke: () => ({ ok: true }) })).toEqual({
			ok: true,
		});
	});

	it("enforces per-principal concurrency and removes idle principal keys", async () => {
		const boundary = new McpExecutionBoundary({
			timeoutMs: 1000,
			maxConcurrency: 2,
			maxConcurrencyPerPrincipal: 1,
		});
		let release!: () => void;
		const first = execute(boundary, {
			sessionId: "same",
			invoke: () =>
				new Promise<void>((resolve) => {
					release = resolve;
				}),
		});
		await Bun.sleep(0);
		expect(
			mcpPublicErrorCode(
				await execute(boundary, {
					sessionId: "same",
					invoke: () => ({ shouldNotRun: true }),
				}).catch((error) => error),
			),
		).toBe("busy");
		expect(
			await execute(boundary, {
				sessionId: "different",
				invoke: () => ({ ok: true }),
			}),
		).toEqual({ ok: true });
		release();
		await first;
		expect(
			await execute(boundary, {
				sessionId: "same",
				invoke: () => ({ reused: true }),
			}),
		).toEqual({ reused: true });
	});
});
