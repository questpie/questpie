import { expect, test } from "bun:test";

import { InfiniteQueryObserver, QueryClient } from "@tanstack/query-core";

import { createClient } from "./generated/support-desk/client";
import { createQueryAdapter } from "./generated/support-desk/client.react-query";

const id = "018f5f6e-5f2c-7b41-a854-3d9a6b6b7131";
const timestamp = "2026-09-08T10:00:00.000Z";
function pagePeer() {
	const calls: string[] = [];
	const requests: URL[] = [];
	const client = createClient({
		baseUrl: "https://proof.invalid",
		fetch: (async (request: Request) => {
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
						nodes: [
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
						],
						pageInfo: { endCursor: `cursor-${index}`, hasNextPage: index < 3 },
					},
				}),
				{ headers: { "content-type": "application/json; charset=utf-8" } },
			);
		}) as typeof fetch,
	});
	return { client, calls, requests };
}

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
