import { expect, test } from "bun:test";

import { principal } from "questpie";

import { RuntimeActionPostHandlerResourceLimit } from "../../packages/runtime/src/action";
import { createCanonicalPostHttp } from "../../packages/runtime/src/application/http-post";
import { CommittedResultUnavailable } from "../../packages/runtime/src/operation";

const contextCodec = {
	kind: "object",
	properties: { tenantId: { kind: "uuid" } },
} as const;
const valueCodec = {
	kind: "object",
	properties: { value: { kind: "text", maxLength: 32 } },
} as const;
const outputCodec = {
	kind: "object",
	properties: { ok: { kind: "boolean" } },
} as const;
const operations = [
	{
		identity: "mutation:messages.publish",
		input: valueCodec,
		output: outputCodec,
		declaredErrors: [],
	},
	{
		identity: "action:delivery.send",
		input: valueCodec,
		output: outputCodec,
		declaredErrors: [],
	},
] as const;
const user = principal.user({
	id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4",
});
const context = {
	tenantId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0",
};

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

test("canonical POST decodes after credentials and preserves kind identities", async () => {
	const executions: unknown[] = [];
	let authenticated = true;
	const transport = createCanonicalPostHttp({
		application: "application:test",
		clientContractDigest: "1".repeat(64),
		httpContractDigest: "2".repeat(64),
		maximumRequestBytes: 4096,
		maximumResponseBytes: 4096,
		contextCodec: contextCodec as never,
		operations: operations as never,
		prepare: (identity, value) =>
			({
				declaredErrors: [],
				input: value,
				inputCodec: valueCodec,
				output: outputCodec,
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
