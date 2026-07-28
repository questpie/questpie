import { sql } from "drizzle-orm";

import { route } from "#questpie/server/routes/define-route.js";
import { routeApp } from "#questpie/server/routes/route-app.js";

/**
 * Readiness check — public endpoint, no auth required.
 *
 * "Ready" means this instance can serve traffic: every subsystem it depends on
 * answered. Point your load balancer and Kubernetes `readinessProbe` here.
 *
 * Use `/health/live` for a liveness probe instead. Pointing a liveness probe at
 * this endpoint is a classic way to turn a brief database blip into a restart
 * loop across every replica at once.
 *
 * Status codes: 200 (ok | degraded), 503 (unhealthy).
 *
 * GET /health
 */

type CheckStatus = "ok" | "degraded" | "unhealthy" | "not_configured";

interface CheckResult {
	status: CheckStatus;
	latency_ms?: number;
	/** Set when the check did not simply pass. Never carries adapter internals. */
	detail?: string;
}

/** Bounds one check so a hung dependency cannot hang the probe itself. */
const CHECK_TIMEOUT_MS = 2000;

async function timed(
	fn: () => Promise<unknown>,
	timeoutMs = CHECK_TIMEOUT_MS,
): Promise<CheckResult> {
	const started = Date.now();
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			fn(),
			new Promise((_resolve, reject) => {
				timer = setTimeout(
					() => reject(new Error(`timed out after ${timeoutMs}ms`)),
					timeoutMs,
				);
			}),
		]);
		return { status: "ok", latency_ms: Date.now() - started };
	} catch (error) {
		return {
			status: "unhealthy",
			latency_ms: Date.now() - started,
			detail: error instanceof Error ? error.message : "check failed",
		};
	} finally {
		if (timer) clearTimeout(timer);
	}
}

export default route()
	.get()
	.access(true)
	.raw()
	.handler(async (ctx) => {
		const app = routeApp(ctx);
		const checks: Record<string, CheckResult> = {};

		// Database — a real round trip, not a null check on the client object.
		checks.database = await timed(() =>
			(app.db as { execute: (q: unknown) => Promise<unknown> }).execute(
				sql`SELECT 1`,
			),
		);

		// KV — a real read. A missing key is a healthy answer; a throw is not.
		checks.kv = app.kv
			? await timed(() => app.kv.get("__questpie_health__"))
			: { status: "not_configured" };

		// Search — the adapter's own readiness. Degraded rather than unhealthy:
		// an app whose search is still warming can serve everything else.
		if (app.search) {
			checks.search = app.search.isInitialized?.()
				? { status: "ok" }
				: { status: "degraded", detail: "adapter not initialized" };
		} else {
			checks.search = { status: "not_configured" };
		}

		// Storage and queue are reported as CONFIGURED, not probed. Every
		// meaningful probe (head/list/put, or a dispatch) costs a request against
		// object storage or enqueues work — on every health check, at load
		// balancer frequency. The previous version claimed "ok" for storage
		// without touching it at all; this says exactly what was verified.
		checks.storage = app.storage
			? { status: "ok", detail: "configured (not probed)" }
			: { status: "not_configured" };

		checks.queue = app.queue
			? { status: "ok", detail: "configured (not probed)" }
			: { status: "not_configured" };

		// Worst status wins. `not_configured` is not a failure — an app without
		// Search is not unhealthy, it simply has no Search.
		let overall: "ok" | "degraded" | "unhealthy" = "ok";
		for (const check of Object.values(checks)) {
			if (check.status === "unhealthy") {
				overall = "unhealthy";
				break;
			}
			if (check.status === "degraded") overall = "degraded";
		}

		return Response.json(
			{ status: overall, timestamp: new Date().toISOString(), checks },
			{
				status: overall === "unhealthy" ? 503 : 200,
				headers: { "cache-control": "no-store" },
			},
		);
	});
