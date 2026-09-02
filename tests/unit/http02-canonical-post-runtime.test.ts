import { expect, test } from "bun:test";

import { principal } from "questpie";

import { RuntimeActionPostHandlerResourceLimit } from "../../packages/runtime/src/action";
import { createCanonicalPostHttp } from "../../packages/runtime/src/application/http-post";
import { RuntimeCredentialUnavailable } from "../../packages/runtime/src/execution";
import {
	CommittedResultUnavailable,
	DeclaredOperationError,
	OperationFailure,
} from "../../packages/runtime/src/operation";
import {
	http02ActionIdentity,
	http02Context as context,
	http02ContextCodec,
	http02InputCodec,
	http02MutationIdentity,
	http02OutputCodec,
} from "../support/http02-contract";

const operations = [
	{
		identity: http02MutationIdentity,
		input: http02InputCodec,
		output: http02OutputCodec,
		declaredErrors: [],
	},
	{
		identity: http02ActionIdentity,
		input: http02InputCodec,
		output: http02OutputCodec,
		declaredErrors: [],
	},
] as const;
const user = principal.user({
	id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4",
});

function post(
	path: string,
	headers: Readonly<Record<string, string>>,
	body = JSON.stringify({ context, input: { value: "accepted" } }),
): Request {
	return new Request(`https://runtime.test${path}`, {
		method: "POST",
		headers: { "content-type": "application/json; charset=UTF-8", ...headers },
		body,
	});
}

function canonicalPostTransport(
	overrides: Partial<Parameters<typeof createCanonicalPostHttp>[0]> = {},
) {
	return createCanonicalPostHttp({
		application: "application:test",
		clientContractDigest: "1".repeat(64),
		httpContractDigest: "2".repeat(64),
		maximumRequestBytes: 4096,
		maximumResponseBytes: 4096,
		contextCodec: http02ContextCodec as never,
		operations: operations as never,
		prepare: (identity, value) =>
			({
				declaredErrors: [],
				input: value,
				inputCodec: http02InputCodec,
				output: http02OutputCodec,
				binding: { identity, kind: "mutation" },
			}) as never,
		resolvePrincipal: async () => user,
		executeMutation: async () => ({ ok: true }),
		executeAction: async () => ({ ok: true }),
		now: () => Date.now(),
		...overrides,
	} as never);
}

test("canonical POST maps typed credential outcomes without disclosure", async () => {
	for (const [error, status, code, retryable] of [
		[new OperationFailure("UNAUTHENTICATED"), 401, "UNAUTHENTICATED", false],
		[new RuntimeCredentialUnavailable(), 503, "RUNTIME_UNAVAILABLE", true],
		[new Error("credential secret"), 500, "INTERNAL", false],
	] as const) {
		const response = await canonicalPostTransport({
			resolvePrincipal: async () => {
				throw error;
			},
		}).fetch(
			post("/_questpie/mutation/messages.publish", {
				"Idempotency-Key": "credential-call",
			}),
		);
		expect(response?.status).toBe(status);
		expect(await response?.json()).toEqual({
			callId: "credential-call",
			error: { code, retryable },
		});
	}
});

test("canonical POST deadline spans awaited phases and releases its signal owners", async () => {
	const delayed = () => new Promise<void>((resolve) => setTimeout(resolve, 15));
	for (const phase of ["credentials", "body", "executor"] as const) {
		let credentialObservedAbort = false;
		const request =
			phase === "body"
				? new Request(
						"https://runtime.test/_questpie/mutation/messages.publish",
						{
							method: "POST",
							headers: {
								"content-type": "application/json",
								"Idempotency-Key": `deadline-${phase}`,
								"Questpie-Timeout-Milliseconds": "5",
							},
							body: new ReadableStream<Uint8Array>({
								async start(controller) {
									await delayed();
									controller.enqueue(
										new TextEncoder().encode(
											JSON.stringify({
												context,
												input: { value: "accepted" },
											}),
										),
									);
									controller.close();
								},
							}),
						},
					)
				: post("/_questpie/mutation/messages.publish", {
						"Idempotency-Key": `deadline-${phase}`,
						"Questpie-Timeout-Milliseconds": "5",
					});
		const response = await canonicalPostTransport({
			resolvePrincipal: async (_request, signal?: AbortSignal) => {
				if (phase === "credentials") {
					await Promise.race([
						new Promise<void>((resolve) =>
							signal?.addEventListener("abort", () => resolve(), {
								once: true,
							}),
						),
						delayed(),
					]);
					credentialObservedAbort = signal?.aborted ?? false;
				}
				return user;
			},
			executeMutation: async () => {
				if (phase === "executor") await delayed();
				return { ok: true };
			},
		}).fetch(request);
		expect(response?.status).toBe(408);
		expect(await response?.json()).toMatchObject({
			callId: `deadline-${phase}`,
			error: { code: "DEADLINE_EXCEEDED", retryable: true },
		});
		if (phase === "credentials") expect(credentialObservedAbort).toBe(true);
	}

	const requestController = new AbortController();
	let executionSignal: AbortSignal | undefined;
	const completed = await canonicalPostTransport({
		executeMutation: async ({ signal }) => {
			executionSignal = signal;
			return { ok: true };
		},
	}).fetch(
		new Request(
			post("/_questpie/mutation/messages.publish", {
				"Idempotency-Key": "cleanup",
				"Questpie-Timeout-Milliseconds": "10",
			}),
			{ signal: requestController.signal },
		),
	);
	expect(completed?.status).toBe(200);
	requestController.abort();
	await delayed();
	expect(executionSignal?.aborted).toBe(false);
});

