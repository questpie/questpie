import { treaty } from "@elysiajs/eden";
import { Elysia } from "elysia";
import type { Questpie } from "questpie";

import { questpieElysia, type ElysiaAdapterConfig } from "../src/server.js";

const safeConfig = {
	basePath: "/api",
	requestLogging: false,
	search: { reindexAccess: false },
	getSession: async () => null,
	getLocale: () => "en",
	extendContext: () => ({ organizationId: "org" }),
} satisfies ElysiaAdapterConfig;

// @ts-expect-error Public HTTP mounts cannot elevate authority.
const unsafeConfig: ElysiaAdapterConfig = { accessMode: "system" };
void unsafeConfig;

const server = new Elysia()
	.use(questpieElysia({} as Questpie<any>, safeConfig))
	.get("/native", () => ({ value: "typed" as const }));
const client = treaty<typeof server>("localhost");
// @ts-expect-error The adapter must not invent arbitrary native Eden routes.
void client.missing.get;
const response = await client.native.get();
const value: "typed" | undefined = response.data?.value;
void value;
