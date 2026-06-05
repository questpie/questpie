/**
 * Mini-app bindings TARGET — the HOST-SIDE security boundary for UNTRUSTED apps.
 *
 * The sandbox bindings broker (`questpie/executor` → `SandboxBroker`) is correct,
 * fail-closed framework infra, but it is DORMANT and app-agnostic: it faithfully
 * enforces whatever capability scope + primitive {@link BindingTarget} it is
 * handed. It CANNOT impose a tenant bound it is not told about, and it dispatches
 * to the target with whatever `accessMode` the target itself uses.
 *
 * So the real security boundary for untrusted mini-app code is THIS module — the
 * RUNNER that builds the `BindingTarget` the broker dispatches to. Everything
 * here is enforced HOST-SIDE and NEVER trusts the manifest:
 *
 *   - **G1 — knowledge tenant outer-bound.** Every `knowledge.read|write|list`
 *     call is clamped to the app's own subtree `company/apps/{appId}/`. WRITES
 *     are additionally forbidden anywhere under `_app/` (the app's code +
 *     manifest are NOT app-writable). A manifest glob like `**` or `company/**`
 *     therefore CANNOT widen beyond the app's own subtree — the broker's
 *     per-glob capability check narrows WITHIN the manifest scope, and this bound
 *     intersects it down to the tenant subtree. (Mirrors M6 `app-fs.ts`.)
 *
 *   - **G2 — non-privileged dispatch.** `collections.X.find|findOne` are
 *     dispatched with `accessMode:"user"` + a principal, NEVER the framework
 *     default `"system"` (which bypasses row-level access rules AND field-level
 *     read masking — see `crud/shared/access-control.ts`). The principal is the
 *     run's real session when present, otherwise a synthesized, deliberately
 *     unprivileged app-principal (see {@link buildAppPrincipalSession}).
 *
 *   - **G3 — relation guard.** `find|findOne` REJECT any `with` / `populate`
 *     argument. Relation expansion traverses into other collections; in the MVP
 *     the per-relation target collection is not independently grant-checked here,
 *     so we fail closed and forbid expansion entirely rather than risk an allowed
 *     collection's relations leaking a forbidden one. (User-mode dispatch is also
 *     in force, so even were a relation resolved it would carry access control —
 *     but a public-read collection NOT in the manifest could still leak, hence the
 *     outright deny.)
 *
 * This helper is SHARED: the named-endpoint runner (M4) and the cron runner (M5)
 * both build the target through here, so the enforcement lives in ONE place.
 *
 * Design: `.private/knowledge-miniapps-mvp.md` §13, §14; decision
 * `mini-app-runner-must-impose-tenant-bound-and-non-privileged-principal`.
 */

import type { BindingTarget } from "questpie/executor";

import {
	type KnowledgeResourceEntry,
	type KnowledgeResourceRecord,
} from "../services/knowledge-resource.js";
import { appPathPrefix } from "./app-resolver.js";

/**
 * The minimal `ctx` surface the target needs to dispatch primitive calls. The
 * real `Questpie.AppContext` structurally satisfies this; a test double provides
 * just these members. We depend on the NARROW shape (not the full app context) so
 * the helper stays unit-testable without booting the app.
 */
export interface MiniAppBindingCtx {
	/** Per-collection read accessors. `find|findOne` take an optional CRUD context. */
	collections: Record<
		string,
		{
			find?: (args: unknown, context?: unknown) => Promise<unknown>;
			findOne?: (args: unknown, context?: unknown) => Promise<unknown>;
		}
	>;
	/** Knowledge file-as-DB service (the M6 by-path read/write/list helpers). */
	services: {
		knowledgeResource: {
			readByPath(path: string): Promise<KnowledgeResourceRecord | null>;
			writeByPath(input: {
				path: string;
				body: string;
				title?: string | null;
				contentType?: string | null;
				scopeType?: string | null;
				kind?: string | null;
				source?: string | null;
				sourceRef?: string | null;
				metadata?: Record<string, unknown> | null;
			}): Promise<KnowledgeResourceRecord>;
			listByPrefix(prefix: string): Promise<KnowledgeResourceEntry[]>;
		};
	};
	/**
	 * The run's auth session, when the run was triggered by an authenticated
	 * request. `null`/`undefined` ⇒ no real principal (a synthesized app-principal
	 * is used instead). Typed loosely so a test double can pass a bare shape.
	 */
	session?: { user?: { id?: string | null } | null } | null;
}