test("canonical POST deadline settles an abort-ignoring credential resolver", async () => {
	let executorCalls = 0;
	const response = await Promise.race([
		canonicalPostTransport({
			resolvePrincipal: async () => new Promise<never>(() => {}),
			executeMutation: async () => {
				executorCalls += 1;
				return { ok: true };
			},
		}).fetch(
			post("/_questpie/mutation/messages.publish", {
				"Idempotency-Key": "noncooperative-credential",
				"Questpie-Timeout-Milliseconds": "5",
			}),
		),
		new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 100)),
	]);
	expect(response).not.toBe("hung");
	if (response === "hung") return;
	expect(response?.status).toBe(408);
	expect(await response?.json()).toEqual({
		callId: "noncooperative-credential",
		error: { code: "DEADLINE_EXCEEDED", retryable: true },
	});
	expect(executorCalls).toBe(0);
});

test("canonical POST aborts a hung body without leaking cancel failure", async () => {
	const privateFailure = new Error("private body cancel failure");
	const unhandled: unknown[] = [];
	const observeUnhandled = (error: unknown) => unhandled.push(error);
	process.on("unhandledRejection", observeUnhandled);
	try {
		let cancelCalls = 0;
		let executorCalls = 0;
		const body = new ReadableStream<Uint8Array>({
			pull: () => new Promise<void>(() => {}),
			cancel: () => {
				cancelCalls += 1;
				return Promise.reject(privateFailure);
			},
		});
		const response = await Promise.race([
			canonicalPostTransport({
				executeMutation: async () => {
					executorCalls += 1;
					return { ok: true };
				},
			}).fetch(
				new Request(
					"https://runtime.test/_questpie/mutation/messages.publish",
					{
						method: "POST",
						headers: {
							"content-type": "application/json",
							"Idempotency-Key": "hung-body",
							"Questpie-Timeout-Milliseconds": "5",
						},
						body,
					},
				),
			),
			new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 100)),
		]);
		expect(response).not.toBe("hung");
		if (response === "hung") return;
		expect(response?.status).toBe(408);
		expect(await response?.json()).toEqual({
			callId: "hung-body",
			error: { code: "DEADLINE_EXCEEDED", retryable: true },
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(cancelCalls).toBe(1);
		expect(executorCalls).toBe(0);
		expect(unhandled).toEqual([]);
	} finally {
		process.off("unhandledRejection", observeUnhandled);
	}
});

test("canonical POST preserves executor-owned Mutation receipt replay", async () => {
	const receipts = new Map<
		string,
		{ bytes: string; result: { ok: boolean } }
	>();
	let writes = 0;
	const declaredErrors = [
		{
			code: "IDEMPOTENCY_CONFLICT",
			status: 409,
			payload: {
				kind: "object",
				properties: { callId: { kind: "text", maxLength: 256 } },
			},
		},
	] as const;
	const transport = canonicalPostTransport({
		operations: [{ ...operations[0], declaredErrors }, operations[1]] as never,
		prepare: (identity, value) =>
			({
				declaredErrors,
				input: value,
				inputCodec: http02InputCodec,
				output: http02OutputCodec,
				binding: { identity, kind: "mutation" },
			}) as never,
		executeMutation: async ({ callId, operation }) => {
			const bytes = JSON.stringify(operation.input);
			const receipt = receipts.get(callId);
			if (receipt && receipt.bytes !== bytes)
				throw new DeclaredOperationError("IDEMPOTENCY_CONFLICT", 409, {
					callId,
				});
			if (receipt) return receipt.result;
			writes += 1;
			const result = { ok: true };
			receipts.set(callId, { bytes, result });
			return result;
		},
	});
	const invoke = (value: string) =>
		transport.fetch(
			post(
				"/_questpie/mutation/messages.publish",
				{ "Idempotency-Key": "receipt-call" },
				JSON.stringify({ context, input: { value } }),
			),
		);

	for (const response of [await invoke("first"), await invoke("first")]) {
		expect(response?.status).toBe(200);
		expect(await response?.json()).toEqual({
			callId: "receipt-call",
			result: { ok: true },
		});
	}
	expect(writes).toBe(1);
	const conflict = await invoke("changed");
	expect(conflict?.status).toBe(409);
	expect(await conflict?.json()).toEqual({
		callId: "receipt-call",
		error: {
			code: "IDEMPOTENCY_CONFLICT",
			payload: { callId: "receipt-call" },
		},
	});
});

