import { describe, expect, it } from "bun:test";

import { QueryClient } from "@tanstack/react-query";
import {
	RealtimeTopicRejectedError,
	type QuestpieApp,
	type QuestpieClient,
} from "questpie/client";

import {
	createQuestpieQueryOptions,
	type QuestpieQueryOptionsProxy,
} from "./index.js";

async function waitFor(assertion: () => boolean) {
	for (let i = 0; i < 50; i++) {
		if (assertion()) return;
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	throw new Error("Timed out waiting for assertion");
}

describe("realtime query options", () => {
	it("uses the server snapshot without a duplicate REST initial fetch", async () => {
		const initialData = { docs: [{ id: "initial" }], totalDocs: 1 };
		let emitSnapshot: ((data: unknown) => void) | undefined;
		let findCalls = 0;
		let subscribeCalls = 0;
		let streamCalls = 0;

		const client = {
			collections: {
				posts: {
					find: async () => {
						findCalls++;
						return initialData;
					},
				},
			},
			globals: {},
			routes: {},
			realtime: {
				subscribe: () => {
					subscribeCalls++;
					return () => {};
				},
				streamEvents: async function* () {
					streamCalls++;
					const data = await new Promise<unknown>((resolve) => {
						emitSnapshot = resolve;
					});
					yield { type: "snapshot", topicId: "posts", seq: 1, data };
				},
				destroy: () => {},
				topicCount: 0,
				subscriberCount: 0,
			},
		} as unknown as QuestpieClient<QuestpieApp>;

		const queryClient = new QueryClient();
		const abortController = new AbortController();
		const queryOptions = createQuestpieQueryOptions(client);
		// `{ realtime: true }` is part of the public builder type — no cast.
		const query = queryOptions.collections.posts.find(
			{ limit: 10 },
			{ realtime: true },
		);

		const queryPromise = (query.queryFn as any)({
			client: queryClient,
			queryKey: query.queryKey,
			signal: abortController.signal,
		});
		await waitFor(() => typeof emitSnapshot === "function");
		emitSnapshot!(initialData);

		await waitFor(
			() => queryClient.getQueryData(query.queryKey) === initialData,
		);

		expect(findCalls).toBe(0);
		expect(subscribeCalls).toBe(0);
		expect(streamCalls).toBe(1);

		abortController.abort();
		await expect(queryPromise).resolves.toBe(initialData);
	});

	it("types the realtime second argument on find/count/get only", () => {
		const q = {} as QuestpieQueryOptionsProxy;

		// Compile-time contract: find/count/get accept { realtime }.
		const builders = [
			() => q.collections.posts.find({}, { realtime: true }),
			() => q.collections.posts.count({}, { realtime: true }),
			() => q.globals.settings.get({}, { realtime: true }),
		];
		expect(builders.length).toBe(3);

		// findOne has no live form — second argument must be rejected.
		// @ts-expect-error findOne does not accept a realtime config
		const reject = () => q.collections.posts.findOne({}, { realtime: true });
		expect(typeof reject).toBe("function");
	});

	it("applies keyed events and preserves realtime query overrides", async () => {
		const unchanged = { id: "unchanged", title: "Same" };
		const placeholder = {
			docs: [],
			totalDocs: 0,
			limit: 10,
			totalPages: 0,
			page: 1,
			pagingCounter: 1,
			hasPrevPage: false,
			hasNextPage: false,
			prevPage: null,
			nextPage: null,
		};
		const client = {
			collections: { posts: { find: async () => ({ docs: [] }) } },
			globals: {},
			routes: {},
			realtime: {
				subscribe: () => () => {},
				streamEvents: async function* (_topic: unknown, signal?: AbortSignal) {
					yield {
						type: "snapshot",
						topicId: "posts",
						seq: 1,
						data: {
							docs: [unchanged, { id: "removed", title: "Remove" }],
							totalDocs: 2,
						},
					};
					yield {
						type: "update",
						topicId: "posts",
						seq: 2,
						key: "unchanged",
						row: unchanged,
					};
					yield {
						type: "insert",
						topicId: "posts",
						seq: 2,
						key: "inserted",
						row: { id: "inserted", title: "New" },
					};
					yield {
						type: "delete",
						topicId: "posts",
						seq: 2,
						key: "removed",
					};
					yield {
						type: "up-to-date",
						topicId: "posts",
						seq: 2,
						meta: { totalDocs: 2 },
					};
					await new Promise<void>((resolve) =>
						signal?.addEventListener("abort", () => resolve(), { once: true }),
					);
				},
				stream: async function* () {},
				destroy: () => {},
				topicCount: 0,
				subscriberCount: 0,
			},
		} as unknown as QuestpieClient<QuestpieApp>;
		const queryClient = new QueryClient();
		const abortController = new AbortController();
		const options = createQuestpieQueryOptions(client).collections.posts.find(
			{},
			{
				realtime: true,
				placeholderData: placeholder,
				staleTime: 123,
				refetchOnMount: false,
			},
		);

		expect(options.placeholderData).toBe(placeholder);
		expect(options.staleTime).toBe(123);
		expect(options.refetchOnMount).toBe(false);

		const queryPromise = (options.queryFn as any)({
			client: queryClient,
			queryKey: options.queryKey,
			signal: abortController.signal,
		});
		await waitFor(() => {
			const data = queryClient.getQueryData<any>(options.queryKey);
			return data?.docs?.some((row: any) => row.id === "inserted") ?? false;
		});
		const result = queryClient.getQueryData<any>(options.queryKey);
		expect(result.docs[0]).toBe(unchanged);
		expect(result).toMatchObject({
			docs: [unchanged, { id: "inserted", title: "New" }],
			totalDocs: 2,
			totalPages: 1,
		});

		abortController.abort();
		await queryPromise;
	});

	it("uses safe realtime freshness defaults", () => {
		const client = {
			collections: { posts: { find: async () => ({ docs: [] }) } },
			globals: {},
			routes: {},
			realtime: {
				subscribe: () => () => {},
				streamEvents: async function* () {},
				stream: async function* () {},
				destroy: () => {},
				topicCount: 0,
				subscriberCount: 0,
			},
		} as unknown as QuestpieClient<QuestpieApp>;
		const options = createQuestpieQueryOptions(client).collections.posts.find(
			{},
			{ realtime: true },
		);

		expect(options.staleTime).toBe(0);
		expect(options.refetchOnMount).toBe("always");
	});

	it("subscribes live counts with a count topic and consumes the scalar payload", async () => {
		let subscribedTopic: unknown;
		const client = {
			collections: {
				posts: {
					count: async () => 999,
				},
			},
			globals: {},
			routes: {},
			realtime: {
				subscribe: () => () => {},
				streamEvents: async function* (topic: unknown) {
					subscribedTopic = topic;
					yield {
						type: "snapshot",
						topicId: "posts-count",
						seq: 1,
						data: 10_000,
					};
				},
				destroy: () => {},
				topicCount: 0,
				subscriberCount: 0,
			},
		} as unknown as QuestpieClient<QuestpieApp>;
		const queryClient = new QueryClient();
		const abortController = new AbortController();
		const options = createQuestpieQueryOptions(client).collections.posts.count(
			{},
			{ realtime: true },
		);

		const value = await (options.queryFn as any)({
			client: queryClient,
			queryKey: options.queryKey,
			signal: abortController.signal,
		});

		expect(subscribedTopic).toEqual({
			resourceType: "collection",
			resource: "posts",
			operation: "count",
		});
		expect(value).toBe(10_000);
	});

	it("surfaces non-retryable admission failures as query errors after one attempt", async () => {
		let streamCalls = 0;
		const client = {
			collections: {
				posts: { find: async () => ({ docs: [], totalDocs: 0 }) },
			},
			globals: {},
			routes: {},
			realtime: {
				subscribe: () => () => {},
				streamEvents: async function* () {
					streamCalls += 1;
					yield await Promise.reject(
						new RealtimeTopicRejectedError({
							code: "REALTIME_TOPIC_REJECTED",
							message: "Topic limit must be between 1 and 100",
							topicId: "posts-topic",
							resource: "posts",
							operation: "find",
							retryable: false,
							details: {
								reason: "query_limit",
								requestedLimit: 240,
								configuredLimit: 100,
							},
						}),
					);
				},
				destroy: () => {},
				topicCount: 0,
				subscriberCount: 0,
			},
		} as unknown as QuestpieClient<QuestpieApp>;
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: 3, retryDelay: 0 } },
		});
		const options = createQuestpieQueryOptions(client).collections.posts.find(
			{ limit: 240 },
			{ realtime: true },
		);

		await expect(queryClient.fetchQuery(options as any)).rejects.toMatchObject({
			code: "REALTIME_TOPIC_REJECTED",
			retryable: false,
		});
		expect(streamCalls).toBe(1);
		expect(queryClient.getQueryState(options.queryKey)).toMatchObject({
			status: "error",
			fetchStatus: "idle",
		});
	});
});
