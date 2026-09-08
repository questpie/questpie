import { expect, test } from "bun:test";

import {
	MutationObserver,
	QueryClient,
	QueryObserver,
} from "@tanstack/react-query";
import { createQueryAdapter } from "questpie/react-query";

import {
	CommittedResultUnavailable,
	createClient,
} from "#questpie/test-client";

const id = "018f5f6e-5f2c-7b41-a854-3d9a6b6b7131";
const updatedAt = "2026-09-08T10:00:00.000Z";
const variables = { id, expectedVersion: 1, targetStatus: "done" };

test("commit preserves native disabled and static observer behavior without unsolicited refresh", async () => {
	let reads = 0;
	const client = createClient({
		baseUrl: "https://proof.invalid",
		fetch: (async (request: Request) => {
			if (request.method === "GET") reads++;
			return reply(request, {
				result: { id, title: "Authorized result", updatedAt },
			});
		}) as typeof fetch,
	});
	const cache = new QueryClient();
	const adapter = createQueryAdapter(
		client.withContext({ companyId: id }),
		cache,
	);
	const disabledOptions = adapter.queries["tasks.detail"].options({ id });
	const staticOptions = adapter.queries["tasks.summary"].options({ id });
	await cache.fetchQuery(disabledOptions);
	await cache.fetchQuery(staticOptions);
	const disabled = new QueryObserver(cache, {
		...disabledOptions,
		enabled: false,
	});
	const fixed = new QueryObserver(cache, {
		...staticOptions,
		staleTime: "static",
	});
	const stopDisabled = disabled.subscribe(() => {});
	const stopStatic = fixed.subscribe(() => {});
	const mutation = new MutationObserver(
		cache,
		adapter.mutations["tasks.transition"].options(),
	);
	try {
		expect(reads).toBe(2);
		await mutation.mutate(variables);
		await Bun.sleep(0);
		expect(reads).toBe(2);
		expect(cache.getQueryState(disabledOptions.queryKey)?.isInvalidated).toBe(
			true,
		);
		expect(cache.getQueryState(staticOptions.queryKey)?.isInvalidated).toBe(
			true,
		);
		expect(disabled.getCurrentResult().isStale).toBe(false);
		expect(fixed.getCurrentResult().isStale).toBe(false);
		expect(disabled.getCurrentResult().isFetching).toBe(false);
		expect(fixed.getCurrentResult().isFetching).toBe(false);
		expect(mutation.getCurrentResult().isSuccess).toBe(true);
	} finally {
		stopDisabled();
		stopStatic();
		disabled.destroy();
		fixed.destroy();
		mutation.reset();
		await adapter.dispose();
		cache.clear();
	}
});

test("a correlated committed-result failure refreshes two generated public families without touching another owner", async () => {
	const refreshed = Promise.withResolvers<void>();
	const refreshedPaths: string[] = [];
	let committed = false;
	const client = createClient({
		baseUrl: "https://proof.invalid",
		fetch: (async (request: Request) => {
			if (request.method !== "GET") {
				committed = true;
				return reply(
					request,
					{
						error: {
							code: "COMMITTED_RESULT_UNAVAILABLE",
							retryable: true,
							transactionId: "17",
						},
					},
					500,
				);
			}
			if (committed) {
				refreshedPaths.push(new URL(request.url).pathname);
				if (refreshedPaths.length === 2) refreshed.resolve();
			}
			return reply(request, {
				result: committed
					? { id, title: "Refreshed after commit", updatedAt }
					: null,
			});
		}) as typeof fetch,
	});
	const cache = new QueryClient();
	const adapter = createQueryAdapter(
		client.withContext({ companyId: id }),
		cache,
	);
	const other = createQueryAdapter(
		client.withContext({ companyId: id }),
		cache,
	);
	const detail = adapter.queries["tasks.detail"].options({ id });
	const summary = adapter.queries["tasks.summary"].options({ id });
	const otherSummary = other.queries["tasks.summary"].options({ id });
	await Promise.all([
		cache.fetchQuery(detail),
		cache.fetchQuery(summary),
		cache.fetchQuery(otherSummary),
	]);
	const first = new QueryObserver(cache, { ...detail, staleTime: Infinity });
	const second = new QueryObserver(cache, { ...summary, staleTime: Infinity });
	const stopFirst = first.subscribe(() => {});
	const stopSecond = second.subscribe(() => {});
	const mutation = new MutationObserver(
		cache,
		adapter.mutations["tasks.transition"].options(),
	);
	try {
		const failure = await mutation
			.mutate(variables)
			.catch((error: unknown) => error);
		await refreshed.promise;
		await Bun.sleep(0);
		expect(failure).toMatchObject({
			code: "COMMITTED_RESULT_UNAVAILABLE",
			payload: { transactionId: "17" },
		});
		expect(refreshedPaths.sort()).toEqual([
			"/_questpie/query/tasks.detail",
			"/_questpie/query/tasks.summary",
		]);
		expect(first.getCurrentResult().data?.title).toBe("Refreshed after commit");
		expect(second.getCurrentResult().data?.title).toBe(
			"Refreshed after commit",
		);
		expect(cache.getQueryData(otherSummary.queryKey)).toBeNull();
		expect(cache.getQueryState(otherSummary.queryKey)?.isInvalidated).toBe(
			false,
		);
		expect(mutation.getCurrentResult().isError).toBe(true);
	} finally {
		stopFirst();
		stopSecond();
		first.destroy();
		second.destroy();
		mutation.reset();
		await adapter.dispose();
		await other.dispose();
		cache.clear();
	}
});

