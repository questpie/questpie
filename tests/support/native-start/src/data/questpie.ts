import { QueryClient } from "@tanstack/react-query";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createQueryAdapter } from "questpie/react-query";

import { createClient } from "#questpie/client";
import { createClient as createOrdinaryClient } from "#questpie/ordinary-client";

import { firstDocumentReady, skewServerSnapshots } from "../tracer/scenario";

export const firstId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b7131";
export const streamedId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b7132";
export const expectedTime = "2026-09-08T10:00:00.000Z";
const requestUrl = createIsomorphicFn()
	.server(() => getRequest().url)
	.client(() => window.location.href);
const requestCookie = createIsomorphicFn()
	.server(() => getRequest().headers.get("cookie"))
	.client(() => null);

export function createOwner(server: boolean) {
	const location = new URL(requestUrl());
	const cookie = requestCookie();
	const cache = new QueryClient({
		defaultOptions: { queries: { staleTime: 60_000, retry: false } },
	});
	if (server) skewServerSnapshots(cache);
	const setup = Promise.withResolvers<void>();
	let ready = false;
	const executionReady = server
		? undefined
		: firstDocumentReady(setup.promise, () => {
				ready = true;
			});
	let calls = 0;
	let streams = 0;
	let serverCalls = 0;
	const transport = Object.assign(
		async (input: RequestInfo | URL, init?: RequestInit) => {
			const request = new Request(input, init);
			const headers = new Headers(request.headers);
			headers.set("x-proof-side", server ? "server" : "browser");
			if (server && cookie) headers.set("cookie", cookie);
			if (server && location.searchParams.has("hold"))
				headers.set("x-proof-hold", "1");
			if (new URL(request.url).pathname === "/_questpie/realtime") {
				if (request.method === "GET") streams++;
			} else calls++;
			return fetch(new Request(request, { headers }));
		},
		{ preconnect() {} },
	);
	const client = createClient({ baseUrl: location.origin, fetch: transport });
	// Compiler-IR control, separate from the full-source Desk application. It uses
	// the same native cache and exact first-document Promise, never a new serializer.
	const ordinaryClient = createOrdinaryClient({
		baseUrl: location.origin,
		fetch: transport,
	});
	const ordinaryScope = ordinaryClient.withContext({ companyId: firstId });
	const scope = client.withContext({
		membershipId: firstId,
		organizationId: firstId,
	});
	let adapter = server
		? createQueryAdapter(scope, cache, { ssr: true })
		: undefined;
	let ordinaryAdapter = server
		? createQueryAdapter(ordinaryScope, cache, { ssr: true })
		: undefined;
	return {
		cache,
		replaceScope() {
			adapter = createQueryAdapter(
				client.withContext({ membershipId: firstId, organizationId: firstId }),
				cache,
				{ ready: executionReady },
			);
			return adapter;
		},
		get api() {
			if (!adapter) throw new Error("BOOTSTRAP_NOT_READY");
			return adapter;
		},
		get ordinaryApi() {
			if (!ordinaryAdapter) throw new Error("BOOTSTRAP_NOT_READY");
			return ordinaryAdapter;
		},
		replaceOrdinaryScope() {
			ordinaryAdapter = createQueryAdapter(
				ordinaryClient.withContext({ companyId: firstId }),
				cache,
				{ ready: executionReady },
			);
			return ordinaryAdapter;
		},
		dehydrate() {
			if (!adapter || !ordinaryAdapter) throw new Error("BOOTSTRAP_NOT_READY");
			return {
				identity: adapter.dehydrate(),
				ordinaryIdentity: ordinaryAdapter.dehydrate(),
				serverCalls: calls,
			};
		},
		hydrate(state: {
			identity: ReturnType<ReturnType<typeof createQueryAdapter>["dehydrate"]>;
			ordinaryIdentity: ReturnType<
				ReturnType<typeof createQueryAdapter>["dehydrate"]
			>;
			serverCalls: number;
		}) {
			adapter = createQueryAdapter(scope, cache, {
				hydrate: state.identity,
				ready: executionReady,
			});
			ordinaryAdapter = createQueryAdapter(ordinaryScope, cache, {
				hydrate: state.ordinaryIdentity,
				ready: executionReady,
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
