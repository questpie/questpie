import { expect, test } from "bun:test";

import {
	dehydrate,
	hydrate,
	InfiniteQueryObserver,
	MutationObserver,
	QueryClient,
} from "@tanstack/query-core";

import { createClient } from "./generated/support-desk/client";
import { createQueryAdapter } from "./generated/support-desk/client.react-query";

const id = "018f5f6e-5f2c-7b41-a854-3d9a6b6b7131";
const timestamp = "2026-09-08T10:00:00.000Z";
function pagePeer() {
	const calls: string[] = [];
	const requests: URL[] = [];
	let visible = true;
	const client = createClient({
		baseUrl: "https://proof.invalid",
		fetch: (async (request: Request) => {
			if (request.method === "POST") {
				visible = false;
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
			}
			const url = new URL(request.url);
			requests.push(url);
			calls.push(url.searchParams.get("after")!);
			const index =
				["~null", "cursor-1", "cursor-2"].indexOf(
					url.searchParams.get("after")!,
				) + 1;
			if (index === 0) throw new Error("Unexpected continuation requested");
			return new Response(
				JSON.stringify({
					callId: request.headers.get("Questpie-Call-Id"),
					result: {
						nodes: visible
							? [
									{
										id,
										organizationId: id,
										teamId: id,
										requesterMembershipId: id,
										assigneeMembershipId: null,
										assignee: null,
										team: null,
										priority: "normal",
										reference: `T-${index}`,
										status: "open",
										summary: `Ticket ${index}`,
										updatedAt: timestamp,
									},
								]
							: [],
						pageInfo: { endCursor: `cursor-${index}`, hasNextPage: index < 3 },
					},
				}),
				{ headers: { "content-type": "application/json; charset=utf-8" } },
			);
		}) as typeof fetch,
	});
	return {
		client,
		calls,
		requests,
		removeRows() {
			visible = false;
		},
	};
}

test("a compiled watchable family's infinite mode refreshes after commit without invalidating its ordinary live mode", async () => {
	const peer = pagePeer();
	const cache = new QueryClient();
	const adapter = createQueryAdapter(
		peer.client.withContext({ membershipId: id, organizationId: id }),
		cache,
	);
	const input = { first: 1, statuses: null, teamIds: null };
	const options = {
		...adapter.queries["tickets.queue"].infiniteOptions(input),
		staleTime: 60_000,
	};
	const ordinary = adapter.queries["tickets.queue"].options({
		...input,
		after: null,
	});
	const first = await cache.fetchInfiniteQuery(options);
	cache.setQueryData(ordinary.queryKey, () => first.pages[0]!);
	const observer = new InfiniteQueryObserver(cache, options);
	const refreshed = Promise.withResolvers<void>();
	const stop = observer.subscribe((result) => {
		if (result.data?.pages[0]?.nodes.length === 0) refreshed.resolve();
	});
	const mutation = new MutationObserver(
		cache,
		adapter.mutations["ticket.reopen"].options(),
	);
	try {
		await expect(mutation.mutate({ ticketId: id })).rejects.toMatchObject({
			code: "COMMITTED_RESULT_UNAVAILABLE",
		});
		await refreshed.promise;
		expect(peer.calls).toEqual(["~null", "~null"]);
		expect(observer.getCurrentResult().data?.pages[0]?.nodes).toEqual([]);
		expect(cache.getQueryState(ordinary.queryKey)?.isInvalidated).toBe(false);
	} finally {
		stop();
		observer.destroy();
		mutation.reset();
		await adapter.dispose();
		cache.clear();
	}
});

