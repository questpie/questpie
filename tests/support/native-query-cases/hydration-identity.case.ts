import { expect, test } from "bun:test";

import { dehydrate, hydrate, QueryClient } from "@tanstack/react-query";
import { createQueryAdapter } from "questpie/react-query";

import { createClient } from "#questpie/test-client";

const id = "018f5f6e-5f2c-7b41-a854-3d9a6b6b7131";
const otherId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b7132";
const time = "2026-09-08T10:00:00.000Z";

test("late native hydration cannot restore a retired scope before initial delivery ends", async () => {
	const ready = Promise.withResolvers<void>();
	const client = createClient({ baseUrl: "https://proof.invalid" });
	const serverCache = new QueryClient();
	const cache = new QueryClient();
	const server = createQueryAdapter(
		client.withContext({ companyId: id }),
		serverCache,
		{ ssr: true },
	);
	const old = createQueryAdapter(client.withContext({ companyId: id }), cache, {
		hydrate: server.dehydrate(),
		ready: ready.promise,
	});
	const next = createQueryAdapter(client.withContext({ companyId: id }), cache);
	const oldOptions = {
		...old.queries["tasks.detail"].options({ id }),
		staleTime: Infinity,
	};
	const nextOptions = next.queries["tasks.detail"].options({ id });
	try {
		serverCache.setQueryData(oldOptions.queryKey, () => ({
			id,
			title: "Old streamed row",
			updatedAt: new Date(time),
		}));
		cache.setQueryData(nextOptions.queryKey, () => null);
		await old.dispose();
		hydrate(cache, dehydrate(serverCache));
		expect(cache.getQueryData(oldOptions.queryKey)).toBeUndefined();
		expect(cache.getQueryData(nextOptions.queryKey)).toBeNull();
		await expect(cache.fetchQuery(oldOptions)).rejects.toThrow("SCOPE_RETIRED");
		ready.resolve();
		await Bun.sleep(0);
		expect(cache.getQueryData(oldOptions.queryKey)).toBeUndefined();
	} finally {
		ready.resolve();
		await old.dispose();
		await next.dispose();
		await server.dispose();
		cache.clear();
		serverCache.clear();
	}
});

test("ordinary browser reads wait for native hydration before publishing a newer result", async () => {
	const ready = Promise.withResolvers<void>();
	let calls = 0;
	const client = createClient({
		baseUrl: "https://proof.invalid",
		fetch: (async (request: Request) => {
			calls++;
			return new Response(
				JSON.stringify({
					callId: request.headers.get("Questpie-Call-Id"),
					result: null,
				}),
				{ headers: { "content-type": "application/json; charset=utf-8" } },
			);
		}) as typeof fetch,
	});
	const serverCache = new QueryClient();
	const browserCache = new QueryClient();
	const server = createQueryAdapter(
		client.withContext({ companyId: id }),
		serverCache,
		{ ssr: true },
	);
	const browser = createQueryAdapter(
		client.withContext({ companyId: id }),
		browserCache,
		{
			hydrate: server.dehydrate(),
			ready: ready.promise,
		},
	);
	try {
		const options = browser.queries["tasks.detail"].options({ id });
		serverCache.setQueryData(
			options.queryKey,
			() => ({ id, title: "Old SSR task", updatedAt: new Date(time) }),
			{ updatedAt: Date.now() + 60_000 },
		);
		const completion = browserCache.fetchQuery(options);
		await Bun.sleep(0);
		expect(calls).toBe(0);
		hydrate(browserCache, dehydrate(serverCache));
		expect(browserCache.getQueryData(options.queryKey)?.title).toBe(
			"Old SSR task",
		);
		ready.resolve();
		expect(await completion).toBeNull();
		expect(browserCache.getQueryData(options.queryKey)).toBeNull();
		expect(calls).toBe(1);
	} finally {
		ready.resolve();
		await browser.dispose();
		await server.dispose();
		browserCache.clear();
		serverCache.clear();
	}
});

