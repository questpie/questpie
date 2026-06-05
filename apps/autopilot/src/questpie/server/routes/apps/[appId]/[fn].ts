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

import { Buffer } from "node:buffer";

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
import { sessionOnly } from "../../../lib/route-access";

/** Broker endpoint path the SUPERVISOR (not the guest) reaches server-to-server. */
const BROKER_PATH = "/api/sandbox/rpc";

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
	/** The app instance (typed `any` on raw route args) — exposes `executor`. */
	app: { executor?: RunnerExecutor };
};

/**
 * Compose the guest entry source that invokes the REQUESTED export of the app
 * entry as the run's `export default`.
 *
 * The executor contract is fixed: the guest must `export default` a
 * `function(input)`. An app entry, however, may expose SEVERAL endpoints (Val
 * Town semantics: `export default` + named exports). To dispatch a specific
 * `{fn}` we wrap — WITHOUT parsing or rewriting the untrusted source — by
 * importing the app module intact from a `data:` URL and selecting the export by
 * name at runtime:
 *
 *   - `data:` imports are runtime-portable: the in-process adapter already loads
 *     the guest via a `data:text/typescript` URL, and Deno permits `data:`
 *     imports WITHOUT `--allow-import` (they are not remote network fetches), so
 *     the nested import works in both isolation modes.
 *   - The app source is base64-encoded HOST-SIDE (full UTF-8 via `Buffer`), so no
 *     escaping/`btoa` Latin-1 pitfalls and the source is embedded verbatim.
 *
 * A wrong `{fn}` (not a function on the module) throws inside the guest, which
 * surfaces as a structured `{ ok:false }` — it cannot escalate privilege (the
 * security boundary is the bindings target + the sandbox, independent of which
 * function runs).
 */
export function buildEndpointEntrySource(
	appSource: string,
	fnName: string,
): string {
	const appDataUrl = `data:application/typescript;base64,${Buffer.from(
		appSource,
		"utf8",
	).toString("base64")}`;
	// `fnName` came from the resolver's inferred endpoint list (already validated
	// against `[A-Za-z0-9_-]`-ish export names), but JSON-encode defensively.
	const fnLiteral = JSON.stringify(fnName);
	const urlLiteral = JSON.stringify(appDataUrl);
	return [
		`const __APP_URL = ${urlLiteral};`,
		`const __FN = ${fnLiteral};`,
		`export default async function __qpEndpoint(input) {`,
		`  const __mod = await import(__APP_URL);`,
		`  const __fn = __FN === "default" ? __mod.default : __mod[__FN];`,
		`  if (typeof __fn !== "function") {`,
		`    throw new Error("mini-app endpoint '" + __FN + "' is not an exported function");`,
		`  }`,
		`  return await __fn(input);`,
		`}`,
	].join("\n");
}

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

		// 2. Confirm `{fn}` is a statically-inferred endpoint export (default-deny).
		//    Cron exports are NOT addressable as HTTP endpoints.
		const endpoint = resolved.endpoints.find((e) => e.name === fn);
		if (!endpoint) {
			throw ApiError.notFound("Mini-app endpoint", `${appId}/${fn}`);
		}

		// 3. Build the HOST-SIDE, tenant-scoped, non-privileged bindings target
		//    (G1 knowledge clamp, G2 user-mode principal, G3 relation guard). This
		//    is the security boundary — never trusts the manifest.
		const target = buildMiniAppBindingTarget(
			appId,
			c as unknown as MiniAppBindingCtx,
			resolved.capabilities,
		);

		// 4. Build the guest input (request payload + meta) and the broker URL the
		//    SUPERVISOR uses to reach the host broker (server-to-server).
		const input = await buildEndpointInput(c.request, appId, fn);
		const brokerUrl = new URL(c.request.url).origin + BROKER_PATH;

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
