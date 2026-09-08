import { expect, test } from "bun:test";

import { MutationObserver, QueryClient } from "@tanstack/query-core";

import { CommittedResultUnavailable, createClient } from "./generated/client";
import { createQueryAdapter } from "./generated/client.react-query";

const id = "018f5f6e-5f2c-7b41-a854-3d9a6b6b7131";
const variables = { id, expectedVersion: 1, targetStatus: "done" };

test("a decoded failure from another invocation cannot supply this write's outcome", async () => {
	const received = Promise.withResolvers<Request>();
	const response = Promise.withResolvers<Response>();
	let calls = 0;
	const client = createClient({
		baseUrl: "https://proof.invalid",
		fetch: (async (request: Request) => {
			if (++calls === 1)
				return new Response(
					JSON.stringify({
						callId: request.headers.get("Idempotency-Key"),
						error: {
							code: "COMMITTED_RESULT_UNAVAILABLE",
							retryable: true,
							transactionId: "17",
						},
					}),
					{
						status: 500,
						headers: { "content-type": "application/json; charset=utf-8" },
					},
				);
			received.resolve(request);
			return response.promise;
		}) as typeof fetch,
	});
	const scope = client.withContext({ companyId: id });
	const oldFailure = await scope.mutations["tasks.transition"](variables).catch(
		(error: unknown) => error,
	);
	expect(oldFailure).toBeInstanceOf(CommittedResultUnavailable);
	const cache = new QueryClient();
	const adapter = createQueryAdapter(scope, cache);
	const observer = new MutationObserver(
		cache,
		adapter.mutations["tasks.transition"].options(),
	);
	try {
		const completion = observer
			.mutate(variables)
			.catch((error: unknown) => error);
		const request = await received.promise;
		await adapter.dispose();
		response.reject(oldFailure);
		const outcome = await completion;
		expect(outcome).toMatchObject({
			code: "SCOPE_RETIRED",
			outcome: {
				kind: "unknown",
				callId: request.headers.get("Idempotency-Key"),
			},
		});
		expect(JSON.stringify(outcome)).not.toContain("transactionId");
	} finally {
		observer.reset();
		await adapter.dispose();
		cache.clear();
	}
});

test("a native Mutation subscriber exception cannot leave another owned observer uncleared", async () => {
	const client = createClient({
		baseUrl: "https://proof.invalid",
		fetch: (async (request: Request) =>
			new Response(
				JSON.stringify({
					callId: request.headers.get("Idempotency-Key"),
					result: {
						id,
						title: "Owned result",
						updatedAt: "2026-09-08T10:00:00.000Z",
					},
				}),
				{ headers: { "content-type": "application/json; charset=utf-8" } },
			)) as typeof fetch,
	});
	const cache = new QueryClient();
	const adapter = createQueryAdapter(
		client.withContext({ companyId: id }),
		cache,
	);
	const options = adapter.mutations["tasks.transition"].options();
	const first = new MutationObserver(cache, options);
	const second = new MutationObserver(cache, options);
	let closing = false;
	const stopFirst = first.subscribe(() => {
		if (closing) throw new Error("Application subscriber failure");
	});
	const stopSecond = second.subscribe(() => {});
	try {
		const result = await first.mutate(variables);
		await second.mutate(variables);
		cache.setQueryData(
			adapter.queries["tasks.detail"].options({ id }).queryKey,
			() => result,
		);
		expect(cache.getQueryCache().getAll()).toHaveLength(1);
		closing = true;
		await expect(adapter.dispose()).rejects.toThrow();
		expect(first.getCurrentResult().data).toBeUndefined();
		expect(second.getCurrentResult().data).toBeUndefined();
		expect(cache.getMutationCache().getAll()).toHaveLength(0);
		expect(cache.getQueryCache().getAll()).toHaveLength(0);
	} finally {
		closing = false;
		stopFirst();
		stopSecond();
		first.reset();
		second.reset();
		await adapter.dispose();
		cache.clear();
	}
});

test("already-started native callback work may settle but cannot restore its detached UI", async () => {
	const entered = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	let calls = 0;
	const client = createClient({
		baseUrl: "https://proof.invalid",
		fetch: (async (request: Request) => {
			calls++;
			return new Response(
				JSON.stringify({
					callId: request.headers.get("Idempotency-Key"),
					result: {
						id,
						title: "Already disclosed result",
						updatedAt: "2026-09-08T10:00:00.000Z",
					},
				}),
				{ headers: { "content-type": "application/json; charset=utf-8" } },
			);
		}) as typeof fetch,
	});
	const cache = new QueryClient();
	const adapter = createQueryAdapter(
		client.withContext({ companyId: id }),
		cache,
	);
	const observer = new MutationObserver(cache, {
		...adapter.mutations["tasks.transition"].options(),
		onSuccess: async () => {
			entered.resolve();
			await release.promise;
		},
	});
	const stop = observer.subscribe(() => {});
	try {
		const completion = observer.mutate(variables);
		await entered.promise;
		await adapter.dispose();
		release.resolve();
		expect((await completion).title).toBe("Already disclosed result");
		expect(observer.getCurrentResult().data).toBeUndefined();
		expect(observer.getCurrentResult().isIdle).toBe(true);
		expect(cache.getMutationCache().getAll()).toHaveLength(0);
		expect(calls).toBe(1);
	} finally {
		release.resolve();
		stop();
		observer.reset();
		await adapter.dispose();
		cache.clear();
	}
});