test("abandoned options have no adapter capture quota or cache entry", async () => {
	const cache = new QueryClient();
	const client = createClient({ baseUrl: "https://proof.invalid" });
	const adapter = createQueryAdapter(
		client.withContext({ companyId: id }),
		cache,
	);
	try {
		const first = adapter.queries["tasks.detail"].options({ id });
		for (let index = 0; index < 1_000; index++) {
			adapter.queries["tasks.detail"].options({
				id: `018f5f6e-5f2c-7b41-a854-${index.toString(16).padStart(12, "0")}`,
			});
		}
		expect(cache.getQueryCache().getAll()).toHaveLength(0);
		expect(adapter.queries["tasks.detail"].options({ id }).queryKey).toEqual(
			first.queryKey,
		);
	} finally {
		await adapter.dispose();
		cache.clear();
	}
});

test("one request bootstrap matches native hydrated keys without depending on options construction order", async () => {
	const serverCache = new QueryClient();
	const browserCache = new QueryClient();
	const client = createClient({ baseUrl: "https://proof.invalid" });
	const server = createQueryAdapter(
		client.withContext({ companyId: id }),
		serverCache,
	);
	let browser: typeof server | undefined;
	try {
		const first = server.queries["tasks.detail"].options({ id });
		server.queries["tasks.detail"].options({ id: otherId });
		serverCache.setQueryData(first.queryKey, () => ({
			id,
			title: "SSR task",
			updatedAt: new Date(time),
		}));
		browser = createQueryAdapter(
			client.withContext({ companyId: id }),
			browserCache,
			{ hydrate: server.dehydrate() },
		);
		browser.queries["tasks.detail"].options({ id: otherId });
		const resumed = browser.queries["tasks.detail"].options({ id });
		hydrate(browserCache, dehydrate(serverCache));
		expect(resumed.queryKey).toEqual(first.queryKey);
		expect(browserCache.getQueryData(resumed.queryKey)?.title).toBe("SSR task");
		expect(
			browserCache.getQueryData(resumed.queryKey)?.updatedAt,
		).toBeInstanceOf(Date);
		expect(JSON.stringify(resumed.queryKey)).not.toContain(id);
		expect(JSON.stringify(resumed.queryKey)).not.toContain(
			server.dehydrate().seed,
		);
	} finally {
		await server.dispose();
		await browser?.dispose();
		serverCache.clear();
		browserCache.clear();
	}
});

test("bootstrap cannot cross Context or alias another active scope owner", async () => {
	const serverCache = new QueryClient();
	const browserCache = new QueryClient();
	const client = createClient({ baseUrl: "https://proof.invalid" });
	const server = createQueryAdapter(
		client.withContext({ companyId: id }),
		serverCache,
	);
	let browser: typeof server | undefined;
	try {
		const bootstrap = server.dehydrate();
		expect(() =>
			createQueryAdapter(
				client.withContext({ companyId: otherId }),
				browserCache,
				{ hydrate: bootstrap },
			),
		).toThrow("QUERY_BOOTSTRAP_MISMATCH");
		const scope = client.withContext({ companyId: id });
		browser = createQueryAdapter(scope, browserCache, { hydrate: bootstrap });
		expect(
			createQueryAdapter(scope, browserCache, { hydrate: bootstrap }),
		).toBe(browser);
		expect(() =>
			createQueryAdapter(client.withContext({ companyId: id }), browserCache, {
				hydrate: bootstrap,
			}),
		).toThrow("QUERY_BOOTSTRAP_IN_USE");
		expect(() =>
			createQueryAdapter(scope, browserCache, {
				hydrate: { ...bootstrap, seed: "invalid" },
			}),
		).toThrow("QUERY_BOOTSTRAP_INVALID");
	} finally {
		await server.dispose();
		await browser?.dispose();
		serverCache.clear();
		browserCache.clear();
	}
});
