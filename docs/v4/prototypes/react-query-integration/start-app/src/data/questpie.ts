import { QueryClient } from "@tanstack/react-query";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { createClient } from "../../../generated/live-client";
import { createQueryAdapter } from "../../../generated/live-client.react-query";
import { firstDocumentReady, skewServerSnapshots } from "../tracer/scenario";

export const firstId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b7131";
export const streamedId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b7132";
export const expectedTime = "2026-09-08T10:00:00.000Z";
const requestUrl = createIsomorphicFn()
	.server(() => getRequest().url)
	.client(() => window.location.href);

export function createOwner(server: boolean) {
	const location = new URL(requestUrl());
	const cache = new QueryClient({
		defaultOptions: { queries: { staleTime: 60_000, retry: false } },
	});
	if (server) skewServerSnapshots(cache);
	const setup = Promise.withResolvers<void>();
	let ready = false;
	const liveReady = server
		? undefined
		: firstDocumentReady(setup.promise, () => {
				ready = true;
			});
	let calls = 0;
	let streams = 0;
	let serverCalls = 0;
	const client = createClient({
		baseUrl: location.origin,
		fetch: Object.assign(
			async (input: RequestInfo | URL, init?: RequestInit) => {
				const request = new Request(input, init);
				const headers = new Headers(request.headers);
				headers.set("x-proof-side", server ? "server" : "browser");
				if (server && location.searchParams.has("hold"))
					headers.set("x-proof-hold", "1");
				if (new URL(request.url).pathname === "/_questpie/realtime") {
					if (request.method === "GET") streams++;
				} else calls++;
				return fetch(new Request(request, { headers }));
			},
			{ preconnect() {} },
		),
	});
	const scope = client.withContext({ companyId: firstId });
	let adapter = server
		? createQueryAdapter(scope, cache, { ssr: true })
		: undefined;
	return {
		cache,
		get api() {
			if (!adapter) throw new Error("BOOTSTRAP_NOT_READY");
			return adapter;
		},
		dehydrate() {
			if (!adapter) throw new Error("BOOTSTRAP_NOT_READY");
			return { identity: adapter.dehydrate(), serverCalls: calls };
		},
		hydrate(state: {
			identity: ReturnType<ReturnType<typeof createQueryAdapter>["dehydrate"]>;
			serverCalls: number;
		}) {
			adapter = createQueryAdapter(scope, cache, {
				hydrate: state.identity,
				liveReady,
			});
			serverCalls = state.serverCalls;
		},
		hydrationSetupComplete() {
			setup.resolve();
		},
		metrics() {
			return {
				browserCalls: calls,
				serverCalls,
				streams,
				ready,
				cacheEntries: cache.getQueryCache().getAll().length,
			};
		},
	};
}