test("infinite browser reads wait for native hydration before replacing old pages", async () => {
	const ready = Promise.withResolvers<void>();
	const peer = pagePeer();
	const serverCache = new QueryClient();
	const browserCache = new QueryClient();
	const context = { membershipId: id, organizationId: id };
	const server = createQueryAdapter(
		peer.client.withContext(context),
		serverCache,
		{ ssr: true },
	);
	const browser = createQueryAdapter(
		peer.client.withContext(context),
		browserCache,
		{
			hydrate: server.dehydrate(),
			ready: ready.promise,
		},
	);
	try {
		const input = { first: 1, statuses: null, teamIds: null };
		const serverOptions =
			server.queries["tickets.queue"].infiniteOptions(input);
		await serverCache.fetchInfiniteQuery(serverOptions);
		serverCache.setQueryData(serverOptions.queryKey, (value) => value, {
			updatedAt: Date.now() + 60_000,
		});
		peer.removeRows();
		const options = browser.queries["tickets.queue"].infiniteOptions(input);
		const completion = browserCache.fetchInfiniteQuery(options);
		await Bun.sleep(0);
		expect(peer.calls).toEqual(["~null"]);
		hydrate(browserCache, dehydrate(serverCache));
		expect(
			browserCache.getQueryData(options.queryKey)?.pages[0]?.nodes,
		).toHaveLength(1);
		ready.resolve();
		expect((await completion).pages[0]?.nodes).toEqual([]);
		expect(
			browserCache.getQueryData(options.queryKey)?.pages[0]?.nodes,
		).toEqual([]);
		expect(peer.calls).toEqual(["~null", "~null"]);
	} finally {
		ready.resolve();
		await browser.dispose();
		await server.dispose();
		browserCache.clear();
		serverCache.clear();
	}
});

test("retiring an infinite Query during hydration readiness prevents late page dispatch", async () => {
	const ready = Promise.withResolvers<void>();
	const peer = pagePeer();
	const cache = new QueryClient();
	const adapter = createQueryAdapter(
		peer.client.withContext({ membershipId: id, organizationId: id }),
		cache,
		{ ready: ready.promise },
	);
	try {
		const completion = cache
			.fetchInfiniteQuery(
				adapter.queries["tickets.queue"].infiniteOptions({
					first: 1,
					statuses: null,
					teamIds: null,
				}),
			)
			.catch((error: unknown) => error);
		await Bun.sleep(0);
		await adapter.dispose();
		ready.resolve();
		expect(await completion).toBeInstanceOf(Error);
		await Bun.sleep(0);
		expect(peer.calls).toEqual([]);
		expect(cache.getQueryCache().getAll()).toHaveLength(0);
	} finally {
		ready.resolve();
		await adapter.dispose();
		cache.clear();
	}
});

test("infinite input is captured once and caller-owned cursor overrides fail before transport", async () => {
	const { client, calls, requests } = pagePeer();
	const cache = new QueryClient();
	const adapter = createQueryAdapter(
		client.withContext({ membershipId: id, organizationId: id }),
		cache,
	);
	try {
		const input = { first: 1, statuses: ["open"], teamIds: null };
		const options = adapter.queries["tickets.queue"].infiniteOptions(input);
		input.statuses[0] = "closed";
		input.first = 2;
		await cache.fetchInfiniteQuery(options);
		expect(requests[0]?.searchParams.get("first")).toBe("1");
		expect(requests[0]?.searchParams.getAll("statuses")).toEqual([
			'~json:["open"]',
		]);
		// JavaScript consumers cannot smuggle a second initial-cursor owner.
		expect(() =>
			adapter.queries["tickets.queue"].infiniteOptions({
				...input,
				after: "cursor-2",
			} as typeof input),
		).toThrow();
		expect(calls).toEqual(["~null"]);
	} finally {
		await adapter.dispose();
		cache.clear();
	}
});

