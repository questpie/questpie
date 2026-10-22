import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { QueryCache, QueryClient, QueryObserver } from "@tanstack/react-query";
import { ApiError, collection, route } from "questpie";
import { createClient } from "questpie/client";
import { z } from "zod";

import { createFetchHandler } from "../../questpie/src/server/adapters/http.js";
import { buildMockApp } from "../../questpie/test/utils/mocks/mock-app-builder.js";
import { runTestDbMigrations } from "../../questpie/test/utils/test-db.js";
import { createQuestpieQueryOptions } from "../src/index.js";

async function waitFor(check: () => boolean) {
	const deadline = Date.now() + 3000;
	while (!check()) {
		if (Date.now() > deadline) throw new Error("Route recovery timed out");
		await Bun.sleep(5);
	}
}

describe("route LIVE error recovery over real SSE", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	let handle: ReturnType<typeof createFetchHandler>;
	const failures = new Map<string, Error>();
	const attempts = new Map<string, number>();
	const items = collection("recovery_items")
		.fields(({ f }) => ({
			key: f.text().required(),
			title: f.text().required(),
		}))
		.access({ read: true, create: true, update: true });
	const grants = collection("recovery_grants")
		.fields(({ f }) => ({ key: f.text().required(), allowed: f.boolean() }))
		.access({ read: true, create: true, update: true });
	const projection = (maxAgeMs: number) =>
		route()
			.post()
			.schema(z.object({ key: z.string() }))
			.outputSchema(z.object({ titles: z.array(z.string()) }))
			.access(true)
			.query({
				live: {
					data: ({ key }) => ({ recovery_items: { key } }),
					authority: ({ key }) => ({ recovery_grants: { key } }),
					maxAgeMs,
				},
			})
			.handler(async ({ input, collections }) => {
				attempts.set(input.key, (attempts.get(input.key) ?? 0) + 1);
				const failure = failures.get(input.key);
				if (failure) {
					failures.delete(input.key);
					throw failure;
				}
				const grant = await collections.recovery_grants.findOne({
					where: { key: input.key },
				});
				if (!grant?.allowed) throw ApiError.notFound("Protected report");
				const rows = await collections.recovery_items.find({
					where: { key: input.key },
				});
				return { titles: rows.docs.map((row: { title: string }) => row.title) };
			});
	const routes = { projection: projection(60_000), aged: projection(1000) };
	type App = { collections: {}; routes: typeof routes };

	beforeAll(async () => {
		setup = await buildMockApp(
			{
				collections: { recovery_items: items, recovery_grants: grants },
				routes: {
					"projection:POST": routes.projection,
					"aged:POST": routes.aged,
				},
			},
			{ realtime: { pollIntervalMs: 10, retentionDays: 0 } },
		);
		await runTestDbMigrations(setup.app);
		handle = createFetchHandler(setup.app, {
			basePath: "/api",
			getSession: async () => ({
				user: { id: "ada" },
				session: { id: "ada-session" },
			}),
		});
	}, 60_000);
	afterAll(async () => setup?.cleanup());

	async function fixture(key: string, aged = false) {
		const grant = await setup.app.collections.recovery_grants.create({
			key,
			allowed: true,
		});
		await setup.app.collections.recovery_items.create({
			key,
			title: "protected",
		});
		let openings = 0;
		const client = createClient<App>({
			baseURL: "http://localhost",
			basePath: "/api",
			fetch: async (url, init) => {
				if (String(url).endsWith("/realtime") && init?.body) {
					const payload = JSON.parse(String(init.body));
					if (!payload.sessionId) openings++;
				}
				return handle(new Request(String(url), init));
			},
		});
		const errors: unknown[] = [];
		const queryClient = new QueryClient({
			queryCache: new QueryCache({ onError: (error) => errors.push(error) }),
		});
		const q = createQuestpieQueryOptions(client);
		const node = aged ? q.routes.aged : q.routes.projection;
		const options = node.post.query({ key }, { realtime: true, retry: true });
		const observer = new QueryObserver(queryClient, options);
		let subscribed = true;
		const unsubscribe = observer.subscribe(() => {});
		await waitFor(
			() => queryClient.getQueryData(options.queryKey) !== undefined,
		);
		return {
			client,
			queryClient,
			q,
			options,
			errors,
			get openings() {
				return openings;
			},
			wake: (allowed = true) =>
				setup.app.collections.recovery_grants.updateById({
					id: grant.id,
					data: { allowed },
				}),
			unsubscribe: () => {
				if (subscribed) unsubscribe();
				subscribed = false;
			},
			close: () => {
				if (subscribed) unsubscribe();
				client.realtime.destroy();
				queryClient.clear();
			},
		};
	}

	it.each(["notFound", "forbidden", "unauthorized"] as const)(
		"normalizes %s after an authority wake, clears only that cache, and preserves sibling delivery",
		async (kind) => {
			const key = `denied-${kind}`;
			const f = await fixture(key);
			const sibling = f.q.routes.projection.post.query(
				{ key: `${key}-sibling` },
				{ realtime: true },
			);
			await setup.app.collections.recovery_grants.create({
				key: `${key}-sibling`,
				allowed: true,
			});
			const observer = new QueryObserver(f.queryClient, sibling);
			const stop = observer.subscribe(() => {});
			try {
				await waitFor(
					() => f.queryClient.getQueryData(sibling.queryKey) !== undefined,
				);
				const before = attempts.get(key)!;
				if (kind !== "notFound")
					failures.set(
						key,
						kind === "forbidden"
							? ApiError.forbidden({ reason: "Access denied" })
							: ApiError.unauthorized(),
					);
				await f.wake(false);
				await waitFor(() => f.errors.length === 1);
				expect(f.errors[0]).toMatchObject({
					code: "REALTIME_TOPIC_REJECTED",
					retryable: false,
					message: "Route query access denied",
					details: { reason: "access" },
				});
				expect(f.queryClient.getQueryData(f.options.queryKey)).toBeUndefined();
				await setup.app.collections.recovery_items.create({
					key: `${key}-sibling`,
					title: "healthy",
				});
				await waitFor(() =>
					JSON.stringify(f.queryClient.getQueryData(sibling.queryKey)).includes(
						"healthy",
					),
				);
				expect(attempts.get(key)).toBe(before + 1);
				expect(f.openings).toBe(1);
			} finally {
				stop();
				f.close();
			}
		},
	);

	it.each([false, true])(
		"recovers a transient authority refresh failure on the next %s age wake without replacing the watch",
		async (aged) => {
			const key = `transient-${aged}`;
			const f = await fixture(key, aged);
			await setup.app.collections.recovery_grants.create({
				key: `${key}-sibling`,
				allowed: true,
			});
			const sibling = f.q.routes.projection.post.query(
				{ key: `${key}-sibling` },
				{ realtime: true },
			);
			const stop = new QueryObserver(f.queryClient, sibling).subscribe(
				() => {},
			);
			try {
				await waitFor(
					() => f.queryClient.getQueryData(sibling.queryKey) !== undefined,
				);
				failures.set(key, new Error("database timeout with private details"));
				await f.wake();
				await waitFor(
					() => f.queryClient.getQueryData(f.options.queryKey) === undefined,
				);
				expect(f.errors).toEqual([]);
				expect(
					f.queryClient.getQueryState(f.options.queryKey)?.fetchStatus,
				).toBe("fetching");
				expect(
					f.queryClient.getQueryState(f.options.queryKey)?.fetchFailureCount,
				).toBe(0);
				const before = attempts.get(key);
				if (!aged) {
					await Bun.sleep(40);
					expect(attempts.get(key)).toBe(before);
					await setup.app.collections.recovery_items.create({
						key,
						title: "recovered",
					});
				}
				await waitFor(
					() => f.queryClient.getQueryData(f.options.queryKey) !== undefined,
				);
				await setup.app.collections.recovery_items.create({
					key: `${key}-sibling`,
					title: "healthy",
				});
				await waitFor(() =>
					JSON.stringify(f.queryClient.getQueryData(sibling.queryKey)).includes(
						"healthy",
					),
				);
				expect(f.queryClient.getQueryData(f.options.queryKey)).toEqual({
					titles: aged ? ["protected"] : ["protected", "recovered"],
				});
				expect(f.errors).toEqual([]);
				expect(f.openings).toBe(1);
				expect(f.client.realtime.topicCount).toBe(2);
			} finally {
				stop();
				f.close();
			}
		},
	);

	it("recovers an initial compute failure on maximum age without a terminal client error", async () => {
		const key = "initial-unavailable";
		failures.set(key, new Error("initial database timeout"));
		const f = await fixture(key, true);
		try {
			expect(f.errors).toEqual([]);
			expect(f.openings).toBe(1);
			expect(attempts.get(key)).toBe(2);
			expect(f.queryClient.getQueryData(f.options.queryKey)).toEqual({
				titles: ["protected"],
			});
		} finally {
			f.close();
		}
	});

	it("does not restore the protected snapshot when cancelled while authority is unavailable", async () => {
		const key = "cancel-unavailable";
		const f = await fixture(key);
		try {
			failures.set(key, new Error("temporary failure"));
			await f.wake();
			await waitFor(
				() => f.queryClient.getQueryData(f.options.queryKey) === undefined,
			);
			f.unsubscribe();
			await setup.app.collections.recovery_items.create({ key, title: "late" });
			await Bun.sleep(50);
			expect(f.queryClient.getQueryData(f.options.queryKey)).toBeUndefined();
			expect(f.errors).toEqual([]);
		} finally {
			f.close();
		}
	});
});