for (const boundary of ["retirement", "next-commit"] as const) {
	test(`${boundary} fences an in-flight refresh without changing the original Mutation result`, async () => {
		const received = Promise.withResolvers<Request>();
		const held = Promise.withResolvers<Response>();
		let reads = 0;
		const client = createClient({
			baseUrl: "https://proof.invalid",
			fetch: (async (request: Request) => {
				if (request.method !== "GET")
					return reply(request, {
						result: { id, title: "Committed", updatedAt },
					});
				if (++reads === 2) {
					received.resolve(request);
					return held.promise;
				}
				return reply(request, { result: null });
			}) as typeof fetch,
		});
		const cache = new QueryClient();
		const adapter = createQueryAdapter(
			client.withContext({ companyId: id }),
			cache,
		);
		const options = {
			...adapter.queries["tasks.detail"].options({ id }),
			staleTime: 60_000,
		};
		await cache.fetchQuery(options);
		const query = new QueryObserver(cache, options);
		const stop = query.subscribe(() => {});
		const mutation = new MutationObserver(
			cache,
			adapter.mutations["tasks.transition"].options(),
		);
		let replacement: typeof adapter | undefined;
		let request: Request | undefined;
		try {
			expect((await mutation.mutate(variables)).title).toBe("Committed");
			request = await received.promise;
			if (boundary === "retirement") {
				await adapter.dispose();
				replacement = createQueryAdapter(
					client.withContext({ companyId: id }),
					cache,
				);
				await cache.fetchQuery(
					replacement.queries["tasks.detail"].options({ id }),
				);
			} else await mutation.mutate({ ...variables, expectedVersion: 2 });
			await Bun.sleep(0);
			expect(request.signal.aborted).toBe(true);
			held.resolve(
				reply(request, {
					result: { id, title: "Obsolete refresh", updatedAt },
				}),
			);
			await Bun.sleep(0);
			expect(reads).toBe(3);
			if (replacement) {
				expect(
					cache.getQueryData(
						replacement.queries["tasks.detail"].options({ id }).queryKey,
					),
				).toBeNull();
				expect(cache.getQueryData(options.queryKey)).toBeUndefined();
			} else expect(cache.getQueryData(options.queryKey)).toBeNull();
		} finally {
			if (request) held.resolve(reply(request, { result: null }));
			stop();
			query.destroy();
			mutation.reset();
			await adapter.dispose();
			await replacement?.dispose();
			cache.clear();
		}
	});
}

test("refresh failure cannot replace a committed result or an application's native callback", async () => {
	let committed = false;
	let successes = 0;
	const failed = Promise.withResolvers<void>();
	const client = createClient({
		baseUrl: "https://proof.invalid",
		fetch: (async (request: Request) => {
			if (request.method === "GET") {
				if (committed) throw new Error("Refresh unavailable");
				return reply(request, { result: null });
			}
			committed = true;
			return reply(request, { result: { id, title: "Committed", updatedAt } });
		}) as typeof fetch,
	});
	const cache = new QueryClient();
	const adapter = createQueryAdapter(
		client.withContext({ companyId: id }),
		cache,
	);
	const options = {
		...adapter.queries["tasks.detail"].options({ id }),
		staleTime: 60_000,
	};
	await cache.fetchQuery(options);
	const query = new QueryObserver(cache, options);
	const stop = query.subscribe((result) => {
		if (result.isError) failed.resolve();
	});
	const mutation = new MutationObserver(cache, {
		...adapter.mutations["tasks.transition"].options(),
		onSuccess: () => {
			successes++;
		},
	});
	try {
		expect((await mutation.mutate(variables)).title).toBe("Committed");
		await failed.promise;
		expect(mutation.getCurrentResult().isSuccess).toBe(true);
		expect(query.getCurrentResult().isError).toBe(true);
		expect(successes).toBe(1);
	} finally {
		stop();
		query.destroy();
		mutation.reset();
		await adapter.dispose();
		cache.clear();
	}
});
function reply(request: Request, body: object, status = 200) {
	return new Response(
		JSON.stringify({
			callId: request.headers.get(
				request.method === "GET" ? "Questpie-Call-Id" : "Idempotency-Key",
			),
			...body,
		}),
		{ status, headers: { "content-type": "application/json; charset=utf-8" } },
	);
}