test("retained native Mutation options cannot dispatch through a retired scope", async () => {
	let calls = 0;
	const client = createClient({
		baseUrl: "https://proof.invalid",
		fetch: Object.assign(
			async () => {
				calls++;
				throw new Error("Unexpected transport");
			},
			{ preconnect() {} },
		),
	});
	const cache = new QueryClient();
	const adapter = createQueryAdapter(
		client.withContext({ companyId: id }),
		cache,
	);
	const observer = new MutationObserver(
		cache,
		adapter.mutations["tasks.transition"].options(),
	);
	try {
		await adapter.dispose();
		await expect(observer.mutate(variables)).rejects.toMatchObject({
			code: "SCOPE_RETIRED",
			outcome: { kind: "not-dispatched" },
		});
		expect(calls).toBe(0);
	} finally {
		observer.reset();
		await adapter.dispose();
		cache.clear();
	}
});

test("a success disclosed after retirement keeps commit identity but no domain result", async () => {
	const received = Promise.withResolvers<Request>();
	const response = Promise.withResolvers<Response>();
	const client = createClient({
		baseUrl: "https://proof.invalid",
		fetch: (async (request: Request) => {
			received.resolve(request);
			return response.promise;
		}) as typeof fetch,
	});
	const cache = new QueryClient();
	const adapter = createQueryAdapter(
		client.withContext({ companyId: id }),
		cache,
	);
	let successes = 0;
	const observer = new MutationObserver(cache, {
		...adapter.mutations["tasks.transition"].options(),
		onSuccess: () => {
			successes++;
		},
	});
	const stop = observer.subscribe(() => {});
	try {
		const completion = observer
			.mutate(variables)
			.catch((error: unknown) => error);
		const request = await received.promise;
		await adapter.dispose();
		response.resolve(
			new Response(
				JSON.stringify({
					callId: request.headers.get("Idempotency-Key"),
					result: {
						id,
						title: "Retired protected result",
						updatedAt: "2026-09-08T10:00:00.000Z",
					},
				}),
				{ headers: { "content-type": "application/json; charset=utf-8" } },
			),
		);
		const outcome = await completion;
		expect(outcome).toMatchObject({
			code: "SCOPE_RETIRED",
			outcome: {
				kind: "committed",
				callId: request.headers.get("Idempotency-Key"),
			},
		});
		expect(JSON.stringify(outcome)).not.toContain("Retired protected result");
		expect(observer.getCurrentResult().data).toBeUndefined();
		expect(observer.getCurrentResult().isIdle).toBe(true);
		expect(successes).toBe(0);
		expect(cache.getMutationCache().getAll()).toHaveLength(0);
	} finally {
		stop();
		observer.reset();
		await adapter.dispose();
		cache.clear();
	}
});

test("retirement preserves real post-commit recovery identities without relabelling the outcome", async () => {
	const received = Promise.withResolvers<Request>();
	const response = Promise.withResolvers<Response>();
	const client = createClient({
		baseUrl: "https://proof.invalid",
		fetch: (async (request: Request) => {
			received.resolve(request);
			return response.promise;
		}) as typeof fetch,
	});
	const cache = new QueryClient();
	const adapter = createQueryAdapter(
		client.withContext({ companyId: id }),
		cache,
	);
	const observer = new MutationObserver(
		cache,
		adapter.mutations["tasks.transition"].options(),
	);
	const stop = observer.subscribe(() => {});
	try {
		const completion = observer
			.mutate(variables)
			.catch((error: unknown) => error);
		const request = await received.promise;
		await adapter.dispose();
		response.resolve(
			new Response(
				JSON.stringify({
					callId: request.headers.get("Idempotency-Key"),
					error: {
						code: "COMMITTED_RESULT_UNAVAILABLE",
						retryable: true,
						transactionId: "17",
					},
				}),
				{
					status: 500,
					headers: { "content-type": "application/json; charset=utf-8" },
				},
			),
		);
		expect(await completion).toMatchObject({
			code: "SCOPE_RETIRED",
			outcome: {
				kind: "committed",
				callId: request.headers.get("Idempotency-Key"),
				transactionId: "17",
			},
		});
		expect(observer.getCurrentResult().data).toBeUndefined();
		expect(cache.getMutationCache().getAll()).toHaveLength(0);
	} finally {
		stop();
		observer.reset();
		await adapter.dispose();
		cache.clear();
	}
});