test("canonical POST decodes after credentials and preserves kind identities", async () => {
	const executions: unknown[] = [];
	let authenticated = true;
	const transport = createCanonicalPostHttp({
		application: "application:test",
		clientContractDigest: "1".repeat(64),
		httpContractDigest: "2".repeat(64),
		maximumRequestBytes: 4096,
		maximumResponseBytes: 4096,
		contextCodec: http02ContextCodec as never,
		operations: operations as never,
		prepare: (identity, value) =>
			({
				declaredErrors: [],
				input: value,
				inputCodec: http02InputCodec,
				output: http02OutputCodec,
				binding: { identity, kind: "mutation" },
			}) as never,
		resolvePrincipal: async () => (authenticated ? user : null),
		executeMutation: async (value) => {
			executions.push(value);
			if (value.callId === "committed")
				throw new CommittedResultUnavailable("committed", "901");
			return { ok: true };
		},
		executeAction: async (value) => {
			executions.push(value);
			if (value.effectKey === "oversized")
				throw new RuntimeActionPostHandlerResourceLimit();
			return { ok: true };
		},
		now: () => 1000,
	});

	const mutation = await transport.fetch(
		post("/_questpie/mutation/messages.publish", {
			"Idempotency-Key": "mutation%20key%2C%C3%A9",
			"Questpie-Timeout-Milliseconds": "5000",
		}),
	);
	expect(mutation?.status).toBe(200);
	expect(await mutation?.json()).toEqual({
		callId: "mutation key,é",
		result: { ok: true },
	});
	const action = await transport.fetch(
		post("/_questpie/action/delivery.send", {
			"Effect-Key": "effect%20key%2C%C3%A9",
			"Questpie-Call-Id": "action-call",
		}),
	);
	expect(action?.status).toBe(200);
	expect(await action?.json()).toEqual({
		callId: "action-call",
		result: { ok: true },
	});
	const postHandlerLimit = await transport.fetch(
		post("/_questpie/action/delivery.send", {
			"Effect-Key": "oversized",
			"Questpie-Call-Id": "resource-call",
		}),
	);
	expect(postHandlerLimit?.status).toBe(429);
	expect(await postHandlerLimit?.json()).toEqual({
		callId: "resource-call",
		error: { code: "RESOURCE_LIMIT", retryable: false },
	});
	expect(executions).toEqual([
		expect.objectContaining({
			callId: "mutation key,é",
			context,
			deadline: 6000,
		}),
		expect.objectContaining({
			callId: "action-call",
			context,
			effectKey: "effect key,é",
			operationInput: { value: "accepted" },
		}),
		expect.objectContaining({
			callId: "resource-call",
			effectKey: "oversized",
		}),
	]);

	authenticated = false;
	const credentialBeforeDecode = await transport.fetch(
		post(
			"/_questpie/mutation/messages.publish",
			{ "Idempotency-Key": "unauthenticated" },
			'{"context":',
		),
	);
	expect(credentialBeforeDecode?.status).toBe(401);
	authenticated = true;
	const duplicate = await transport.fetch(
		post(
			"/_questpie/mutation/messages.publish",
			{ "Idempotency-Key": "duplicate" },
			`{"context":${JSON.stringify(context)},"input":{"value":"one","value":"two"}}`,
		),
	);
	expect(duplicate?.status).toBe(400);
	expect(executions).toHaveLength(3);

	const committed = await transport.fetch(
		post("/_questpie/mutation/messages.publish", {
			"Idempotency-Key": "committed",
		}),
	);
	expect(committed?.status).toBe(500);
	expect(await committed?.json()).toEqual({
		callId: "committed",
		error: {
			code: "COMMITTED_RESULT_UNAVAILABLE",
			retryable: true,
			transactionId: "901",
		},
	});
	expect(
		await transport.fetch(
			new Request("https://runtime.test/_questpie/operation", {
				method: "POST",
			}),
		),
	).toBeNull();
});