for (const outcome of [
	"committed-unavailable",
	"declared",
	"unknown",
	"forged-commit",
] as const) {
	test(`${outcome} preserves its outcome and invalidates only a decoder-proven commit`, async () => {
		const client = createClient({
			baseUrl: "https://proof.invalid",
			fetch: (async (request: Request) => {
				if (request.method === "GET") return reply(request, { result: null });
				if (outcome === "unknown") throw new Error("Transport lost");
				if (outcome === "forged-commit")
					throw new CommittedResultUnavailable(
						request.headers.get("Idempotency-Key")!,
						"17",
					);
				return outcome === "declared"
					? reply(
							request,
							{
								error: {
									code: "VERSION_CONFLICT",
									payload: { currentVersion: 3 },
								},
							},
							409,
						)
					: reply(
							request,
							{
								error: {
									code: "COMMITTED_RESULT_UNAVAILABLE",
									retryable: true,
									transactionId: "17",
								},
							},
							500,
						);
			}) as typeof fetch,
		});
		const cache = new QueryClient();
		const adapter = createQueryAdapter(
			client.withContext({ companyId: id }),
			cache,
		);
		const options = adapter.queries["tasks.detail"].options({ id });
		const mutation = new MutationObserver(
			cache,
			adapter.mutations["tasks.transition"].options(),
		);
		try {
			await cache.fetchQuery(options);
			const failure = await mutation
				.mutate(variables)
				.catch((error: unknown) => error);
			await Bun.sleep(0);
			expect(failure).toBeInstanceOf(Error);
			if (outcome === "committed-unavailable")
				expect(failure).toMatchObject({
					code: "COMMITTED_RESULT_UNAVAILABLE",
					payload: { transactionId: "17" },
				});
			expect(cache.getQueryState(options.queryKey)?.isInvalidated).toBe(
				outcome === "committed-unavailable",
			);
		} finally {
			mutation.reset();
			await adapter.dispose();
			cache.clear();
		}
	});
}

for (const active of [true, false]) {
	test(`commit cancels an older ${active ? "active" : "inactive"} initial read before invalidating`, async () => {
		const received = Promise.withResolvers<Request>();
		const held = Promise.withResolvers<Response>();
		let reads = 0;
		const client = createClient({
			baseUrl: "https://proof.invalid",
			fetch: (async (request: Request) => {
				if (request.method !== "GET")
					return reply(request, {
						result: { id, title: "Committed", updatedAt },
					});
				if (++reads === 1) {
					received.resolve(request);
					return held.promise;
				}
				return reply(request, { result: null });
			}) as typeof fetch,
		});
		const cache = new QueryClient();
		const adapter = createQueryAdapter(
			client.withContext({ companyId: id }),
			cache,
		);
		const options = adapter.queries["tasks.detail"].options({ id });
		const observer = new QueryObserver(cache, options);
		const stop = active ? observer.subscribe(() => {}) : () => {};
		const initial = cache.fetchQuery(options).catch((error: unknown) => error);
		const mutation = new MutationObserver(
			cache,
			adapter.mutations["tasks.transition"].options(),
		);
		const request = await received.promise;
		try {
			await mutation.mutate(variables);
			await Bun.sleep(0);
			expect(reads).toBe(active ? 2 : 1);
			expect(request.signal.aborted).toBe(true);
			held.resolve(
				reply(request, { result: { id, title: "Obsolete", updatedAt } }),
			);
			await initial;
			await Bun.sleep(0);
			if (active) expect(cache.getQueryData(options.queryKey)).toBeNull();
			else expect(cache.getQueryData(options.queryKey)).toBeUndefined();
			expect(cache.getQueryState(options.queryKey)?.isInvalidated).toBe(
				!active,
			);
		} finally {
			held.resolve(reply(request, { result: null }));
			stop();
			observer.destroy();
			mutation.reset();
			await adapter.dispose();
			await initial;
			cache.clear();
		}
	});
}

test("known commit marks inactive generated results stale without touching another owner", async () => {
	let reads = 0;
	const client = createClient({
		baseUrl: "https://proof.invalid",
		fetch: (async (request: Request) => {
			if (request.method === "GET") {
				reads++;
				return reply(request, { result: null });
			}
			return reply(request, { result: { id, title: "Committed", updatedAt } });
		}) as typeof fetch,
	});
	const cache = new QueryClient();
	const first = createQueryAdapter(
		client.withContext({ companyId: id }),
		cache,
	);
	const other = createQueryAdapter(
		client.withContext({ companyId: id }),
		cache,
	);
	const options = first.queries["tasks.detail"].options({ id });
	const otherOptions = other.queries["tasks.detail"].options({ id });
	const mutation = new MutationObserver(
		cache,
		first.mutations["tasks.transition"].options(),
	);
	try {
		await cache.fetchQuery(options);
		await cache.fetchQuery(otherOptions);
		expect(cache.getQueryState(options.queryKey)?.isInvalidated).toBe(false);
		await mutation.mutate(variables);
		await Bun.sleep(0);
		expect(cache.getQueryState(options.queryKey)?.isInvalidated).toBe(true);
		expect(cache.getQueryState(otherOptions.queryKey)?.isInvalidated).toBe(
			false,
		);
		expect(reads).toBe(2);
	} finally {
		mutation.reset();
		await first.dispose();
		await other.dispose();
		cache.clear();
	}
});
