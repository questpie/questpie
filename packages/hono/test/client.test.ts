import { describe, expect, test } from "bun:test";

import type { RawRouteDefinition } from "questpie/server";

import { createClientFromHono } from "../src/client.js";

type DownloadRoute = Omit<RawRouteDefinition, "method"> & {
	readonly method: "GET";
};

type RawRouteApp = {
	collections: {};
	routes: { download: DownloadRoute };
};

describe("Hono unified client", () => {
	test("forwards QUESTPIE raw routes through the outer client", async () => {
		const response = new Response("download");
		let receivedUrl = "";
		let receivedInit: RequestInit | undefined;
		const client = createClientFromHono<any, RawRouteApp>({
			baseURL: "https://example.test",
			rawRoutes: { "download:GET": true },
			fetch: async (input, init) => {
				receivedUrl = String(input);
				receivedInit = init;
				return response;
			},
		});

		const result = await client.routes.download.get({ redirect: "manual" });

		expect(result).toBe(response);
		expect(receivedUrl).toBe("https://example.test/download");
		expect(receivedInit?.method).toBe("GET");
		expect(receivedInit?.redirect).toBe("manual");
	});
});
