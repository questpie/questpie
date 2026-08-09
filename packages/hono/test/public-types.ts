import { hc } from "hono/client";

import { questpieHono, type HonoAdapterConfig } from "../src/server.js";

const generatedApp = {
	config: { routes: {}, logger: {} },
	collections: {},
	globals: {},
} as const;

const safeConfig = {
	basePath: "/api",
	requestLogging: false,
	search: { reindexAccess: false },
	getSession: async () => null,
	getLocale: () => "en",
	extendContext: () => ({ organizationId: "org" }),
} satisfies HonoAdapterConfig;

// @ts-expect-error Public HTTP mounts cannot elevate authority.
const unsafeConfig: HonoAdapterConfig = { accessMode: "system" };
void unsafeConfig;

const server = questpieHono(generatedApp, safeConfig).get(
	"/native",
	(context) => context.json({ value: "typed" as const }),
);
const client = hc<typeof server>("http://localhost");
// @ts-expect-error The adapter must not invent arbitrary native RPC routes.
void client.missing.$get;
const response = await client.native.$get();
const value: "typed" | undefined = response.ok
	? (await response.json()).value
	: undefined;
void value;
