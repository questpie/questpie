/**
 * Next runs `register()` once per server process, before any request. It is the
 * only hook the framework offers that fits process lifecycle work.
 *
 * Next owns the server and gives no handle to close, so this releases what the
 * app opened rather than draining in-flight requests. Give the platform a
 * termination grace period longer than your slowest request.
 *
 * `destroyApp()` disposes services in reverse dependency order: the queue
 * first, then realtime and search, an observability flush after them so
 * buffered spans survive, and the database connection last. Without it a deploy
 * drops every buffered span and leaks whatever your services opened.
 */
export async function register() {
	// Only the Node runtime has process signals. The edge runtime has neither
	// these nor a QUESTPIE app to tear down.
	if (process.env.NEXT_RUNTIME !== "nodejs") return;

	const { createGracefulServerShutdown } = await import("questpie/app");
	const { destroyApp } = await import("#questpie");

	const lifecycle = createGracefulServerShutdown(destroyApp);

	for (const signal of ["SIGINT", "SIGTERM"] as const) {
		process.once(signal, () => {
			void lifecycle.shutdown().catch(() => {});
		});
	}
}