/** The CRUD context the target threads into `collections.X.find|findOne`. */
export interface MiniAppDispatchContext {
	/**
	 * ALWAYS `"user"` for untrusted apps — `"system"` bypasses all access control.
	 */
	accessMode: "user";
	/** The principal whose access rules gate every dispatched read. */
	session: { user: { id: string }; session: Record<string, unknown> } | null;
}

/** Error thrown by the target on a host-side policy violation (G1/G3). */
export class MiniAppBindingError extends Error {
	constructor(
		message: string,
		readonly code: "out_of_scope" | "relation_forbidden" | "bad_args",
	) {
		super(message);
		this.name = "MiniAppBindingError";
	}
}

/** `company/apps/{appId}/_app/` — the app's code/manifest dir (never writable). */
function appCodePrefix(appId: string): string {
	return `${appPathPrefix(appId)}_app/`;
}

/**
 * Normalize an app-supplied knowledge path and reject traversal/absolute paths.
 *
 * Mirrors the broker's `normalizeKnowledgePath` semantics (reject `..`, leading
 * `/`, NUL, backslash) WITHOUT resolving `..` (which would mask an escape). We
 * keep a local copy rather than importing the broker's so this module owns its
 * own containment invariant explicitly (defense in depth — the broker's
 * capability check already runs its own normalize before glob-matching).
 *
 * @returns the normalized POSIX path, or `null` when unsafe (caller DENIES).
 */
