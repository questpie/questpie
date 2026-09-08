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

import { createClient } from "../generated/client";
import { createQueryAdapter } from "../generated/client.react-query";

const id = "018f5f6e-5f2c-7b41-a854-3d9a6b6b7131";
const otherId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b7132";
const time = "2026-09-08T10:00:00.000Z";

function peer(title: string) {
	const requests: Request[] = [];
	const client = createClient({
		baseUrl: "https://example.test",
		fetch: Object.assign(
			async (input: RequestInfo | URL, init?: RequestInit) => {
				const request = new Request(input, init);
				requests.push(request);
				return new Response(
					JSON.stringify({
						callId: decodeURIComponent(
							request.headers.get("Questpie-Call-Id")!,
						),
						result: { id, title, updatedAt: time },
					}),
					{ headers: { "content-type": "application/json; charset=utf-8" } },
				);
			},
			{ preconnect() {} },
		),
	});
	return { client, requests };
}

test("generated options resume through native Router hooks and serialization without another browser fetch", async () => {
	const firstPeer = peer("Tenant A");
	const secondPeer = peer("Tenant B");
	const browserPeer = peer("Unexpected browser fetch");
	const firstCache = new QueryClient();
	const secondCache = new QueryClient();
	const browserCache = new QueryClient();
	const first = createQueryAdapter(
		firstPeer.client.withContext({ companyId: id }),
		firstCache,
	);
	const second = createQueryAdapter(
		secondPeer.client.withContext({ companyId: otherId }),
		secondCache,
	);
	let browser: ReturnType<typeof createQueryAdapter> | undefined;
	const serverRouter = createRouter({
		routeTree: createRootRoute(),
		history: createMemoryHistory({ initialEntries: ["/"] }),
		isServer: true,
		origin: "https://example.test",
		dehydrate: () => ({ questpie: first.dehydrate() }),
	});
	setupRouterSsrQueryIntegration({
		router: serverRouter,
		queryClient: firstCache,
	});
	attachRouterServerSsrUtils({ router: serverRouter, manifest: undefined });
	const browserRouter = createRouter({
		routeTree: createRootRoute(),
		history: createMemoryHistory({ initialEntries: ["/"] }),
		isServer: false,
		origin: "https://example.test",
		hydrate: (state: { questpie: ReturnType<typeof first.dehydrate> }) => {
			expect(browserCache.getQueryCache().getAll()).toHaveLength(0);
			browser = createQueryAdapter(
				browserPeer.client.withContext({ companyId: id }),
				browserCache,
				{ hydrate: state.questpie },
			);
			// Browser construction order is deliberately the reverse of the server.
			browser.queries["tasks.detail"].options({ id: otherId });
		},
	});
	setupRouterSsrQueryIntegration({
		router: browserRouter,
		queryClient: browserCache,
	});
	try {
		const input = { id, asOf: new Date(time) };
		const firstOptions = first.queries["tasks.detail"].options(input);
		first.queries["tasks.detail"].options({ id: otherId });
		const secondOptions = second.queries["tasks.detail"].options(input);
		const [firstResult, secondResult] = await Promise.all([
			firstCache.fetchQuery({ ...firstOptions, staleTime: 60_000 }),
			secondCache.fetchQuery({ ...secondOptions, staleTime: 60_000 }),
		]);
		expect(firstResult?.updatedAt).toBeInstanceOf(Date);
		expect(firstResult?.title).toBe("Tenant A");
		expect(secondResult?.title).toBe("Tenant B");
		expect(firstOptions.queryKey).not.toEqual(secondOptions.queryKey);
		expect(firstPeer.requests).toHaveLength(1);
		expect(firstPeer.requests[0]?.method).toBe("GET");
		expect(new URL(firstPeer.requests[0]!.url).pathname).toBe(
			"/_questpie/query/tasks.detail",
		);
		expect(new URL(firstPeer.requests[0]!.url).searchParams.get("asOf")).toBe(
			time,
		);
		await serverRouter.serverSsr!.dehydrate();
		const script = serverRouter.serverSsr!.takeBufferedScripts()?.children;
		if (typeof script !== "string") throw new Error("Missing SSR bootstrap");
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
		await browserRouter.options.hydrate?.(
			runInContext("$_TSR.router.dehydratedData", realm),
		);
		if (!browser) throw new Error("Missing resumed adapter");
		const resumed = browser.queries["tasks.detail"].options(input);
		expect(resumed.queryKey).toEqual(firstOptions.queryKey);
		const result = await browserCache.fetchQuery({
			...resumed,
			staleTime: 60_000,
		});
		expect(result?.title).toBe("Tenant A");
		expect(result?.updatedAt.toISOString()).toBe(time);
		expect(browserPeer.requests).toHaveLength(0);
		expect(browserCache.getQueryCache().getAll()).toHaveLength(1);
		expect(secondCache.getQueryData(secondOptions.queryKey)?.title).toBe(
			"Tenant B",
		);
		expect(browserCache.getQueryData(secondOptions.queryKey)).toBeUndefined();
		expect(JSON.stringify(resumed.queryKey)).not.toContain(id);
		expect(JSON.stringify(resumed.queryKey)).not.toContain(
			first.dehydrate().seed,
		);
		serverRouter.serverSsr!.setRenderFinished();
	} finally {
		serverRouter.serverSsr!.cleanup();
		await Promise.all([first.dispose(), second.dispose(), browser?.dispose()]);
		firstCache.clear();
		secondCache.clear();
		browserCache.clear();
	}
});
