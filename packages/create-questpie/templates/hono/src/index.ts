/**
 * Hono entrypoint (headless QUESTPIE API).
 *
 * Mounts the framework-agnostic fetch handler under `/api` and redirects the
 * root to the Scalar API reference. Bun serves a default export that exposes a
 * `fetch` function — `bun run src/index.ts` boots the server directly.
 *
 * Running on Node? Swap the default export for `@hono/node-server`:
 *
 *   import { serve } from "@hono/node-server";
 *   serve({ fetch: server.fetch, port: env.PORT ?? 3000 });
 */
import { Hono } from "hono";
import { createFetchHandler } from "questpie/http";

import { env } from "@/lib/env.js";
import { app as questpie } from "@/questpie/server/app.js";

const handler = createFetchHandler(questpie, { basePath: "/api" });

const server = new Hono();

server.all("/api/*", async (c) => (await handler(c.req.raw)) ?? c.notFound());

server.get("/", (c) => c.redirect("/api/docs"));

export default {
	port: env.PORT ?? 3000,
	fetch: server.fetch,
};
