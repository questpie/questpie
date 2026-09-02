import { expect, test } from "bun:test";

import { principal } from "questpie";

import { createCanonicalQueryHttp } from "../../packages/runtime/src/application/http-query";
import {
	http02ContextCodec,
	http02InputCodec,
	http02OutputCodec,
} from "../support/http02-contract";

const user = principal.user({
	id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4",
});

function transport(
	overrides: Partial<Parameters<typeof createCanonicalQueryHttp>[0]> = {},
) {
	return createCanonicalQueryHttp({
		application: "application:test",
		clientContractDigest: "1".repeat(64),
		httpContractDigest: "2".repeat(64),
		maximumResponseBytes: 4096,
		contextCodec: http02ContextCodec as never,
		operations: [
			{
				identity: "query:messages.page",
				input: http02InputCodec,
				output: http02OutputCodec,
				declaredErrors: [],
			},
		] as never,
		prepare: (identity, value) =>
			({
				declaredErrors: [],
				input: value,
				inputCodec: http02InputCodec,
				output: http02OutputCodec,
				binding: { identity, kind: "query" },
			}) as never,
		resolvePrincipal: async () => user,
		execute: async () => ({ ok: true }),
		now: () => Date.now(),
		...overrides,
	} as never);
}

test("canonical Query deadline settles an abort-ignoring credential resolver", async () => {
	let executorCalls = 0;
	const response = await Promise.race([
		transport({
			resolvePrincipal: async () => new Promise<never>(() => {}),
			execute: async () => {
				executorCalls += 1;
				return { ok: true };
			},
		}).fetch(
			new Request(
				"https://runtime.test/_questpie/query/messages.page?value=accepted",
				{
					headers: {
						"Questpie-Call-Id": "noncooperative-credential",
						"Questpie-Timeout-Milliseconds": "5",
					},
				},
			),
		),
		new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 100)),
	]);
	expect(response).not.toBe("hung");
	if (response === "hung") return;
	expect(response?.status).toBe(408);
	expect(response?.headers.get("cache-control")).toBe("private, no-store");
	expect(await response?.json()).toEqual({
		callId: "noncooperative-credential",
		error: { code: "DEADLINE_EXCEEDED", retryable: true },
	});
	expect(executorCalls).toBe(0);
});
