import { describe, expect, it } from "bun:test";

import { QueryClient } from "@tanstack/react-query";

import { createQuestpieQueryOptions } from "./index.js";

async function waitFor(assertion: () => boolean) {
	for (let i = 0; i < 50; i++) {
		if (assertion()) return;
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	throw new Error("Timed out waiting for assertion");
}

describe("realtime query options", () => {
	it("uses a normal collection fetch for the initial snapshot", async () => {
		const initialData = { docs: [{ id: "initial" }], totalDocs: 1 };
		let subscribeCallback: ((data: unknown) => void) | undefined;
		let subscribeCalls = 0;
		let streamCalls = 0;

		const client = {
			collections: {
				posts: {
					find: async () => initialData,
				},
			},
			globals: {},
			routes: {},
			realtime: {
				subscribe: (_topic: unknown, callback: (data: unknown) => void) => {
					subscribeCalls++;
					subscribeCallback = callback;
					return () => {};
				},
				stream: async function* () {
					streamCalls++;
					throw new Error("stream should not be used");
				},
				destroy: () => {},
				topicCount: 0,
				subscriberCount: 0,
			},
		} as any;

		const queryClient = new QueryClient();
		const abortController = new AbortController();
		const queryOptions = createQuestpieQueryOptions(client);
		const query = (queryOptions.collections.posts.find as any)(
			{ limit: 10 },
			{ realtime: true },
		);

		const queryPromise = (query.queryFn as any)({
			client: queryClient,
			queryKey: query.queryKey,
			signal: abortController.signal,
		});

		await waitFor(
			() => queryClient.getQueryData(query.queryKey) === initialData,
		);

		expect(subscribeCalls).toBe(1);
		expect(typeof subscribeCallback).toBe("function");
		expect(streamCalls).toBe(0);

		abortController.abort();
		await expect(queryPromise).resolves.toBe(initialData);
	});
});
