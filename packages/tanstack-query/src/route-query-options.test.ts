import { describe, expect, it } from "bun:test";

import {
	QueryClient,
	QueryObserver,
	type UseQueryOptions,
} from "@tanstack/react-query";
import {
	RealtimeTopicRejectedError,
	type QuestpieClient,
} from "questpie/client";
import { route } from "questpie/services";
import { z } from "zod";

import {
	createQuestpieQueryOptions,
	type QuestpieQueryOptionsProxy,
} from "./index.js";

const inputSchema = z.object({ after: z.string().transform(Number) });
const outputSchema = z.object({
	rows: z.array(z.object({ id: z.string(), createdAt: z.date() })),
	removed: z.boolean().optional(),
});
type Projection = z.output<typeof outputSchema>;
const projection = route()
	.post()
	.params<{ roomId: string }>()
	.schema(inputSchema)
	.outputSchema(outputSchema)
	.access(true)
	.query({ live: { data: () => ({ posts: true }) } })
	.handler(() => ({ rows: [] }));
const plain = route()
	.post()
	.schema(inputSchema)
	.handler(({ input }) => input.after);
const oneShot = route()
	.post()
	.schema(inputSchema)
	.outputSchema(z.number())
	.access(true)
	.query()
	.handler(({ input }) => input.after);
const noInput = route()
	.get()
	.schema(z.undefined())
	.handler(() => true);
type App = {
	collections: {};
	routes: {
		projection: typeof projection;
		plain: typeof plain;
		oneShot: typeof oneShot;
		noInput: typeof noInput;
	};
};
type Post = QuestpieClient<App>["routes"]["projection"]["post"];
const input = { after: "42" };
const first: Projection = {
	rows: [{ id: "first", createdAt: new Date("2026-10-22T00:00:00Z") }],
	removed: true,
};
const second: Projection = { rows: [] };

function deferred<T = void>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

