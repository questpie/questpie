/**
 * Named-endpoint dispatch for Knowledge mini-apps (the UNTRUSTED runner).
 *
 * `POST|GET|PUT|PATCH|DELETE /api/apps/{appId}/{fn}` resolves the app from the
 * Knowledge tree, confirms `{fn}` is a statically-inferred endpoint export, loads
 * the app's server entry source, and runs it in the SANDBOXED executor with a
 * HOST-SIDE, tenant-scoped, NON-PRIVILEGED bindings target (see
 * `../../../apps/mini-app-bindings`). The guest never imports the app — it reaches
 * the capability-scoped `questpie` primitives only via the broker, which the
 * executor service wires to the per-run token + this target.
 *
 * THIS ROUTE IS WHERE THE BINDINGS BROKER GOES LIVE FOR UNTRUSTED CODE — the
 * broker is dormant, fail-closed infra that trusts whatever scope + target it is
 * handed; the security boundary is the target built in {@link buildMiniAppBindingTarget}.
 * Decision: `mini-app-runner-must-impose-tenant-bound-and-non-privileged-principal`.
 *
 * TWO params `[appId]/[fn]` (NOT a catch-all) so M6's `apps/[appId]/fs/[...path]`
 * keeps trie priority for the literal `fs` segment.
 *
 * Design: `.private/knowledge-miniapps-mvp.md` §8 (M4), §13, §14.
 */

import { ApiError } from "questpie/errors";
import type { ExecutorRunResult } from "questpie/executor";
import { route } from "questpie/services";

import {
	type AppResolverCollections,
	resolveApp,
} from "../../../apps/app-resolver";
import {
	buildMiniAppBindingTarget,
	type MiniAppBindingCtx,
} from "../../../apps/mini-app-bindings";
import {
	buildEntrySource,
	resolveBrokerUrl,
	resolveCollectionRelationFields,
	resolveCollectionWriteRule,
} from "../../../apps/mini-app-runner";
import { sessionOnly } from "../../../lib/route-access";

/**
 * @deprecated Re-exported from `apps/mini-app-runner` (shared with the M5 cron
 * runner). Kept here as a named export for the existing route test import.
 */
export const buildEndpointEntrySource = buildEntrySource;

/** The narrow executor surface the runner needs (typed loosely; `ctx.executor` is `unknown`). */
interface RunnerExecutor {
	isEnabled?: boolean;
	run(opts: {
		source: string;
		input?: unknown;
		isolation: "sandboxed";
		capabilities?: unknown;
		appBindings?: unknown;
		brokerUrl?: string;
	}): Promise<ExecutorRunResult>;
}

type AppRouteContext = Questpie.AppContext & {
	request: Request;
	params: { appId: string; fn: string };
	/**
	 * The app instance (typed `any` on raw route args). Exposes `executor`, the
	 * resolved `config` (for the trusted broker URL), and `getCollectionConfig`
	 * (for host-side relation-field detection — G3).
	 */
	app: {
		executor?: RunnerExecutor;
		config?: { executor?: { brokerUrl?: string } };
		getCollectionConfig?: (name: string) => {
			getMeta(): { relations?: string[] };
			/** Builder state — `state.access` backs the G4 explicit-write-rule check. */
			state?: { access?: Record<string, unknown> };
		};
	};
};

/**
 * Request headers NEVER forwarded into the UNTRUSTED guest's `input` — they
 * carry the CALLER's credentials/secrets, which untrusted app code must not see.
 * (The guest runs as the app, not the caller; it gets the data surface via the
 * capability-scoped bindings, never the caller's auth.)
 */
const SENSITIVE_HEADERS = new Set([
	"authorization",
	"cookie",
	"set-cookie",
	"proxy-authorization",
	"x-questpie-sandbox-token", // the broker token (supervisor-only) must never leak
	"x-api-key",
	"x-auth-token",
]);

/** Header name prefixes that are stripped wholesale (e.g. forwarded auth). */
const SENSITIVE_HEADER_PREFIXES = ["x-forwarded-", "x-real-"];

function safeHeaders(request: Request): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [key, value] of request.headers.entries()) {
		const lower = key.toLowerCase();
		if (SENSITIVE_HEADERS.has(lower)) continue;
		if (SENSITIVE_HEADER_PREFIXES.some((p) => lower.startsWith(p))) continue;
		out[lower] = value;
	}
	return out;
}

