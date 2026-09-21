import { expect, test } from "bun:test";

import { principal } from "questpie";

import { RuntimeActionPostHandlerResourceLimit } from "../../packages/runtime/src/action";
import { createMcpOperationAdapter } from "../../packages/runtime/src/application/mcp-operation";
import {
	RuntimeCredentialMalformed,
	RuntimeCredentialUnavailable,
} from "../../packages/runtime/src/execution";
import {
	CommittedResultUnavailable,
	DeclaredOperationError,
	OperationFailure,
} from "../../packages/runtime/src/operation";
import {
	http02ActionIdentity,
	http02Context,
	http02ContextCodec,
	http02InputCodec,
	http02MutationIdentity,
	http02OutputCodec,
} from "../support/http02-contract";

const declaredErrors = [
	{
		code: "CONFLICT",
		status: 409,
		payload: {
			kind: "object",
			properties: { reason: { kind: "text", maxLength: 32 } },
		},
	},
] as const;

const operations = [
	{
		identity: http02MutationIdentity,
		input: http02InputCodec,
		output: http02OutputCodec,
		declaredErrors,
	},
	{
		identity: http02ActionIdentity,
		input: http02InputCodec,
		output: http02OutputCodec,
		declaredErrors,
	},
] as const;

const user = principal.user({ id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4" });
const request = new Request("https://support.example/_questpie/mcp");

function adapter(
	overrides: Partial<Parameters<typeof createMcpOperationAdapter>[0]> = {},
) {
	return createMcpOperationAdapter({
		contextCodec: http02ContextCodec as never,
		operations: operations as never,
		maximumResponseBytes: 4096,
		prepare: (identity, value) =>
			({
				binding: { identity, kind: "mutation" },
				declaredErrors,
				input: value,
				inputCodec: http02InputCodec,
				output: http02OutputCodec,
			}) as never,
		resolvePrincipal: async () => user,
		execute: async () => ({ ok: true }),
		...overrides,
	} as never);
}

function invoke(
	execute: ReturnType<typeof adapter>,
	kind: "mutation" | "action",
	args: Readonly<Record<string, unknown>>,
	principalOverride?: typeof user,
) {
	return execute({
		arguments: args,
		identity:
			kind === "mutation" ? http02MutationIdentity : http02ActionIdentity,
		kind,
		request,
		signal: new AbortController().signal,
		...(principalOverride === undefined
			? {}
			: { principal: principalOverride }),
	});
}

test("MCP adapter decodes through the canonical codecs and executes one Operation", async () => {
	const calls: unknown[] = [];
	const result = await invoke(
		adapter({
			execute: async (value) => {
				calls.push(value);
				return { ok: true };
			},
		}),
		"mutation",
		{ callId: "mutation-call", context: http02Context, input: { value: "ok" } },
	);

	expect(result).toEqual({
		structuredContent: { callId: "mutation-call", result: { ok: true } },
		isError: false,
	});
	expect(calls).toHaveLength(1);
	expect(calls[0]).toMatchObject({
		kind: "mutation",
		identity: http02MutationIdentity,
		operationInput: { value: "ok" },
		context: http02Context,
		principal: user,
		callId: "mutation-call",
	});
});

test("MCP adapter preserves typed credential outcomes without disclosure", async () => {
	for (const [error, code, retryable] of [
		[new RuntimeCredentialMalformed(), "UNAUTHENTICATED", false],
		[new RuntimeCredentialUnavailable(), "RUNTIME_UNAVAILABLE", true],
		[new OperationFailure("UNAUTHENTICATED"), "UNAUTHENTICATED", false],
		[new Error("credential secret"), "INTERNAL", false],
	] as const) {
		let executions = 0;
		const result = await invoke(
			adapter({
				resolvePrincipal: async () => {
					throw error;
				},
				execute: async () => {
					executions += 1;
					return { ok: true };
				},
			}),
			"mutation",
			{
				callId: "credential-call",
				context: http02Context,
				input: { value: "ok" },
			},
		);
		expect(result).toEqual({
			structuredContent: {
				callId: "credential-call",
				error: { code, retryable },
			},
			isError: true,
		});
		expect(JSON.stringify(result)).not.toContain("credential secret");
		expect(executions).toBe(0);
	}
});

test("MCP adapter correlates malformed arguments without echoing invalid identities", async () => {
	const result = await invoke(adapter(), "mutation", {
		callId: 42,
		context: http02Context,
		input: { value: "ok" },
	});
	expect(result).toMatchObject({
		structuredContent: {
			callId: expect.any(String),
			error: { code: "PROTOCOL_UNSUPPORTED", retryable: false },
		},
		isError: true,
	});
	expect(result.structuredContent).not.toMatchObject({ callId: 42 });
});

test("MCP adapter maps invalid Context and Action input as protocol outcomes", async () => {
	for (const [context, input] of [
		[{}, { value: "ok" }],
		[http02Context, { value: 7 }],
	] as const) {
		const result = await invoke(adapter(), "action", {
			callId: "action-call",
			context,
			effectKey: "effect-key",
			input,
		});
		expect(result).toEqual({
			structuredContent: {
				callId: "action-call",
				error: { code: "PROTOCOL_UNSUPPORTED", retryable: false },
			},
			isError: true,
		});
	}
});

test("MCP adapter preserves declared, committed, and Action ambiguity outcomes", async () => {
	for (const [thrown, expected] of [
		[
			new DeclaredOperationError("CONFLICT", 409, { reason: "occupied" }),
			{ error: { code: "CONFLICT", payload: { reason: "occupied" } } },
		],
		[
			new CommittedResultUnavailable("mutation-call", "901"),
			{
				error: {
					code: "COMMITTED_RESULT_UNAVAILABLE",
					retryable: true,
					transactionId: "901",
				},
			},
		],
	] as const) {
		const result = await invoke(
			adapter({
				execute: async () => {
					throw thrown;
				},
			}),
			"mutation",
			{
				callId: "mutation-call",
				context: http02Context,
				input: { value: "ok" },
			},
		);
		expect(result).toEqual({
			structuredContent: { callId: "mutation-call", ...expected },
			isError: true,
		});
	}

	const controller = new AbortController();
	const ambiguous = await invoke(
		adapter({
			execute: async ({ onHandlerDispatch }) => {
				onHandlerDispatch();
				controller.abort(new DOMException("private", "AbortError"));
				throw controller.signal.reason;
			},
		}),
		"action",
		{
			callId: "action-call",
			context: http02Context,
			effectKey: "effect-key",
			input: { value: "ok" },
		},
	);
	expect(ambiguous).toEqual({
		structuredContent: {
			callId: "action-call",
			error: { code: "ACTION_OUTCOME_AMBIGUOUS", retryable: false },
		},
		isError: true,
	});
});

test("MCP adapter keeps pre- and post-handler resource limits disjoint", async () => {
	for (const [error, retryable] of [
		[new OperationFailure("RESOURCE_LIMIT"), true],
		[new RuntimeActionPostHandlerResourceLimit(), false],
	] as const) {
		const result = await invoke(
			adapter({
				execute: async () => {
					throw error;
				},
			}),
			"action",
			{
				callId: "action-call",
				context: http02Context,
				effectKey: "effect-key",
				input: { value: "ok" },
			},
		);
		expect(result).toEqual({
			structuredContent: {
				callId: "action-call",
				error: { code: "RESOURCE_LIMIT", retryable },
			},
			isError: true,
		});
	}
});

test("F5: a pre-resolved principal from the ingress preflight is used directly, never re-resolved", async () => {
	const preResolved = principal.user({
		id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61aF",
	});
	let resolveCalls = 0;
	const calls: unknown[] = [];
	const result = await invoke(
		adapter({
			resolvePrincipal: async () => {
				resolveCalls += 1;
				return user;
			},
			execute: async (value) => {
				calls.push(value.principal);
				return { ok: true };
			},
		}),
		"mutation",
		{ callId: "mutation-call", context: http02Context, input: { value: "ok" } },
		preResolved,
	);
	expect(result).toEqual({
		structuredContent: { callId: "mutation-call", result: { ok: true } },
		isError: false,
	});
	expect(resolveCalls).toBe(0);
	expect(calls).toEqual([preResolved]);
});

test("F5: without a pre-resolved principal, resolvePrincipal still runs exactly as before (backward compatible)", async () => {
	let resolveCalls = 0;
	await invoke(
		adapter({
			resolvePrincipal: async () => {
				resolveCalls += 1;
				return user;
			},
		}),
		"mutation",
		{
			callId: "mutation-call-2",
			context: http02Context,
			input: { value: "ok" },
		},
	);
	expect(resolveCalls).toBe(1);
});
