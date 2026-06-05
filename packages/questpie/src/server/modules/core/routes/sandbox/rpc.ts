/**
 * Sandbox bindings broker endpoint — `POST /_sandbox/rpc`.
 *
 * The TRUSTED host side of the UNTRUSTED bindings path (design §13/§14). The
 * sandbox SUPERVISOR (the `@questpie/sandbox` Deno service), on a guest binding
 * RPC, relays it here SERVER-TO-SERVER carrying the per-run scoped token; this
 * endpoint authenticates the token, enforces the run's capabilities PER CALL
 * (default-deny), executes via the run's bound primitive target, and returns the
 * structured result/error.
 *
 * SECURITY NOTES:
 *   - This is reached by the SUPERVISOR, never by guest code directly. The guest
 *     cannot `fetch` here: its egress allowlist rejects loopback/private IPs (the
 *     SSRF defense), so a localhost broker is unreachable by design — the guest
 *     reaches the broker ONLY over the supervisor's stdio relay.
 *   - The token is carried in the `x-questpie-sandbox-token` header, not the body,
 *     and is an OPAQUE handle minted server-side; it grants nothing beyond the
 *     run's already-declared scope and cannot be widened by the guest.
 *   - All enforcement lives in {@link SandboxBroker.handleRpc} (the single
 *     chokepoint); this route only adapts HTTP ⇄ broker. It never throws a bare
 *     500 — every outcome is a structured `BrokerRpcResponse` body.
 *
 * The route does NOT use `.access()` gating: authentication IS the per-run token,
 * checked inside the broker. With no token (or an unknown one) the broker returns
 * `unauthorized`, so an unauthenticated caller gets a structured 401-style body.
 */

import type { BrokerRpcResponse } from "#questpie/server/modules/core/integrated/executor/bindings/protocol.js";
import { BINDINGS_TOKEN_HEADER } from "#questpie/server/modules/core/integrated/executor/bindings/protocol.js";
import type { ExecutorService } from "#questpie/server/modules/core/integrated/executor/service.js";
import { route } from "#questpie/server/routes/define-route.js";

function json(body: BrokerRpcResponse, status: number): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

export default route()
	.post()
	.raw()
	.handler(async ({ request, app }) => {
		const broker = (app.executor as ExecutorService | undefined)?.broker;
		if (!broker) {
			return json(
				{
					ok: false,
					error: {
						code: "execution_error",
						message: "sandbox broker unavailable (executor service missing)",
					},
				},
				500,
			);
		}

		const token = request.headers.get(BINDINGS_TOKEN_HEADER);

		let body: { method?: unknown; args?: unknown };
		try {
			body = (await request.json()) as { method?: unknown; args?: unknown };
		} catch {
			return json(
				{
					ok: false,
					error: { code: "bad_args", message: "invalid JSON body" },
				},
				400,
			);
		}

		if (typeof body?.method !== "string") {
			return json(
				{
					ok: false,
					error: { code: "bad_method", message: "missing 'method' string" },
				},
				400,
			);
		}

		// The broker is the single enforcement chokepoint; it never throws.
		const result = await broker.handleRpc(token, body.method, body.args);

		// Map the structured error code to an HTTP status (informational; the
		// supervisor reads the JSON body, not the status, to build the rpc-result).
		const status = result.ok
			? 200
			: result.error.code === "unauthorized"
				? 401
				: result.error.code === "forbidden"
					? 403
					: result.error.code === "not_implemented"
						? 501
						: 400;

		return json(result, status);
	});
