import { expect, test } from "bun:test";
import { createContext, runInContext } from "node:vm";

import { QueryClient } from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRoute,
	createRouter,
} from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { attachRouterServerSsrUtils } from "@tanstack/react-router/ssr/server";

function owner(
	server: boolean,
	hooks: {
		dehydrate?: () => { bootstrap: string };
		hydrate?: (state: unknown) => void | Promise<void>;
	} = {},
) {
	const cache = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const router = createRouter({
		routeTree: createRootRoute(),
		history: createMemoryHistory({ initialEntries: ["/"] }),
		isServer: server,
		origin: "https://example.test",
		context: { queryClient: cache },
		...hooks,
	});
	setupRouterSsrQueryIntegration({ router, queryClient: cache });
	if (server) attachRouterServerSsrUtils({ router, manifest: undefined });
	return {
		cache,
		router,
		dispose() {
			router.serverSsr?.cleanup();
			cache.clear();
		},
	};
}

test("native Router integration hydrates isolated request caches after the bootstrap hook", async () => {
	const first = owner(true, { dehydrate: () => ({ bootstrap: "request-a" }) });
	const second = owner(true);
	let bootstrap = false;
	const browser = owner(false, {
		hydrate: async () => {
			await Promise.resolve();
			expect(browser.cache.getQueryData(["ticket"])).toBeUndefined();
			bootstrap = true;
		},
	});
	try {
		await Promise.all([
			first.cache.fetchQuery({
				queryKey: ["ticket"],
				queryFn: async () => ({ title: "Tenant A" }),
			}),
			second.cache.fetchQuery({
				queryKey: ["ticket"],
				queryFn: async () => ({ title: "Tenant B" }),
			}),
		]);
		const state = await first.router.options.dehydrate?.();
		await browser.router.options.hydrate?.(state!);
		expect(bootstrap).toBe(true);
		expect(browser.cache.getQueryData(["ticket"])).toMatchObject({
			title: "Tenant A",
		});
		expect(second.cache.getQueryData(["ticket"])).toMatchObject({
			title: "Tenant B",
		});
		first.router.serverSsr!.cleanup();
		expect(first.cache.getQueryCache().getAll()).toHaveLength(0);
		expect(second.cache.getQueryCache().getAll()).toHaveLength(1);
	} finally {
		first.dispose();
		second.dispose();
		browser.dispose();
	}
});

test("native SSR cleanup aborts pending Query work and clears request state", async () => {
	const server = owner(true);
	const started = Promise.withResolvers<AbortSignal>();
	try {
		const fetch = server.cache.fetchQuery({
			queryKey: ["slow"],
			queryFn: ({ signal }) => {
				started.resolve(signal);
				return new Promise<never>((_, reject) =>
					signal.addEventListener("abort", () => reject(signal.reason), {
						once: true,
					}),
				);
			},
		});
		const outcome = fetch.then(
			() => "resolved",
			() => "rejected",
		);
		const signal = await started.promise;
		server.router.serverSsr!.cleanup();
		expect(signal.aborted).toBe(true);
		expect(await outcome).toBe("rejected");
		expect(server.cache.getQueryCache().getAll()).toHaveLength(0);
	} finally {
		server.dispose();
	}
});

test("diagnostic: delayed hydration with server clock ahead can restore an omitted field", async () => {
	const server = owner(true);
	const browser = owner(false);
	try {
		const browserTime = Date.now();
		server.cache.setQueryData(
			["ticket"],
			{ title: "Old snapshot", privateNote: "Previously visible" },
			{ updatedAt: browserTime + 60_000 },
		);
		const delayedPayload = await server.router.options.dehydrate?.();
		browser.cache.setQueryData(
			["ticket"],
			{ title: "New authorized snapshot" },
			{ updatedAt: browserTime },
		);
		expect(browser.cache.getQueryData(["ticket"])).not.toHaveProperty(
			"privateNote",
		);
		await browser.router.options.hydrate?.(delayedPayload!);
		// This pins a counterexample, not an acceptable QUESTPIE behavior.
		expect(browser.cache.getQueryData(["ticket"])).toHaveProperty(
			"privateNote",
			"Previously visible",
		);
		expect(browser.cache.getQueryData(["ticket"])).toHaveProperty(
			"title",
			"Old snapshot",
		);
	} finally {
		server.dispose();
		browser.dispose();
	}
});

test("a pending native Query streams after initial dehydration and settles in the client cache", async () => {
	const server = owner(true);
	const browser = owner(false);
	const pending = Promise.withResolvers<{ title: string }>();
	const received = Promise.withResolvers<void>();
	const unsubscribe = browser.cache.getQueryCache().subscribe((event) => {
		if (event.query.state.status === "success") received.resolve();
	});
	try {
		const firstState = await server.router.options.dehydrate?.();
		await browser.router.options.hydrate?.(firstState!);
		const fetch = server.cache.fetchQuery({
			queryKey: ["pending"],
			queryFn: () => pending.promise,
		});
		await Promise.resolve();
		await Promise.resolve();
		expect(browser.cache.getQueryData(["pending"])).toBeUndefined();
		pending.resolve({ title: "Streamed later" });
		await fetch;
		await received.promise;
		expect(browser.cache.getQueryData(["pending"])).toMatchObject({
			title: "Streamed later",
		});
		server.router.serverSsr!.setRenderFinished();
	} finally {
		unsubscribe();
		server.dispose();
		browser.dispose();
	}
});

test("published Router SSR serialization preserves Date and escapes script text", async () => {
	const server = owner(true);
	try {
		await server.cache.fetchQuery({
			queryKey: ["serialized"],
			queryFn: async () => ({
				updatedAt: new Date("2026-09-08T12:00:00.000Z"),
				title: "</script><script>unexpected()</script>",
			}),
		});
		await server.router.serverSsr!.dehydrate();
		const script = server.router.serverSsr!.takeBufferedScripts()?.children;
		expect(typeof script).toBe("string");
		if (typeof script !== "string") throw new Error("Missing SSR bootstrap");
		expect(script).not.toContain("</script><script>unexpected()");
		const realm = createContext({
			ReadableStream,
			document: { currentScript: { remove() {} } },
		});
		runInContext("globalThis.self = globalThis", realm);
		runInContext(script, realm);
		expect(
			runInContext(
				"$_TSR.router.dehydratedData.query.initial[0].state.data.updatedAt instanceof Date",
				realm,
			),
		).toBe(true);
		expect(
			runInContext(
				"$_TSR.router.dehydratedData.query.initial[0].state.data.updatedAt.toISOString()",
				realm,
			),
		).toBe("2026-09-08T12:00:00.000Z");
		expect(
			runInContext(
				"$_TSR.router.dehydratedData.query.initial[0].state.data.title",
				realm,
			),
		).toBe("</script><script>unexpected()</script>");
		server.router.serverSsr!.setRenderFinished();
	} finally {
		server.dispose();
	}
});
