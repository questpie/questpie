import { route } from "#questpie/server/routes/define-route.js";

/**
 * Health check route — public endpoint, no auth required.
 *
 * Returns overall status + per-subsystem checks (database, search, storage).
 * Status codes: 200 (ok/degraded), 503 (unhealthy).
 *
 * GET /health
 */
export default route()
	.get()
	.access(true)
	.raw()
	.handler(async (ctx) => {
		const app = (ctx as any).app;
		const checks: Record<string, { status: string; latency_ms?: number }> = {};
		let overall: "ok" | "degraded" | "unhealthy" = "ok";

		// Database check
		try {
			const dbStart = Date.now();
			const db = app.db;
			if (db) {
				await (db.execute?.("SELECT 1") ?? Promise.resolve());
			}
			checks.database = { status: "ok", latency_ms: Date.now() - dbStart };
		} catch {
			checks.database = { status: "unhealthy" };
			overall = "unhealthy";
		}

		// Search check
		if (app.search) {
			checks.search = {
				status: app.search.isInitialized?.() ? "ok" : "degraded",
			};
			if (checks.search.status === "degraded" && overall === "ok")
				overall = "degraded";
		}

		// Storage check
		if (app.storage) {
			checks.storage = { status: "ok" };
		}

		return Response.json(
			{ status: overall, timestamp: new Date().toISOString(), checks },
			{ status: overall === "unhealthy" ? 503 : 200 },
		);
	});
