/**
 * Hono entrypoint (headless QUESTPIE API).
 *
 * Mounts the QUESTPIE Hono adapter under `/api` and redirects the
 * root to the Scalar API reference. Bun serves a default export that exposes a
 * `fetch` function — `bun run src/index.ts` boots the server directly.
 *
 * Running on Node? Swap the default export for `@hono/node-server`:
 *
 *   import { serve } from "@hono/node-server";
 *   serve({ fetch: server.fetch, port: env.PORT ?? 3000 });
 */
import { Hono } from "hono";
import { createGracefulServerShutdown } from "questpie/app";

import { app as questpie, destroyApp } from "#questpie";
import { env } from "@/lib/env";
import { questpieHono } from "@questpie/hono/server";

const server = new Hono().route(
	"/",
	questpieHono(questpie, { basePath: "/api" }),
);

server.get("/", (c) => c.redirect("/api/docs"));

/* Release what the app opened when the platform stops the process.
 *
 * destroyApp() disposes services in reverse dependency order: the queue first,
 * then realtime and search, an observability flush after them so buffered spans
 * survive, and the database connection last. Without this, a deploy drops every
 * buffered span and leaks whatever your services opened.
 *
 * No server is attached. Bun owns it, because the default export below hands it
 * a fetch function rather than a handle. So this releases resources but does not
 * drain in-flight requests. Give the platform a termination grace period longer
 * than your slowest request. This executable owns process termination after its
 * resources have closed. */
const lifecycle = createGracefulServerShutdown(destroyApp);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.once(signal, () => {
		void lifecycle.shutdown().then(
			() => process.exit(0),
			(error) => {
				console.error(`Failed to shut down after ${signal}`, error);
				process.exit(1);
			},
		);
	});
}

export default {
	port: env.PORT ?? 3000,
	fetch: server.fetch,
};
