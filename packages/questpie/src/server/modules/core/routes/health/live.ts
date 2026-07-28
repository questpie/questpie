import { route } from "#questpie/server/routes/define-route.js";

/**
 * Liveness check — public endpoint, no auth required.
 *
 * Answers one question: is this process still able to serve a request? It
 * touches NOTHING — no database, no KV, no adapters — because a liveness probe
 * that depends on external services turns a shared outage into a rolling
 * restart of every replica at the moment they can least afford it.
 *
 * Use this for a Kubernetes `livenessProbe` and `/health` for the
 * `readinessProbe`.
 *
 * Always 200 while the process is running. If it does not answer, the process
 * is wedged and restarting it is the right response.
 *
 * GET /health/live
 */
export default route()
	.get()
	.access(true)
	.raw()
	.handler(async () =>
		Response.json(
			{ status: "ok", uptime_s: Math.round(process.uptime()) },
			{ headers: { "cache-control": "no-store" } },
		),
	);
