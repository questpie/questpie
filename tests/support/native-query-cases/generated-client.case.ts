import { expect, test } from "bun:test";

import { createClient } from "#questpie/test-client";

const id = "018f5f6e-5f2c-7b41-a854-3d9a6b6b7131";
const updatedAt = "2026-09-08T10:00:00.000Z";

function reply(request: Request, body: object, status = 200): Response {
	const identityHeader =
		request.method === "GET" ? "Questpie-Call-Id" : "Idempotency-Key";
	return new Response(
		JSON.stringify({
			callId: decodeURIComponent(request.headers.get(identityHeader)!),
			...body,
		}),
		{
			status,
			headers: { "content-type": "application/json; charset=utf-8" },
		},
	);
}

test("the production-generated Task client preserves Date codecs and its named GET endpoint", async () => {
	const requests: Request[] = [];
	const client = createClient({
		baseUrl: "https://proof.invalid",
		fetch: (async (request: Request) => {
			requests.push(request);
			return reply(request, { result: { id, title: "Task", updatedAt } });
		}) as typeof fetch,
	});
	const result = await client
		.withContext({ companyId: id })
		.queries["tasks.detail"]({ id, asOf: new Date(updatedAt) });
	expect(result?.updatedAt).toBeInstanceOf(Date);
	expect(result?.updatedAt.toISOString()).toBe(updatedAt);
	expect(requests[0]?.method).toBe("GET");
	expect(new URL(requests[0]!.url).pathname).toBe(
		"/_questpie/query/tasks.detail",
	);
	expect(new URL(requests[0]!.url).searchParams.get("asOf")).toBe(updatedAt);
});

test("the production-generated Mutation decodes a declared error without inventing retryability", async () => {
	const client = createClient({
		baseUrl: "https://proof.invalid",
		fetch: (async (request: Request) =>
			reply(
				request,
				{
					error: { code: "VERSION_CONFLICT", payload: { currentVersion: 3 } },
				},
				409,
			)) as typeof fetch,
	});
	const error = await client
		.withContext({ companyId: id })
		.mutations["tasks.transition"]({
			id,
			expectedVersion: 2,
			targetStatus: "done",
		})
		.catch((failure: unknown) => failure);
	expect(error).toMatchObject({
		code: "VERSION_CONFLICT",
		status: 409,
		payload: { currentVersion: 3 },
	});
	expect(Object.keys(error as object).sort()).toEqual([
		"code",
		"payload",
		"status",
	]);
});
