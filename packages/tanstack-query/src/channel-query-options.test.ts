import { describe, expect, test } from "bun:test";

import { QueryClient, type UseQueryOptions } from "@tanstack/react-query";
import { channel } from "questpie/channels";
import type { QuestpieClient } from "questpie/client";
import { z } from "zod";

import { createQuestpieQueryOptions } from "./index.js";

const news = channel("news").events({
	updated: z.object({ title: z.string() }),
});
const room = channel("room-[roomId]")
	.events({ message: z.object({ text: z.string() }) })
	.authorize({ subscribe: true })
	.presence(({ params }) => ({ id: "member", roomId: params.roomId }));

type App = {
	collections: {};
	channels: { news: typeof news; room: typeof room };
	globals: {};
	routes: {};
};

describe("channel query options", () => {
	test("accumulates typed channel messages through streamedQuery", async () => {
		let receivedSignal: AbortSignal | undefined;
		const client = {
			collections: {},
			channels: {
				news: {
					iter: async function* (options?: { signal?: AbortSignal }) {
						receivedSignal = options?.signal;
						yield {
							event: "updated" as const,
							eventId: "one",
							data: { title: "One" },
						};
						yield {
							event: "updated" as const,
							eventId: "two",
							data: { title: "Two" },
						};
					},
				},
			},
			globals: {},
			routes: {},
		} as unknown as QuestpieClient<App>;
		const queryClient = new QueryClient();
		const abortController = new AbortController();
		const options =
			createQuestpieQueryOptions(client).channels.news.subscription();
		const value = await (options.queryFn as any)({
			client: queryClient,
			queryKey: options.queryKey,
			signal: abortController.signal,
		});

		expect(receivedSignal).toBe(abortController.signal);
		expect(value).toEqual([
			{ event: "updated", eventId: "one", data: { title: "One" } },
			{ event: "updated", eventId: "two", data: { title: "Two" } },
		]);
	});

	test("preserves generated channel params in the option factory", () => {
		expect(typeof declareClientTypes).toBe("function");
	});

	test("keeps only the latest presence roster snapshot", async () => {
		let receivedSignal: AbortSignal | undefined;
		const client = {
			collections: {},
			channels: {
				room: {
					presenceIter: async function* (
						_params: { roomId: string },
						options?: { signal?: AbortSignal },
					) {
						receivedSignal = options?.signal;
						yield [{ id: "one", roomId: "one" }];
						yield [{ id: "two", roomId: "one" }];
					},
				},
			},
			globals: {},
			routes: {},
		} as unknown as QuestpieClient<App>;
		const queryClient = new QueryClient();
		const abortController = new AbortController();
		const options = createQuestpieQueryOptions(client).channels.room.presence({
			roomId: "one",
		});
		const value = await (options.queryFn as any)({
			client: queryClient,
			queryKey: options.queryKey,
			signal: abortController.signal,
		});

		expect(receivedSignal).toBe(abortController.signal);
		expect(value).toEqual([{ id: "two", roomId: "one" }]);
	});
});

function declareClientTypes(client: QuestpieClient<App>): void {
	const q = createQuestpieQueryOptions(client);
	q.channels.news.subscription();
	q.channels.room.subscription({ roomId: "one" });
	const presence = q.channels.room.presence({ roomId: "one" });
	type _presenceData =
		typeof presence extends UseQueryOptions<infer TData> ? TData : never;
	const presenceTypeCheck: _presenceData = [{ id: "member", roomId: "one" }];
	void presenceTypeCheck;
	// @ts-expect-error parametric channel requires params
	q.channels.room.subscription();
	// @ts-expect-error unknown channel key
	q.channels.missing.subscription();
	// @ts-expect-error non-presence channel has no presence option
	q.channels.news.presence();
}
