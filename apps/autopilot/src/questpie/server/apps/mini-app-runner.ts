/**
 * Mini-app RUNNER helpers — shared by the M4 named-endpoint route and the M5
 * cron schedule trigger.
 *
 * The HOST-SIDE security boundary (G1/G2/G3 + the unprivileged dispatch
 * principal) lives in `mini-app-bindings.ts` `buildMiniAppBindingTarget`. THIS
 * module is the thin glue both untrusted-code entry points reuse so neither
 * forks the security-relevant bits:
 *
 *   - {@link resolveBrokerUrl} — the TRUSTED broker URL the supervisor uses to
 *     reach this app's `…/sandbox/rpc`. Sourced from CONFIG / ENV ONLY, NEVER
 *     from an inbound request `Host`/origin (which is attacker-controllable; a
 *     spoofed `Host` would redirect the supervisor — carrying the per-run token
 *     — to an attacker host). A cron run has no request at all, so this is the
 *     only correct source for it.
 *   - {@link buildEntrySource} — composes the guest `export default` that
 *     imports the app module intact (from a `data:` URL, base64-encoded
 *     host-side) and selects the requested export by name. Works for BOTH HTTP
 *     endpoint exports and cron exports without parsing/rewriting the untrusted
 *     source.
 *   - {@link resolveCollectionRelationFields} — resolves a collection's relation
 *     FIELD NAMES from runtime metadata for the G3 `where`/`orderBy` guard;
 *     fails closed (returns `null`) when the set cannot be determined.
 *
 * Design: `.private/knowledge-miniapps-mvp.md` §8 (M4/M5), §13, §14 and decision
 * `mini-app-runner-must-impose-tenant-bound-and-non-privileged-principal`.
 */

import { Buffer } from "node:buffer";

/**
 * Broker endpoint path the SUPERVISOR (not the guest) reaches server-to-server.
 * Used ONLY to build the safe loopback fallback when no broker URL is configured;
 * the host part NEVER comes from an inbound request (see {@link resolveBrokerUrl}).
 */
const BROKER_PATH = "/api/sandbox/rpc";

/**
 * Loopback fallback used when neither `config.executor.brokerUrl` nor
 * `SANDBOX_BROKER_URL` is set. The supervisor is trusted and CAN reach loopback;
 * this keeps single-host dev working while NEVER trusting any request `Host`.
 */
function defaultLoopbackBrokerUrl(): string {
	return `http://127.0.0.1:${process.env.PORT ?? "3000"}${BROKER_PATH}`;
}

/** The minimal app shape {@link resolveBrokerUrl} reads (config only). */
export interface BrokerUrlAppLike {
	config?: { executor?: { brokerUrl?: string } };
}

/**
 * Resolve the TRUSTED broker URL the supervisor uses to reach this app's
 * `…/sandbox/rpc`. Sourced from CONFIG / ENV ONLY — NEVER from an inbound
 * request's `Host`/origin (which an attacker controls; a spoofed `Host` would
 * redirect the supervisor — carrying the per-run token — to an attacker host).
 *
 * Precedence: `config.executor.brokerUrl` → `SANDBOX_BROKER_URL` → loopback.
 */
export function resolveBrokerUrl(app: BrokerUrlAppLike): string {
	const fromConfig = app.config?.executor?.brokerUrl;
	if (typeof fromConfig === "string" && fromConfig.length > 0) return fromConfig;
	const fromEnv = process.env.SANDBOX_BROKER_URL;
	if (typeof fromEnv === "string" && fromEnv.length > 0) return fromEnv;
	return defaultLoopbackBrokerUrl();
}

/**
 * Compose the guest entry source that invokes the REQUESTED export of the app
 * entry as the run's `export default`.
 *
 * The executor contract is fixed: the guest must `export default` a
 * `function(input)`. An app entry, however, may expose SEVERAL exports (Val
 * Town semantics: `export default` HTTP handler + named HTTP/cron exports). To
 * dispatch a specific export we wrap — WITHOUT parsing or rewriting the
 * untrusted source — by importing the app module intact from a `data:` URL and
 * selecting the export by name at runtime:
 *
 *   - `data:` imports are runtime-portable: the in-process adapter already loads
 *     the guest via a `data:text/typescript` URL, and Deno permits `data:`
 *     imports WITHOUT `--allow-import` (they are not remote network fetches), so
 *     the nested import works in both isolation modes.
 *   - The app source is base64-encoded HOST-SIDE (full UTF-8 via `Buffer`), so no
 *     escaping/`btoa` Latin-1 pitfalls and the source is embedded verbatim.
 *
 * A wrong export name (not a function on the module) throws inside the guest,
 * which surfaces as a structured `{ ok:false }` — it cannot escalate privilege
 * (the security boundary is the bindings target + the sandbox, independent of
 * which function runs).
 */
export function buildEntrySource(appSource: string, fnName: string): string {
	const appDataUrl = `data:application/typescript;base64,${Buffer.from(
		appSource,
		"utf8",
	).toString("base64")}`;
	// `fnName` came from the resolver's inferred export list (already validated
	// against `[A-Za-z0-9_-]`-ish export names), but JSON-encode defensively.
	const fnLiteral = JSON.stringify(fnName);
	const urlLiteral = JSON.stringify(appDataUrl);
	return [
		`const __APP_URL = ${urlLiteral};`,
		`const __FN = ${fnLiteral};`,
		`export default async function __qpEntry(input) {`,
		`  const __mod = await import(__APP_URL);`,
		`  const __fn = __FN === "default" ? __mod.default : __mod[__FN];`,
		`  if (typeof __fn !== "function") {`,
		`    throw new Error("mini-app export '" + __FN + "' is not an exported function");`,
		`  }`,
		`  return await __fn(input);`,
		`}`,
	].join("\n");
}

/** The minimal app shape {@link resolveCollectionRelationFields} reads. */
export interface RelationMetaAppLike {
	getCollectionConfig?: (name: string) => {
		getMeta(): { relations?: string[] };
	};
}

/**
 * Resolve the relation FIELD NAMES of a collection from runtime metadata (the
 * SAME `state.relations` set the CRUD where-builder routes to its raw EXISTS
 * subquery — `query-builders/where-builder.ts`). Used by the G3 guard to reject
 * a `where`/`orderBy` that NAMES a relation (a blind boolean exfiltration oracle
 * on an ungranted collection).
 *
 * Returns `null` when the collection's relation set cannot be determined — the
 * guard then FAILS CLOSED (denies all `where`/`orderBy` keys it can't prove are
 * scalar) rather than risk leaking a relation reference.
 */
export function resolveCollectionRelationFields(
	app: RelationMetaAppLike,
	name: string,
): Set<string> | null {
	const getCfg = app.getCollectionConfig;
	if (typeof getCfg !== "function") return null;
	try {
		const meta = getCfg(name)?.getMeta?.();
		const relations = meta?.relations;
		if (!Array.isArray(relations)) return null;
		return new Set(relations);
	} catch {
		// Unknown collection / metadata unavailable → fail closed.
		return null;
	}
}