async function waitFor(assertion: () => boolean) {
	for (let i = 0; i < 100; i++) {
		if (assertion()) return;
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	throw new Error("Timed out waiting for route query");
}

function setup(watch: Post["watch"], locale?: string) {
	const calls: Parameters<Post>[] = [];
	let currentLocale = locale;
	const client = {
		collections: {},
		routes: {
			projection: {
				post: Object.assign(
					async (...args: Parameters<Post>) => {
						calls.push(args);
						return first;
					},
					{ watch },
				),
			},
		},
		getLocale: () => currentLocale,
	} as unknown as QuestpieClient<App>;
	return {
		client,
		calls,
		setLocale: (value: string) => {
			currentLocale = value;
		},
	};
}

const fetch = (client: QueryClient, options: UseQueryOptions<Projection>) =>
	client.fetchQuery({ ...options, initialData: undefined });

function rejection(reason: "access" | "query_limit") {
	return new RealtimeTopicRejectedError({
		code: "REALTIME_TOPIC_REJECTED",
		message: "Projection rejected",
		topicId: "projection-topic",
		resource: "projection",
		operation: "query",
		retryable: false,
		details: { reason },
	});
}

describe("route query options", () => {
	it("shares HTTP/LIVE identity and replaces snapshots without a duplicate HTTP read", async () => {
		const next = deferred();
		const seen: Parameters<Post["watch"]>[] = [];
		const { client, calls } = setup(async function* (...args) {
			seen.push(args);
			yield first;
			await next.promise;
			yield second;
		});
		const queryClient = new QueryClient();
		const q = createQuestpieQueryOptions(client, { locale: "sk" });
		const callOptions = { params: { roomId: "room-1" } };
		const ordinary = q.routes.projection.post.query(input, callOptions);
		const live = q.routes.projection.post.query(input, {
			...callOptions,
			realtime: true,
			staleTime: 123,
			refetchOnMount: false,
		});
		expect(live.queryKey).toEqual(ordinary.queryKey);
		expect(live.queryKey).toEqual(
			q.routes.projection.post.key(input, callOptions),
		);
		expect(live.staleTime).toBe(123);
		expect(live.refetchOnMount).toBe(false);
		const pending = fetch(queryClient, live);
		await waitFor(() => queryClient.getQueryData(live.queryKey) !== undefined);
		const cached = queryClient.getQueryData<Projection>(live.queryKey)!;
		expect(cached.rows[0]!.createdAt).toBe(first.rows[0]!.createdAt);
		expect(cached.rows[0]!.createdAt).toBeInstanceOf(Date);
		expect(seen[0]![0]).toBe(input);
		expect(seen[0]![1]).toMatchObject({ ...callOptions, locale: "sk" });
		expect(seen[0]![1]!.signal).toBeInstanceOf(AbortSignal);
		expect(calls).toHaveLength(0);
		next.resolve();
		await expect(pending).resolves.toEqual(second);
		expect(queryClient.getQueryData(live.queryKey)).toEqual(second);
		expect(queryClient.getQueryData(live.queryKey)).not.toHaveProperty(
			"removed",
		);
		queryClient.clear();
	});

	it("forwards HTTP options and keys the effective locale and params only", async () => {
		const { client, calls, setLocale } = setup(async function* () {
			yield first;
		}, "en");
		const queryClient = new QueryClient();
		const q = createQuestpieQueryOptions(client);
		const signal = new AbortController().signal;
		const options = { params: { roomId: "one" }, locale: "fr", signal };
		await fetch(queryClient, q.routes.projection.post.query(input, options));
		expect(calls[0]![0]).toBe(input);
		expect(calls[0]![1]).toMatchObject({
			params: options.params,
			locale: "fr",
		});
		expect(calls[0]![1]!.signal).toBeInstanceOf(AbortSignal);
		expect(q.routes.projection.post.query(input, options).queryKey).toEqual(
			q.routes.projection.post.query(input, {
				...options,
				realtime: true,
				signal: new AbortController().signal,
			}).queryKey,
		);
		expect(q.routes.projection.post.query(input).queryKey).toEqual([
			"questpie",
			"routes",
			"projection",
			"post",
			"query",
			"en",
			input,
		]);
		expect(
			q.routes.projection.post.query(input, {
				params: { roomId: "two" },
				locale: "fr",
			}).queryKey,
		).not.toEqual(q.routes.projection.post.query(input, options).queryKey);
		setLocale("de");
		await fetch(queryClient, q.routes.projection.post.query(input));
		expect(calls[1]![1]!.locale).toBe("de");
		const configured = createQuestpieQueryOptions(client, { locale: "sk" });
		await fetch(queryClient, configured.routes.projection.post.query(input));
		expect(calls[2]![1]!.locale).toBe("sk");
		queryClient.clear();
	});

	it("clears only the denied query before throwing and never retries terminal rejection", async () => {
		const deny = deferred();
		const error = rejection("access");
		let attempts = 0;
		const { client } = setup(async function* () {
			attempts++;
			yield first;
			await deny.promise;
			throw error;
		});
		const queryClient = new QueryClient();
		let clearedBeforeMapping = false;
		const q = createQuestpieQueryOptions(client, {
			errorMap: (cause) => {
				clearedBeforeMapping =
					queryClient.getQueryData(live.queryKey) === undefined;
				return new Error(String(cause));
			},
		});
		const live = q.routes.projection.post.query(input, {
			realtime: true,
			retry: true,
			retryDelay: 0,
		});
		const sibling = q.routes.projection.post.query({ after: "43" });
		queryClient.setQueryData(live.queryKey, first);
		queryClient.setQueryData(sibling.queryKey, second);
		const pending = fetch(queryClient, live);
		const rejected = pending.catch((cause: unknown) => cause);
		await waitFor(() => attempts === 1);
		deny.resolve();
		await expect(rejected).resolves.toMatchObject({
			message: expect.stringContaining("Projection rejected"),
		});
		expect(clearedBeforeMapping).toBe(true);
		expect(queryClient.getQueryData(live.queryKey)).toBeUndefined();
		expect(queryClient.getQueryState(live.queryKey)?.status).toBe("error");
		expect(queryClient.getQueryData(sibling.queryKey)).toEqual(second);
		expect(attempts).toBe(1);
		queryClient.clear();
	});

	it.each([new Error("Transient disconnect"), rejection("query_limit")])(
		"retains cached data for failures other than access denial: %s",
		async (error) => {
			const { client } = setup(async function* () {
				yield await Promise.reject(error);
			});
			const queryClient = new QueryClient();
			const options = createQuestpieQueryOptions(
				client,
			).routes.projection.post.query(input, { realtime: true, retry: false });
			queryClient.setQueryData(options.queryKey, first);
			await expect(fetch(queryClient, options)).rejects.toBe(error);
			expect(queryClient.getQueryData(options.queryKey)).toEqual(first);
			queryClient.clear();
		},
	);

	it("unsubscribes on unmount and prevents aborted work from republishing protected data", async () => {
		const release = deferred();
		let receivedSignal: AbortSignal | undefined;
		let returned = false;
		let attempts = 0;
		const { client } = setup(async function* (_input, options) {
			if (++attempts > 1) throw rejection("access");
			receivedSignal = options?.signal;
			try {
				yield first;
				await release.promise;
				yield first;
			} finally {
				returned = true;
			}
		});
		const queryClient = new QueryClient();
		const options = createQuestpieQueryOptions(
			client,
		).routes.projection.post.query(input, { realtime: true });
		const observer = new QueryObserver(queryClient, options);
		const unsubscribe = observer.subscribe(() => {});
		await waitFor(
			() => queryClient.getQueryData(options.queryKey) !== undefined,
		);
		unsubscribe();
		expect(receivedSignal?.aborted).toBe(true);
		await expect(fetch(queryClient, options)).rejects.toThrow(
			"Projection rejected",
		);
		expect(queryClient.getQueryData(options.queryKey)).toBeUndefined();
		release.resolve();
		await waitFor(() => returned);
		expect(queryClient.getQueryData(options.queryKey)).toBeUndefined();
		queryClient.clear();
	});

	it("preserves typed wire input, output, params and explicit LIVE capability", () => {
		const contracts = (q: QuestpieQueryOptionsProxy<App>) => {
			const live: UseQueryOptions<Projection> = q.routes.projection.post.query(
				input,
				{ realtime: true, params: { roomId: "one" } },
			);
			const plain = q.routes.plain.post.query(input, { locale: "en" });
			q.routes.noInput.get.query();
			// @ts-expect-error ordinary routes do not declare LIVE
			q.routes.plain.post.query(input, { realtime: true });
			// @ts-expect-error query semantics alone do not declare LIVE
			q.routes.oneShot.post.query(input, { realtime: true });
			// @ts-expect-error client input is the wire string, not the transformed number
			q.routes.projection.post.query({ after: 42 }, { realtime: true });
			// @ts-expect-error typed path parameters must retain roomId
			q.routes.projection.post.query(input, { params: { other: "one" } });
			return { live, plain };
		};
		expect(typeof contracts).toBe("function");
	});
});
