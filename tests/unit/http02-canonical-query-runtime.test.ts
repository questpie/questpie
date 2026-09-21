import { expect, test } from "bun:test";

import { principal } from "questpie";

import { createCanonicalQueryHttp } from "../../packages/runtime/src/application/http-query";
import {
	RuntimeCredentialMalformed,
	RuntimeCredentialUnavailable,
} from "../../packages/runtime/src/execution";
import { OperationFailure } from "../../packages/runtime/src/operation";
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

test("canonical Query maps only typed credential outcomes before URL decoding", async () => {
	for (const [error, status, code, retryable] of [
		[new RuntimeCredentialMalformed(), 401, "UNAUTHENTICATED", false],
		[new RuntimeCredentialUnavailable(), 503, "RUNTIME_UNAVAILABLE", true],
		[new OperationFailure("UNAUTHENTICATED"), 500, "INTERNAL", false],
		[new Error("credential secret"), 500, "INTERNAL", false],
	] as const) {
		let prepareCalls = 0;
		let executorCalls = 0;
		const response = await transport({
			resolvePrincipal: async () => {
				throw error;
			},
			prepare: () => {
				prepareCalls += 1;
				throw new Error("must not decode");
			},
			execute: async () => {
				executorCalls += 1;
				return { ok: true };
			},
		}).fetch(
			new Request(
				"https://runtime.test/_questpie/query/messages.page?unknown=input",
				{ headers: { "Questpie-Call-Id": "credential-before-query" } },
			),
		);
		expect(response?.status).toBe(status);
		expect(response?.headers.get("cache-control")).toBe("private, no-store");
		expect(await response?.json()).toEqual({
			callId: "credential-before-query",
			error: { code, retryable },
		});
		expect({ prepareCalls, executorCalls }).toEqual({
			prepareCalls: 0,
			executorCalls: 0,
		});
	}
});

test("canonical Query 401 carries the app-supplied WWW-Authenticate challenge on a missing/invalid credential", async () => {
	const response = await transport({
		resolvePrincipal: async () => null,
		credentialChallenge: () =>
			'Bearer resource_metadata="https://runtime.test/.well-known/oauth-protected-resource"',
	}).fetch(
		new Request(
			"https://runtime.test/_questpie/query/messages.page?value=accepted",
			{ headers: { "Questpie-Call-Id": "challenge-query" } },
		),
	);
	expect(response?.status).toBe(401);
	expect(response?.headers.get("www-authenticate")).toBe(
		'Bearer resource_metadata="https://runtime.test/.well-known/oauth-protected-resource"',
	);
	expect(await response?.json()).toEqual({
		callId: "challenge-query",
		error: { code: "UNAUTHENTICATED", retryable: false },
	});
});

test("canonical Query 401 omits WWW-Authenticate when the app declares no challenge, unchanged from today", async () => {
	const response = await transport({
		resolvePrincipal: async () => null,
	}).fetch(
		new Request(
			"https://runtime.test/_questpie/query/messages.page?value=accepted",
			{ headers: { "Questpie-Call-Id": "no-challenge-query" } },
		),
	);
	expect(response?.status).toBe(401);
	expect(response?.headers.has("www-authenticate")).toBe(false);
});

test("a Policy-neutral RUNTIME_UNAVAILABLE credential outcome never receives the challenge header", async () => {
	const response = await transport({
		resolvePrincipal: async () => {
			throw new RuntimeCredentialUnavailable();
		},
		credentialChallenge: () => "Bearer",
	}).fetch(
		new Request(
			"https://runtime.test/_questpie/query/messages.page?value=accepted",
			{ headers: { "Questpie-Call-Id": "unavailable-query" } },
		),
	);
	expect(response?.status).toBe(503);
	expect(response?.headers.has("www-authenticate")).toBe(false);
});

test("F4: a throwing credentialChallenge degrades to no header on canonical Query, never a 500 or leaked message", async () => {
	const response = await transport({
		resolvePrincipal: async () => null,
		credentialChallenge: () => {
			throw new Error("credential secret leak attempt");
		},
	}).fetch(
		new Request(
			"https://runtime.test/_questpie/query/messages.page?value=accepted",
			{ headers: { "Questpie-Call-Id": "throwing-challenge-query" } },
		),
	);
	expect(response?.status).toBe(401);
	expect(response?.headers.has("www-authenticate")).toBe(false);
	const bodyText = await response?.text();
	expect(bodyText).not.toContain("credential secret");
});

test("F4: a CRLF-injecting credentialChallenge is rejected on canonical Query, never forwarded as a header", async () => {
	const response = await transport({
		resolvePrincipal: async () => null,
		credentialChallenge: () => "Bearer\r\nSet-Cookie: evil=1",
	}).fetch(
		new Request(
			"https://runtime.test/_questpie/query/messages.page?value=accepted",
			{ headers: { "Questpie-Call-Id": "crlf-challenge-query" } },
		),
	);
	expect(response?.status).toBe(401);
	expect(response?.headers.has("www-authenticate")).toBe(false);
});