test("compiled ticket queue traverses three native pages and stops on a nonempty terminal page", async () => {
	const { client, calls } = pagePeer();
	const cache = new QueryClient();
	const adapter = createQueryAdapter(
		client.withContext({ membershipId: id, organizationId: id }),
		cache,
	);
	try {
		const options = adapter.queries["tickets.queue"].infiniteOptions({
			first: 1,
			statuses: null,
			teamIds: null,
		});
		const observer = new InfiniteQueryObserver(cache, options);
		await observer.fetchNextPage();
		await observer.fetchNextPage();
		await observer.fetchNextPage();
		expect(
			observer
				.getCurrentResult()
				.data?.pages.map((page) => page.nodes[0]?.reference),
		).toEqual(["T-1", "T-2", "T-3"]);
		expect(observer.getCurrentResult().data?.pageParams).toEqual([
			null,
			"cursor-1",
			"cursor-2",
		]);
		expect(
			observer.getCurrentResult().data?.pages[0]?.nodes[0]?.updatedAt,
		).toBeInstanceOf(Date);
		expect(observer.getCurrentResult().hasNextPage).toBe(false);
		await observer.fetchNextPage();
		expect(calls).toEqual(["~null", "cursor-1", "cursor-2"]);
	} finally {
		await adapter.dispose();
		cache.clear();
	}
});

test("native maxPages refetches from its retained anchor without aliasing ordinary Query data", async () => {
	const { client, calls } = pagePeer();
	const cache = new QueryClient();
	const adapter = createQueryAdapter(
		client.withContext({ membershipId: id, organizationId: id }),
		cache,
	);
	try {
		const input = { first: 1, statuses: null, teamIds: null };
		const options = adapter.queries["tickets.queue"].infiniteOptions(input);
		const ordinary = adapter.queries["tickets.queue"].options({
			...input,
			after: null,
		});
		expect(options.queryKey).not.toEqual(ordinary.queryKey);
		expect(
			adapter.queries["tickets.queue"].infiniteOptions({ ...input }).queryKey,
		).toEqual(options.queryKey);
		const observer = new InfiniteQueryObserver(cache, {
			...options,
			maxPages: 2,
		});
		await observer.fetchNextPage();
		await observer.fetchNextPage();
		await observer.fetchNextPage();
		expect(observer.getCurrentResult().data?.pageParams).toEqual([
			"cursor-1",
			"cursor-2",
		]);
		await observer.refetch();
		expect(calls).toEqual([
			"~null",
			"cursor-1",
			"cursor-2",
			"cursor-1",
			"cursor-2",
		]);
		expect(
			observer
				.getCurrentResult()
				.data?.pages.map((page) => page.nodes[0]?.reference),
		).toEqual(["T-2", "T-3"]);
		expect(cache.getQueryData(ordinary.queryKey)).toBeUndefined();
	} finally {
		await adapter.dispose();
		cache.clear();
	}
});

test("retired infinite options clear retained data and cannot open another page request", async () => {
	const { client, calls } = pagePeer();
	const cache = new QueryClient();
	const adapter = createQueryAdapter(
		client.withContext({ membershipId: id, organizationId: id }),
		cache,
	);
	const options = adapter.queries["tickets.queue"].infiniteOptions({
		first: 1,
		statuses: null,
		teamIds: null,
	});
	const observer = new InfiniteQueryObserver(cache, {
		...options,
		enabled: false,
	});
	const unsubscribe = observer.subscribe(() => {});
	try {
		await observer.fetchNextPage();
		expect(observer.getCurrentResult().data?.pages).toHaveLength(1);
		await adapter.dispose();
		expect(observer.getCurrentResult().data).toBeUndefined();
		expect(cache.getQueryData(options.queryKey)).toBeUndefined();
		await expect(cache.fetchInfiniteQuery(options)).rejects.toThrow(
			"SCOPE_RETIRED",
		);
		expect(calls).toEqual(["~null"]);
		expect(() =>
			adapter.queries["tickets.queue"].infiniteOptions({
				first: 1,
				statuses: null,
				teamIds: null,
			}),
		).toThrow("SCOPE_RETIRED");
	} finally {
		unsubscribe();
		observer.destroy();
		await adapter.dispose();
		cache.clear();
	}
});