export function normalizeAppPath(raw: unknown): string | null {
	if (typeof raw !== "string" || raw.length === 0) return null;
	if (raw.includes("\0") || raw.includes("\\")) return null;
	if (raw.startsWith("/")) return null;
	const collapsed = raw.replace(/\/{2,}/g, "/").replace(/^\.\//, "");
	for (const segment of collapsed.split("/")) {
		if (segment === "..") return null;
	}
	return collapsed;
}

/**
 * Clamp a normalized path to the app's READ bound: it MUST live under
 * `company/apps/{appId}/`. Returns the path when in-bound, else `null`.
 *
 * This is the G1 outer-bound for reads. The broker's per-glob capability check
 * runs FIRST (narrowing within the manifest's declared globs); this bound then
 * intersects that down to the tenant's own subtree, so a manifest `read:["**"]`
 * cannot reach another tenant's tree or company-wide knowledge.
 */
export function clampReadPath(appId: string, raw: unknown): string | null {
	const pathn = normalizeAppPath(raw);
	if (pathn === null) return null;
	const prefix = appPathPrefix(appId); // company/apps/{appId}/
	// The subtree root itself (no trailing slash) is allowed for listing.
	if (pathn === prefix.slice(0, -1)) return pathn;
	return pathn.startsWith(prefix) ? pathn : null;
}

/**
 * Clamp a normalized path to the app's WRITE bound: under
 * `company/apps/{appId}/` AND NOT under `company/apps/{appId}/_app/`.
 *
 * This is the G1 outer-bound for writes — the app's code/manifest (`_app/`) are
 * deliberately NOT app-writable, so a compromised/hostile guest cannot rewrite
 * its own (or, combined with the read bound, any other app's) code or manifest.
 */
export function clampWritePath(appId: string, raw: unknown): string | null {
	const pathn = clampReadPath(appId, raw);
	if (pathn === null) return null;
	if (pathn === appCodePrefix(appId).slice(0, -1)) return null; // the _app dir itself
	if (pathn.startsWith(appCodePrefix(appId))) return null; // anything under _app/
	return pathn;
}

/**
 * Build the auth-session principal for G2 dispatch.
 *
 * - When the run carries a REAL authenticated session (named-endpoint hit by a
 *   logged-in user), reuse that exact principal so reads are gated by THAT user's
 *   access rules — the app can never see more than its invoker.
 * - Otherwise synthesize a CONSTRAINED app-principal: a non-system session whose
 *   user id is a stable, namespaced, NON-resolvable id `app:{appId}`. It is NOT a
 *   real user row, so:
 *     * `accessMode:"user"` access rules that gate on a specific user/role will
 *       NOT match it (default-deny: a collection with no public `read:true` rule
 *       falls back to "require session" — satisfied — but any rule keyed on user
 *       identity/ownership fails, and field-level masking applies);
 *     * it can NEVER be `"system"`, so row-level + field-level access control is
 *       always evaluated.
 *   This is intentionally minimal: the app gets "an authenticated-but-anonymous
 *   caller" view, never a privileged one.
 */
export function buildAppPrincipalSession(
	appId: string,
	ctx: MiniAppBindingCtx,
): MiniAppDispatchContext["session"] {
	const realUserId = ctx.session?.user?.id;
	if (typeof realUserId === "string" && realUserId.length > 0) {
		// Reuse the real principal verbatim (already access-gated to this user).
		return {
			user: { id: realUserId },
			session: { source: "mini-app", appId },
		};
	}
	// Synthesized constrained app-principal — explicitly NOT a real user, NOT system.
	return {
		user: { id: `app:${appId}` },
		session: { source: "mini-app", appId, synthetic: true },
	};
}

/** Reject `find|findOne` args that request relation expansion (G3). */
function assertNoRelationExpansion(args: unknown): void {
	if (args && typeof args === "object" && !Array.isArray(args)) {
		const a = args as Record<string, unknown>;
		if ("with" in a && a.with !== undefined) {
			throw new MiniAppBindingError(
				"relation expansion via `with` is not permitted for mini-app data access",
				"relation_forbidden",
			);
		}
		if ("populate" in a && a.populate !== undefined) {
			throw new MiniAppBindingError(
				"relation expansion via `populate` is not permitted for mini-app data access",
				"relation_forbidden",
			);
		}
	}
}

/** Own-property collection lookup (prototype-safe; never reaches up the chain). */
function ownCollection(
	collections: MiniAppBindingCtx["collections"],
	name: string,
): MiniAppBindingCtx["collections"][string] | undefined {
	return Object.prototype.hasOwnProperty.call(collections, name)
		? collections[name]
		: undefined;
}

/**
 * Build the capability-scoped {@link BindingTarget} the broker dispatches an
 * UNTRUSTED app's in-scope binding RPCs to.
 *
 * The broker has ALREADY authenticated the per-run token and enforced the
 * manifest `capabilities` (default-deny) BEFORE it ever calls a handler here.
 * These handlers add the HOST-SIDE invariants the manifest cannot be trusted to
 * express (G1/G2/G3) and then perform the real primitive call via `ctx`.
 *
 * @param appId - validated app identifier (the `{appId}` path segment).
 * @param ctx - the request app-context (or a structural double).
 * @param _capabilities - the run's declared scope. Accepted for signature
 *   symmetry with the broker/M5 and to document that enforcement is by-call; the
 *   per-glob/per-collection grant check is the broker's job, so this is not read
 *   here. The HOST bound (G1/G2/G3) is independent of it and always applied.
 */
export function buildMiniAppBindingTarget(
	appId: string,
	ctx: MiniAppBindingCtx,
	_capabilities?: unknown,
): BindingTarget {
	const principal = buildAppPrincipalSession(appId, ctx);
	const dispatchContext: MiniAppDispatchContext = {
		accessMode: "user",
		session: principal,
	};

	const knowledge: NonNullable<BindingTarget["knowledge"]> = {
		async read(args: unknown) {
			const a = (args ?? {}) as { path?: unknown };
			const path = clampReadPath(appId, a.path);
			if (path === null) {
				throw new MiniAppBindingError(
					`knowledge.read path is outside the app's tenant scope (company/apps/${appId}/)`,
					"out_of_scope",
				);
			}
			return ctx.services.knowledgeResource.readByPath(path);
		},

		async write(args: unknown) {
			const a = (args ?? {}) as {
				path?: unknown;
				body?: unknown;
				content?: unknown;
				contentType?: unknown;
				title?: unknown;
			};
			const path = clampWritePath(appId, a.path);
			if (path === null) {
				throw new MiniAppBindingError(
					`knowledge.write path is outside the app's writable scope ` +
						`(company/apps/${appId}/, excluding _app/)`,
					"out_of_scope",
				);
			}
			const body = a.body ?? a.content;
			if (typeof body !== "string") {
				throw new MiniAppBindingError(
					"knowledge.write requires a string `body`",
					"bad_args",
				);
			}
			return ctx.services.knowledgeResource.writeByPath({
				path,
				body,
				title: typeof a.title === "string" ? a.title : undefined,
				contentType:
					typeof a.contentType === "string" ? a.contentType : undefined,
				scopeType: "company",
				kind: "document",
				source: "system",
				sourceRef: `app:${appId}`,
				metadata: { app: appId },
			});
		},

		async list(args: unknown) {
			const a = (args ?? {}) as { path?: unknown };
			// Default to the app's data root when no path is given.
			const requested =
				a.path === undefined || a.path === null || a.path === ""
					? appPathPrefix(appId)
					: a.path;
			const path = clampReadPath(appId, requested);
			if (path === null) {
				throw new MiniAppBindingError(
					`knowledge.list path is outside the app's tenant scope (company/apps/${appId}/)`,
					"out_of_scope",
				);
			}
			const prefix = path.endsWith("/") ? path : `${path}/`;
			return ctx.services.knowledgeResource.listByPrefix(prefix);
		},
	};

	// Per-collection read surface. The broker only dispatches `find|findOne`, and
	// only for collections the manifest granted `read` (its capability check runs
	// BEFORE dispatch). Each accessor here forces user-mode + principal (G2) and
	// denies relation expansion (G3).
	//
	// IMPORTANT: this is a PLAIN object with OWN properties — NOT a Proxy. The
	// broker gates dispatch with `Object.prototype.hasOwnProperty.call(cols, name)`
	// (prototype-safety), which consults a Proxy's `getOwnPropertyDescriptor` trap,
	// not its `get`/`has` traps; a bare Proxy would report no own keys and the
	// broker would never dispatch. We build a null-prototype map of own keys so the
	// hasOwnProperty gate passes for real collections and nothing leaks up a chain.
	const collections = Object.create(null) as Record<
		string,
		{
			find?: (args: unknown) => Promise<unknown>;
			findOne?: (args: unknown) => Promise<unknown>;
		}
	>;
	for (const name of Object.keys(ctx.collections)) {
		const col = ownCollection(ctx.collections, name);
		if (!col) continue;
		collections[name] = {
			find: col.find
				? async (args: unknown) => {
						assertNoRelationExpansion(args);
						return col.find!(args ?? {}, dispatchContext);
					}
				: undefined,
			findOne: col.findOne
				? async (args: unknown) => {
						assertNoRelationExpansion(args);
						return col.findOne!(args ?? {}, dispatchContext);
					}
				: undefined,
		};
	}

	return {
		knowledge,
		collections: collections as NonNullable<BindingTarget["collections"]>,
	};
}
