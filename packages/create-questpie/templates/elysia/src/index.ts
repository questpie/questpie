/**
 * Elysia entrypoint (headless QUESTPIE API).
 *
 * Mounts the framework-agnostic fetch handler under `/api` and redirects the
 * root to the Scalar API reference. Elysia runs on Bun and begins serving as
 * soon as `.listen()` is called — `bun run src/index.ts` boots the server.
 */
import { Elysia } from "elysia";
import { createFetchHandler } from "questpie/http";

import { env } from "@/lib/env";
import { app as questpie } from "@/questpie/server/app";

const handler = createFetchHandler(questpie, { basePath: "/api" });

new Elysia()
	.all("/api/*", async ({ request }) => (await handler(request)) ?? new Response("Not Found", { status: 404 }))
	.get("/", () => new Response(null, { status: 302, headers: { Location: "/api/docs" } }))
	.listen(env.PORT ?? 3000);

console.log(`🚀 QUESTPIE headless API on http://localhost:${env.PORT ?? 3000}`);