for (const failure of [
	"declared",
	"transport",
	"forged-commit",
	"constructed-commit",
	"forged-declared",
] as const) {
	test(`retired ${failure} failure exposes only its safe outcome and stable identity`, async () => {
		const received = Promise.withResolvers<Request>();
		const response = Promise.withResolvers<Response>();
		const client = createClient({
			baseUrl: "https://proof.invalid",
			fetch: (async (request: Request) => {
				received.resolve(request);
				return response.promise;
			}) as typeof fetch,
		});
		const cache = new QueryClient();
		const adapter = createQueryAdapter(
			client.withContext({ companyId: id }),
			cache,
		);
		const observer = new MutationObserver(
			cache,
			adapter.mutations["tasks.transition"].options(),
		);
		try {
			const completion = observer
				.mutate(variables)
				.catch((error: unknown) => error);
			const request = await received.promise;
			await adapter.dispose();
			const callId = request.headers.get("Idempotency-Key");
			if (failure === "declared")
				response.resolve(
					new Response(
						JSON.stringify({
							callId,
							error: {
								code: "VERSION_CONFLICT",
								payload: { currentVersion: 9 },
							},
						}),
						{
							status: 409,
							headers: { "content-type": "application/json; charset=utf-8" },
						},
					),
				);
			else if (failure === "constructed-commit")
				response.reject(
					new CommittedResultUnavailable(callId!, "Private transport detail"),
				);
			else if (failure === "forged-declared")
				response.reject(
					Object.assign(new Error("Private transport detail"), {
						code: "VERSION_CONFLICT",
						status: 409,
						payload: { currentVersion: 9 },
					}),
				);
			else
				response.reject(
					Object.assign(
						new Error("Private transport detail"),
						failure === "forged-commit"
							? {
									code: "COMMITTED_RESULT_UNAVAILABLE",
									payload: { callId, transactionId: "17" },
								}
							: {},
					),
				);
			const outcome = await completion;
			expect(outcome).toMatchObject({
				code: "SCOPE_RETIRED",
				outcome: {
					kind: failure === "declared" ? "rejected" : "unknown",
					callId,
				},
			});
			expect(JSON.stringify(outcome)).not.toContain("currentVersion");
			expect(JSON.stringify(outcome)).not.toContain("Private transport detail");
			expect(JSON.stringify(outcome)).not.toContain("transactionId");
		} finally {
			observer.reset();
			await adapter.dispose();
			cache.clear();
		}
	});
}

test("scope disposal clears attached native Mutation state without touching another scope", async () => {
	const client = createClient({
		baseUrl: "https://proof.invalid",
		fetch: (async (request: Request) =>
			new Response(
				JSON.stringify({
					callId: request.headers.get("Idempotency-Key"),
					result: {
						id,
						title: "Previously authorized result",
						updatedAt: "2026-09-08T10:00:00.000Z",
					},
				}),
				{ headers: { "content-type": "application/json; charset=utf-8" } },
			)) as typeof fetch,
	});
	const cache = new QueryClient();
	const first = createQueryAdapter(
		client.withContext({ companyId: id }),
		cache,
	);
	const second = createQueryAdapter(
		client.withContext({ companyId: id }),
		cache,
	);
	const firstObserver = new MutationObserver(
		cache,
		first.mutations["tasks.transition"].options(),
	);
	const secondObserver = new MutationObserver(
		cache,
		second.mutations["tasks.transition"].options(),
	);
	const stopFirst = firstObserver.subscribe(() => {});
	const stopSecond = secondObserver.subscribe(() => {});
	try {
		await firstObserver.mutate(variables);
		await secondObserver.mutate(variables);
		expect(firstObserver.getCurrentResult().data?.title).toBe(
			"Previously authorized result",
		);
		await first.dispose();
		expect(firstObserver.getCurrentResult().data).toBeUndefined();
		expect(firstObserver.getCurrentResult().variables).toBeUndefined();
		expect(firstObserver.getCurrentResult().isIdle).toBe(true);
		expect(secondObserver.getCurrentResult().data?.title).toBe(
			"Previously authorized result",
		);
		expect(cache.getMutationCache().getAll()).toHaveLength(1);
	} finally {
		stopFirst();
		stopSecond();
		firstObserver.reset();
		secondObserver.reset();
		await first.dispose();
		await second.dispose();
		cache.clear();
	}
});
