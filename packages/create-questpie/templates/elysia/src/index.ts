/**
 * Elysia entrypoint (headless QUESTPIE API).
 *
 * Mounts the QUESTPIE Elysia adapter under `/api` and redirects the
 * root to the Scalar API reference. Elysia runs on Bun and begins serving as
 * soon as `.listen()` is called — `bun run src/index.ts` boots the server.
 */
import { Elysia } from "elysia";
import { createGracefulServerShutdown } from "questpie/app";

import { app as questpie, destroyApp } from "#questpie";
import { env } from "@/lib/env";
import { questpieElysia } from "@questpie/elysia/server";

const elysia = new Elysia()
	.use(questpieElysia(questpie, { basePath: "/api" }))
	.get(
		"/",
		() =>
			new Response(null, { status: 302, headers: { Location: "/api/docs" } }),
	)
	.listen(env.PORT ?? 3000);

/* Stop accepting, drain, then release what the app opened.
 *
 * Elysia owns the server, so it can drain. `stop()` closes it, and the
 * lifecycle only calls destroyApp() afterwards. destroyApp() disposes services
 * in reverse dependency order: the queue first, then realtime and search, an
 * observability flush after them so buffered spans survive, and the database
 * connection last. Without this, a deploy drops every buffered span and leaks
 * whatever your services opened. */
const lifecycle = createGracefulServerShutdown(destroyApp);
lifecycle.attach({
	close: async () => {
		await elysia.stop();
	},
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.once(signal, () => {
		void lifecycle.shutdown().catch(() => {});
	});
}

console.log(`🚀 QUESTPIE headless API on http://localhost:${env.PORT ?? 3000}`);
