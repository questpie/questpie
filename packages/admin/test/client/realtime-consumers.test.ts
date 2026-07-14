import { describe, expect, test } from "bun:test";

import { QueryClient } from "@tanstack/react-query";
import type { QuestpieApp, QuestpieClient } from "questpie/client";

import { createQuestpieQueryOptions } from "@questpie/tanstack-query";

import { subscribeAdminCollectionRealtime } from "../../src/client/hooks/realtime-subscription.js";

async function runQuery(options: {
	queryFn?: unknown;
	queryKey: readonly unknown[];
}) {
	const controller = new AbortController();
	return (options.queryFn as (input: unknown) => Promise<unknown>)({
		client: new QueryClient(),
		queryKey: options.queryKey,
		signal: controller.signal,
	});
}

describe("admin realtime consumer regression", () => {
	test("list, table, dashboard, locks, and globals consume SSE snapshots", async () => {
		const topics: unknown[] = [];
		let restCalls = 0;
		const snapshots = new Map([
			["collection:posts:find", { docs: [{ id: "post-1" }], totalDocs: 1 }],
			["collection:posts:count", 1],
			[
				"collection:admin_locks:find",
				{ docs: [{ id: "lock-1", resourceId: "post-1" }], totalDocs: 1 },
			],
			["global:siteSettings:get", { title: "Realtime" }],
		]);
		const client = {
			collections: new Proxy(
				{},
				{
					get: () => ({
						find: async () => {
							restCalls += 1;
						},
						count: async () => {
							restCalls += 1;
						},
					}),
				},
			),
			globals: new Proxy(
				{},
				{
					get: () => ({
						get: async () => {
							restCalls += 1;
						},
					}),
				},
			),
			routes: {},
			realtime: {
				subscribe: () => () => {},
				stream: async function* (topic: {
					resourceType: "collection" | "global";
					resource: string;
					operation?: "find" | "count" | "get";
				}) {
					topics.push(topic);
					const operation =
						topic.operation ??
						(topic.resourceType === "global" ? "get" : "find");
					yield snapshots.get(
						`${topic.resourceType}:${topic.resource}:${operation}`,
					);
				},
				destroy: () => {},
				topicCount: 0,
				subscriberCount: 0,
			},
		} as unknown as QuestpieClient<QuestpieApp>;
		const queries = createQuestpieQueryOptions(client);

		const list = await runQuery(
			queries.collections.posts.find({}, { realtime: true }),
		);
		const dashboardCount = await runQuery(
			queries.collections.posts.count({}, { realtime: true }),
		);
		const locks = await runQuery(
			queries.collections.admin_locks.find({}, { realtime: true }),
		);
		const global = await runQuery(
			queries.globals.siteSettings.get({}, { realtime: true }),
		);

		expect(list).toEqual({ docs: [{ id: "post-1" }], totalDocs: 1 });
		expect(dashboardCount).toBe(1);
		expect(locks).toEqual({
			docs: [{ id: "lock-1", resourceId: "post-1" }],
			totalDocs: 1,
		});
		expect(global).toEqual({ title: "Realtime" });
		expect(restCalls).toBe(0);
		expect(topics).toEqual([
			{ resourceType: "collection", resource: "posts", operation: "find" },
			{ resourceType: "collection", resource: "posts", operation: "count" },
			{
				resourceType: "collection",
				resource: "admin_locks",
				operation: "find",
			},
			{ resourceType: "global", resource: "siteSettings", operation: "get" },
		]);
	});

	test("direct invalidation treats one bulk event as one cache wake", () => {
		let listener: (() => void) | undefined;
		let unsubscribed = 0;
		let invalidations = 0;
		const unsubscribe = subscribeAdminCollectionRealtime({
			client: {
				realtime: {
					subscribe: (_topic: unknown, callback: () => void) => {
						listener = callback;
						return () => {
							unsubscribed += 1;
						};
					},
				},
			},
			collection: "posts",
			topic: { resourceType: "collection", resource: "posts" },
			enabled: true,
			onChange: () => {
				invalidations += 1;
			},
		});

		listener?.();
		expect(invalidations).toBe(1);
		unsubscribe?.();
		expect(unsubscribed).toBe(1);
	});
});