/** Build the JSON-able request meta passed to the guest endpoint as `input`. */
async function buildEndpointInput(
	request: Request,
	appId: string,
	fn: string,
): Promise<unknown> {
	const url = new URL(request.url);
	const method = request.method.toUpperCase();

	let body: unknown;
	if (method === "POST" || method === "PUT" || method === "PATCH") {
		const text = await request.text();
		if (text.length > 0) {
			const contentType = request.headers.get("content-type") ?? "";
			if (contentType.includes("application/json")) {
				try {
					body = JSON.parse(text);
				} catch {
					throw ApiError.badRequest("Invalid JSON request body");
				}
			} else {
				body = text;
			}
		}
	}

	return {
		app: appId,
		fn,
		method,
		path: url.pathname,
		query: Object.fromEntries(url.searchParams.entries()),
		headers: safeHeaders(request),
		body,
	};
}

/** Map a structured `{ ok, output, error }` executor result to an HTTP Response. */
function resultToResponse(result: ExecutorRunResult): Response {
	if (result.ok) {
		return Response.json({
			ok: true,
			output: result.output,
			logs: result.logs,
		});
	}
	const status = result.timedOut ? 504 : 500;
	return Response.json(
		{
			ok: false,
			error: result.error ?? "mini-app execution failed",
			timedOut: result.timedOut ?? false,
			logs: result.logs,
		},
		{ status },
	);
}

export default route()
	.get()
	.post()
	.put()
	.patch()
	.delete()
	.access(sessionOnly)
	.params<{ appId: string; fn: string }>()
	.raw()
	.handler(async (ctx) => {
		const c = ctx as AppRouteContext;
		const { appId, fn } = c.params;

		// `app.executor` is the ExecutorService — accessed via `app` like the core
		// `/sandbox/rpc` route does, since `executor` is not surfaced on the typed
		// route AppContext.
		const executor = c.app.executor;
		if (!executor || executor.isEnabled === false) {
			throw ApiError.badRequest(
				"executor is not configured; the sandboxed mini-app runtime is unavailable",
			);
		}

		// 1. Resolve the app + manifest from the Knowledge tree (M3).
		const resolved = await resolveApp(
			appId,
			c.collections as unknown as AppResolverCollections,
		);

		// 2. Confirm `{fn}` is in the app's OPT-IN `actions` registry (default-deny;
		//    the registry is the only HTTP surface). A non-registered export, a
		//    reserved framework name (rejected at resolve time), and cron exports
		//    are all NOT addressable as HTTP actions.
		const endpoint = resolved.endpoints.find((e) => e.name === fn);
		if (!endpoint) {
			throw ApiError.notFound("Mini-app action", `${appId}/${fn}`);
		}

		// 3. Build the HOST-SIDE, tenant-scoped, non-privileged bindings target
		//    (G1 knowledge clamp, G2 user-mode principal, G3 relation guard). This
		//    is the security boundary — never trusts the manifest. The per-collection
		//    relation-field names (for the G3 where/orderBy guard) are read from the
		//    runtime collection metadata, not from the untrusted request.
		const target = buildMiniAppBindingTarget(
			appId,
			c as unknown as MiniAppBindingCtx,
			resolved.capabilities,
			(name) => resolveCollectionRelationFields(c.app, name),
			(name, op) => resolveCollectionWriteRule(c.app, name, op),
		);

		// 4. Build the guest input (request payload + meta) and resolve the broker
		//    URL the SUPERVISOR uses to reach the host broker (server-to-server).
		//    The broker URL comes from CONFIG/ENV ONLY — NEVER from `request.url`,
		//    whose `Host` an attacker controls (token-exfiltration vector).
		const input = await buildEndpointInput(c.request, appId, fn);
		const brokerUrl = resolveBrokerUrl(c.app);

		// 5. Run sandboxed: the executor service mints the per-run scoped token bound
		//    to (capabilities, target) and the supervisor brokers the guest's RPCs.
		const result = await executor.run({
			source: buildEndpointEntrySource(resolved.entrySource, fn),
			input,
			isolation: "sandboxed",
			capabilities: resolved.capabilities,
			appBindings: target,
			brokerUrl,
		});

		return resultToResponse(result);
	});
