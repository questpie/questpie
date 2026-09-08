import { dehydrate, hydrate, QueryClient } from "@tanstack/query-core";

import { createClient } from "./generated/client";
import { createQueryAdapter } from "./generated/client.react-query";

// Native cache diagnostic only: no Start server, serialization adapter or
// browser hydration is exercised. No bootstrap identity contract is selected.
const id = "018f5f6e-5f2c-7b41-a854-3d9a6b6b7131";
const client = createClient({ baseUrl: "https://proof.invalid" });
const server = new QueryClient();
const browser = new QueryClient();
const jsonRoundTrip = new QueryClient();
const serverAdapter = createQueryAdapter(
	client.withContext({ companyId: id }),
	server,
);
const browserAdapter = createQueryAdapter(
	client.withContext({ companyId: id }),
	browser,
);
try {
	const serverOptions = serverAdapter.queries["tasks.detail"].options({ id });
	const browserOptions = browserAdapter.queries["tasks.detail"].options({ id });
	server.setQueryData(serverOptions.queryKey, () => ({
		id,
		title: "Hydration diagnostic",
		updatedAt: new Date("2026-09-08T10:00:00.000Z"),
	}));
	const snapshot = dehydrate(server);
	hydrate(browser, snapshot);
	hydrate(jsonRoundTrip, JSON.parse(JSON.stringify(snapshot)));
	console.log(
		JSON.stringify(
			{
				diagnostic: "independent-scope-hydration",
				acceptance: false,
				sameKey:
					JSON.stringify(serverOptions.queryKey) ===
					JSON.stringify(browserOptions.queryKey),
				hydratedQueries: browser.getQueryCache().getAll().length,
				originalKeyCacheHit:
					browser.getQueryData(serverOptions.queryKey) !== undefined,
				browserScopeCacheHit:
					browser.getQueryData(browserOptions.queryKey) !== undefined,
				inMemoryDatePreserved:
					browser.getQueryData(serverOptions.queryKey)?.updatedAt instanceof
					Date,
				plainJsonDatePreserved:
					jsonRoundTrip.getQueryData(serverOptions.queryKey)
						?.updatedAt instanceof Date,
			},
			null,
			2,
		),
	);
} finally {
	await serverAdapter.dispose();
	await browserAdapter.dispose();
	server.clear();
	browser.clear();
	jsonRoundTrip.clear();
}
