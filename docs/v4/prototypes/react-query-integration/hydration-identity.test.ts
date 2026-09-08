import { expect, test } from "bun:test";

import { dehydrate, hydrate, QueryClient } from "@tanstack/query-core";

import { createClient } from "./generated/client";
import { createQueryAdapter } from "./generated/client.react-query";

const id = "018f5f6e-5f2c-7b41-a854-3d9a6b6b7131";
const otherId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b7132";
const time = "2026-09-08T10:00:00.000Z";

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
	let browser: ReturnType<typeof createQueryAdapter> | undefined;
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
	let browser: ReturnType<typeof createQueryAdapter> | undefined;
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
