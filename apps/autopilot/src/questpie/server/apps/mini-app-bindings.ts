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
 *   - **G1 — files tenant outer-bound.** Every `files.read|write|list`
 *     call is clamped to the app's own surfaces: the guest-READ-ONLY `.app`
 *     bundle `company/apps/{appId}.app/` (code/manifest/UI) and the WRITABLE data
 *     subtree `company/apps/{appId}/data/`. WRITES are confined to the data
 *     subtree ONLY — the `.app` bundle (the app's code + the INLINE manifest, the
 *     capability source on the next run) is NOT app-writable, so a hostile guest
 *     cannot self-escalate by rewriting its own `manifest`. A manifest glob like
 *     `**` or `company/**` therefore CANNOT widen beyond the app's own surfaces —
 *     the broker's per-glob capability check narrows WITHIN the manifest scope,
 *     and this bound intersects it down to the tenant. (Mirrors M6 `app-fs.ts`.
 *     ★ RESOLVED re-keyed the write-ban from `_app/` to the `.app/` bundle.)
 *
 *   - **G2 — non-privileged dispatch.** `collections.X.find|findOne` are
 *     dispatched with `accessMode:"user"` + a principal, NEVER the framework
 *     default `"system"` (which bypasses row-level access rules AND field-level
 *     read masking — see `crud/shared/access-control.ts`). The principal is the
 *     run's real session when present, otherwise a synthesized, deliberately
 *     unprivileged app-principal (see {@link buildAppPrincipalSession}).
 *
 *   - **G3 — relation guard.** `find|findOne` REJECT any `with` / `populate`
 *     argument AND any `where` / `orderBy` that NAMES a relation field of the
 *     target collection. Relation expansion (and a relation-referencing
 *     `where`/`orderBy`, which the CRUD where-builder turns into a raw EXISTS
 *     subquery on the related table with NO access control — a blind boolean
 *     exfiltration ORACLE on an ungranted collection) traverses into other
 *     collections; in the MVP the per-relation target collection is not
 *     independently grant-checked here, so we fail closed and forbid relation
 *     references entirely. The relation field names come from runtime collection
 *     metadata (the SAME `state.relations` set the where-builder keys on); if that
 *     set cannot be determined for a collection we FAIL CLOSED and reject every
 *     `where`/`orderBy` key on it.
 *
 *   - **G4 — the §7 WRITE boundary (Decision 8).** Guest collection WRITES
 *     (`create|update|delete`) are dispatched, but ONLY through a SAFE path:
 *       (a) `document_store` — the namespaced jsonb record store — through a
 *           ROW-FILTER store-grant clamp (NOT the G1 string-prefix path clamp):
 *           every call is confined to the run's GRANTED stores
 *           (`capabilities.data.stores`). READ injects `where.store ∈ grantedRead`;
 *           CREATE forces `store ∈ grantedWrite` + stamps `createdByApp`, rejecting
 *           a client-supplied `store`/`id`/`createdAt`/`createdByApp`; UPDATE/DELETE
 *           blast-radius-contain the `where` to granted stores and strip any
 *           identity/`store` mutation from the patch. Dispatched `accessMode:
 *           "system"` — the store-grant clamp IS the authorization (mirrors G1).
 *       (b) an OTHER collection — ONLY where it has its OWN explicit
 *           `.access().create/update/delete` rule, evaluated under the
 *           non-privileged app-principal (G2 user-mode). A collection that relies
 *           on the framework's rule-less `!!session` fallback gets NO write handler
 *           (the WS-2 critical: the synthesized app-principal satisfies `!!session`,
 *           which would make a write-rule-less collection fully writable). The
 *           explicit-rule check is supplied by `collectionWriteRuleFor`.
 *     `globals.set` stays DENIED (a singleton has no per-tenant boundary).
 *
 * This helper is SHARED: the named-endpoint runner (M4) and the cron runner (M5)
 * both build the target through here, so the enforcement lives in ONE place.
 *
 * Design: `.private/knowledge-miniapps-mvp.md` §13, §14; decision
 * `mini-app-runner-must-impose-tenant-bound-and-non-privileged-principal`.
 */

import { posix } from "node:path";

import { type BindingTarget, DOCUMENT_STORE_COLLECTION } from "questpie/executor";

import {
	type KnowledgeByPathContext,
	type KnowledgeResourceEntry,
	type KnowledgeResourceRecord,
} from "../services/knowledge-resource.js";
import {
	appBundlePrefix,
	appDataPrefix,
	assertValidAppId,
} from "./app-resolver.js";

/**
 * The access context the knowledge bindings dispatch the file-as-DB primitives
 * under. The HOST has ALREADY clamped every path to the app's OWN surfaces (the
 * read-only `.app` bundle + the writable `…/{appId}/data/` subtree; writes to the
 * data subtree only) BEFORE the primitive is called — that clamp (G1) IS the
 * tenant authorization. So the primitive runs in
 * `accessMode:"system"` to read/write the app's OWN already-authorized data
 * WITHOUT the `assets` collection's per-row visibility read rule additionally
 * gating it (that rule filters anonymous reads to `visibility:"public"` rows; the
 * app's own data defaults to `visibility:"private"`, so the synthesized
 * app-principal would otherwise not see it on the shared `assets` collection).
 *
 * This is sound ONLY because every reachable call site here passes a CLAMPED
 * path; an unclamped path NEVER reaches a system-mode dispatch — the clamp
 * returns `null` and the handler rejects with `out_of_scope` first.
 *
 * NOTE: this is DELIBERATELY scoped to the knowledge (own file-as-DB) primitives.
 * The `collections.X.find|findOne` bindings (G2) keep `accessMode:"user"` + the
 * app-principal — those reach ARBITRARY host collections and MUST stay
 * access-controlled.
 */
const KNOWLEDGE_SYSTEM_CONTEXT: KnowledgeByPathContext = {
	accessMode: "system",
};

/**
 * The CRUD context the `document_store` accessor dispatches under (G4). Like the
 * G1 file-as-DB path, `document_store` runs `accessMode:"system"` BECAUSE the
 * store-grant row-filter clamp (forced `where.store ∈ granted`, forced `store`
 * stamp on create, blast-radius containment on update/delete) IS the tenant
 * authorization. The collection's own `.access()` rules gate only the non-mini-app
 * surface and must NOT additionally apply to the already-clamped guest call. This
 * is sound ONLY because every dispatched call here passes through the clamp first.
 */
const DOCUMENT_STORE_SYSTEM_CONTEXT: { accessMode: "system" } = {
	accessMode: "system",
};

/**
 * The minimal `ctx` surface the target needs to dispatch primitive calls. The
 * real `Questpie.AppContext` structurally satisfies this; a test double provides
 * just these members. We depend on the NARROW shape (not the full app context) so
 * the helper stays unit-testable without booting the app.
 */
export interface MiniAppBindingCtx {
	/**
	 * Per-collection CRUD accessors. `find|findOne` are the reads the target
	 * dispatches today. `create|update|delete` (the by-`where` variants, NOT the
	 * `*ById` ones) are typed here because the real `ctx` exposes them and the §7
	 * write boundary will wire them — but {@link buildMiniAppBindingTarget} does NOT
	 * wire the write half yet (guest writes fail closed; see that function + the
	 * broker). All take an optional CRUD context.
	 */
	collections: Record<
		string,
		{
			find?: (args: unknown, context?: unknown) => Promise<unknown>;
			findOne?: (args: unknown, context?: unknown) => Promise<unknown>;
			create?: (args: unknown, context?: unknown) => Promise<unknown>;
			update?: (args: unknown, context?: unknown) => Promise<unknown>;
			delete?: (args: unknown, context?: unknown) => Promise<unknown>;
		}
	>;
	/** Knowledge file-as-DB service (the M6 by-path read/write/list helpers). */
	services: {
		knowledgeResource: {
			readByPath(
				path: string,
				context?: KnowledgeByPathContext,
			): Promise<KnowledgeResourceRecord | null>;
			writeByPath(
				input: {
					path: string;
					body: string;
					title?: string | null;
					contentType?: string | null;
					scopeType?: string | null;
					kind?: string | null;
					source?: string | null;
					sourceRef?: string | null;
					metadata?: Record<string, unknown> | null;
				},
				context?: KnowledgeByPathContext,
			): Promise<KnowledgeResourceRecord>;
			listByPrefix(
				prefix: string,
				context?: KnowledgeByPathContext,
			): Promise<KnowledgeResourceEntry[]>;
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

/** Error thrown by the target on a host-side policy violation (G1/G3/G4). */
export class MiniAppBindingError extends Error {
	constructor(
		message: string,
		readonly code:
			| "out_of_scope"
			| "relation_forbidden"
			| "bad_args"
			/** A `document_store` row/where targets a store NOT granted (G4 row-filter). */
			| "store_forbidden"
			/** A non-document_store write to a collection with NO explicit write rule (G4). */
			| "write_forbidden",
	) {
		super(message);
		this.name = "MiniAppBindingError";
	}
}

/**
 * Normalize an app-supplied knowledge path and reject traversal/absolute paths.
 *
 * CRITICAL: this MUST produce the SAME final path that Knowledge will STORE
 * (`knowledge-resource.ts` `normalizeKnowledgePath`, which runs `posix.normalize`
 * and so collapses `.`/`..` segments). Previously this stripped only a LEADING
 * `./` and rejected `..` WITHOUT `posix.normalize`, so a MID-PATH `./` (e.g.
 * `company/apps/{appId}/./_app/server.ts`) survived the `_app/` write-ban here
 * yet Knowledge collapsed it and persisted under `_app/` (a normalize-here-
 * write-there mismatch — the clamp saw a different path than Knowledge stored).
 *
 * Now we `posix.normalize` FIRST (collapsing every `.`/`..` exactly as Knowledge
 * does) and then re-reject any residual escape, so the clamp + `_app/` ban see
 * the FINAL stored path.
 *
 * @returns the normalized POSIX path, or `null` when unsafe (caller DENIES).
 */
export function normalizeAppPath(raw: unknown): string | null {
	if (typeof raw !== "string" || raw.length === 0) return null;
	if (raw.includes("\0") || raw.includes("\\")) return null;
	if (raw.startsWith("/")) return null;
	// Collapse `.`/`..`/duplicate-slash exactly as Knowledge's stored form does.
	const normalized = posix.normalize(raw.replace(/\/{2,}/g, "/"));
	// Re-reject anything that normalized to an escape or absolute/dot path.
	if (
		!normalized ||
		normalized === "." ||
		normalized === ".." ||
		normalized.startsWith("/") ||
		normalized.startsWith("../") ||
		normalized.includes("/../")
	) {
		return null;
	}
	return normalized;
}

/**
 * Clamp a normalized path to the app's READ bound: it MUST live under EITHER the
 * guest-READ-ONLY `.app` bundle (`company/apps/{appId}.app/`) OR the writable
 * data subtree (`company/apps/{appId}/data/`). Returns the path when in-bound,
 * else `null`.
 *
 * This is the G1 outer-bound for reads. The broker's per-glob capability check
 * runs FIRST (narrowing within the manifest's declared globs); this bound then
 * intersects that down to the tenant's own surfaces, so a manifest `read:["**"]`
 * cannot reach another tenant's bundle/data or company-wide knowledge. The two
 * allowed roots themselves are also listable (no trailing slash).
 */
export function clampReadPath(appId: string, raw: unknown): string | null {
	const pathn = normalizeAppPath(raw);
	if (pathn === null) return null;
	const bundle = appBundlePrefix(appId); // company/apps/{appId}.app/
	const data = appDataPrefix(appId); // company/apps/{appId}/data/
	// Each root itself (no trailing slash) is allowed for listing.
	if (pathn === bundle.slice(0, -1) || pathn === data.slice(0, -1)) return pathn;
	if (pathn.startsWith(bundle) || pathn.startsWith(data)) return pathn;
	return null;
}

/**
 * Clamp a normalized path to the app's WRITE bound: under
 * `company/apps/{appId}/data/` ONLY.
 *
 * This is the G1 outer-bound for writes — the `.app` bundle (the app's code + the
 * INLINE manifest, which is the capability source on the next run) is
 * deliberately NOT app-writable, so a compromised/hostile guest cannot rewrite
 * its own (or, combined with the read bound, any other app's) code/manifest to
 * self-escalate. The data subtree (`{appId}/data/`) and the bundle
 * (`{appId}.app/`) are DISJOINT prefixes, so confining writes to the data subtree
 * structurally bans every `.app/` write. The data-root itself is not writable
 * (only paths strictly under it).
 */
export function clampWritePath(appId: string, raw: unknown): string | null {
	const pathn = normalizeAppPath(raw);
	if (pathn === null) return null;
	const data = appDataPrefix(appId); // company/apps/{appId}/data/
	return pathn.startsWith(data) ? pathn : null;
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

/**
 * Resolver for a collection's relation FIELD NAMES. Returns the set of relation
 * field names of `collectionName` (the SAME `state.relations` keys the CRUD
 * where-builder routes to its raw EXISTS subquery), or `null` when the set cannot
 * be determined — in which case the G3 guard FAILS CLOSED (rejects all
 * `where`/`orderBy` keys on that collection).
 */
export type RelationFieldsResolver = (
	collectionName: string,
) => Set<string> | null;

/**
 * Collect the field keys referenced by an `orderBy` argument. `orderBy` is either
 * an object (`{ field: "asc" }`) or an array of such objects; both are reachable
 * from a JSON guest. (A function form cannot be JSON-serialized by the guest.)
 */
function orderByKeys(orderBy: unknown): string[] {
	if (!orderBy || typeof orderBy !== "object") return [];
	if (Array.isArray(orderBy)) {
		const out: string[] = [];
		for (const entry of orderBy) {
			if (entry && typeof entry === "object" && !Array.isArray(entry)) {
				out.push(...Object.keys(entry as Record<string, unknown>));
			}
		}
		return out;
	}
	return Object.keys(orderBy as Record<string, unknown>);
}

/** Logical `where` combinators whose VALUES are nested `where` clauses to recurse into. */
const WHERE_COMBINATORS = new Set(["AND", "OR", "NOT", "and", "or", "not"]);

/**
 * Walk a `where` clause collecting every field key it references, descending into
 * logical combinators (AND/OR/NOT — array or object form). Combinator keys
 * themselves are not field references.
 */
function collectWhereFieldRefs(where: unknown, out: Set<string>): void {
	if (!where || typeof where !== "object") return;
	if (Array.isArray(where)) {
		for (const entry of where) collectWhereFieldRefs(entry, out);
		return;
	}
	for (const [key, val] of Object.entries(where as Record<string, unknown>)) {
		if (WHERE_COMBINATORS.has(key)) {
			collectWhereFieldRefs(val, out);
			continue;
		}
		out.add(key);
	}
}

/**
 * Reject `find|findOne` args that request relation expansion OR reference a
 * relation field in `where`/`orderBy` (G3).
 *
 * @param relationFields - the target collection's relation field names, or `null`
 *   to FAIL CLOSED (treat the relation set as "unknown" → reject any `where`/
 *   `orderBy` field reference rather than risk a relation-backed oracle).
 */
function assertNoRelationExpansion(
	args: unknown,
	relationFields: Set<string> | null,
): void {
	if (!args || typeof args !== "object" || Array.isArray(args)) return;
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

	// `where`/`orderBy` that NAME a relation route to a raw EXISTS subquery with no
	// access control (oracle). Reject any relation reference; fail closed when the
	// relation set is unknown.
	const whereRefs = new Set<string>();
	if ("where" in a) collectWhereFieldRefs(a.where, whereRefs);
	const orderByRefs = orderByKeys(a.orderBy);
	const referenced = [...whereRefs, ...orderByRefs];

	if (relationFields === null) {
		// Unknown relation set → fail closed: forbid any field reference at all.
		if (referenced.length > 0) {
			throw new MiniAppBindingError(
				"data access denied: the collection's relation set could not be " +
					"determined, so `where`/`orderBy` field references are not permitted",
				"relation_forbidden",
			);
		}
		return;
	}

	for (const key of referenced) {
		if (relationFields.has(key)) {
			throw new MiniAppBindingError(
				`relation reference via \`where\`/\`orderBy\` field "${key}" is not ` +
					"permitted for mini-app data access",
				"relation_forbidden",
			);
		}
	}
}

// ─────────────────── G4: the §7 document_store WRITE boundary ────────────────
//
// `document_store` is the namespaced jsonb record store (Decision 8 + §7). Every
// guest CRUD here is confined to the run's GRANTED stores via a ROW-FILTER clamp
// — a DIFFERENT mechanism from the G1 string-prefix path clamp. The store grants
// come from `capabilities.data.stores`; the broker's coarse check already proved
// SOME store carries the verb before dispatch, so an app with no store grants at
// all never reaches these handlers. Here we narrow to the SPECIFIC granted stores.

/** Resolve the set of `document_store` namespaces granted `verb` to this run. */
function grantedStores(
	stores: Record<string, Array<"read" | "write">> | undefined,
	verb: "read" | "write",
): string[] {
	if (!stores) return [];
	const out: string[] = [];
	for (const name of Object.keys(stores)) {
		// Own-property + array guard (prototype-safe; a `__proto__` key is inert).
		if (!Object.prototype.hasOwnProperty.call(stores, name)) continue;
		const grants = stores[name];
		if (Array.isArray(grants) && grants.includes(verb)) out.push(name);
	}
	return out;
}

/** Meta/identity fields a guest may NEVER set or mutate on a `document_store` row. */
const STORE_PROTECTED_FIELDS = new Set([
	"id",
	"createdAt",
	"updatedAt",
	"deletedAt",
	"createdByApp",
]);

/**
 * AND the guest `where` with a forced `{ store: { in: granted } }` containment so
 * the call can NEVER read/update/delete a row in an ungranted store, regardless of
 * what the guest passed. A `where` that references `store` itself is still ANDed
 * with this clamp, so it can only NARROW within granted stores, never widen.
 */
function clampStoreWhere(
	where: unknown,
	granted: string[],
): Record<string, unknown> {
	const storeFilter = { store: { in: granted } };
	if (where === undefined || where === null) return storeFilter;
	return { AND: [where, storeFilter] };
}

/** A plain object guard (rejects arrays / primitives) for guest-supplied args. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
	return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * Build the `document_store` accessor — the G4 row-filter store-grant clamp.
 *
 * Dispatched `accessMode:"system"` (via {@link DOCUMENT_STORE_SYSTEM_CONTEXT}): the
 * store-grant clamp IS the tenant authorization, exactly as the G1 path clamp is
 * for own-subtree files. The collection's own `.access()` rules gate only the
 * non-mini-app surface, so they must NOT additionally apply here.
 *
 * @param appId - the app whose grants apply (also the `createdByApp` provenance).
 * @param col - the real `document_store` CRUD accessor from `ctx.collections`.
 * @param stores - the run's `capabilities.data.stores` (the granted namespaces).
 */
function buildDocumentStoreAccessor(
	appId: string,
	col: MiniAppBindingCtx["collections"][string],
	stores: Record<string, Array<"read" | "write">> | undefined,
): NonNullable<BindingTarget["collections"]>[string] {
	const readStores = grantedStores(stores, "read");
	const writeStores = grantedStores(stores, "write");

	/** Reject `with`/`populate` (document_store has no relations → empty set). */
	const guardArgs = (args: unknown) =>
		assertNoRelationExpansion(args, new Set<string>());

	const read = (find: NonNullable<typeof col.find>) => async (args: unknown) => {
		if (readStores.length === 0) {
			throw new MiniAppBindingError(
				"document_store read denied: no store granted `read`",
				"store_forbidden",
			);
		}
		const a = isPlainObject(args) ? args : {};
		guardArgs(a);
		// Force the granted-store row filter (overriding any guest `store` in `where`).
		const where = clampStoreWhere(a.where, readStores);
		return find({ ...a, where }, DOCUMENT_STORE_SYSTEM_CONTEXT);
	};

	return {
		find: col.find ? read(col.find) : undefined,
		findOne: col.findOne ? read(col.findOne) : undefined,

		create: col.create
			? async (args: unknown) => {
					if (!isPlainObject(args)) {
						throw new MiniAppBindingError(
							"document_store.create requires an object body",
							"bad_args",
						);
					}
					const store = args.store;
					if (typeof store !== "string" || !writeStores.includes(store)) {
						throw new MiniAppBindingError(
							`document_store.create store "${String(store)}" is not granted ` +
								`\`write\` (granted: ${writeStores.join(",") || "none"})`,
							"store_forbidden",
						);
					}
					if (typeof args.key !== "string" || args.key.length === 0) {
						throw new MiniAppBindingError(
							"document_store.create requires a string `key`",
							"bad_args",
						);
					}
					// Build a CLEAN row: only the four guest-owned fields. Any client
					// `id`/`createdAt`/`createdByApp`/etc. is DROPPED (never spoofable);
					// `createdByApp` is stamped to the writing app (provenance only).
					const row = {
						store,
						key: args.key,
						data: args.data ?? null,
						createdByApp: appId,
					};
					return col.create!(row, DOCUMENT_STORE_SYSTEM_CONTEXT);
				}
			: undefined,

		update: col.update
			? async (args: unknown) => {
					if (writeStores.length === 0) {
						throw new MiniAppBindingError(
							"document_store update denied: no store granted `write`",
							"store_forbidden",
						);
					}
					if (!isPlainObject(args)) {
						throw new MiniAppBindingError(
							"document_store.update requires { where, data }",
							"bad_args",
						);
					}
					guardArgs(args);
					// Strip protected/identity fields AND `store` from the patch so an
					// update can never move a row across stores or forge identity/provenance.
					const patch = isPlainObject(args.data) ? args.data : {};
					const data: Record<string, unknown> = {};
					for (const [k, v] of Object.entries(patch)) {
						if (STORE_PROTECTED_FIELDS.has(k) || k === "store") continue;
						data[k] = v;
					}
					// Blast-radius containment: AND the where with the granted-store filter.
					const where = clampStoreWhere(args.where, writeStores);
					return col.update!({ where, data }, DOCUMENT_STORE_SYSTEM_CONTEXT);
				}
			: undefined,

		delete: col.delete
			? async (args: unknown) => {
					if (writeStores.length === 0) {
						throw new MiniAppBindingError(
							"document_store delete denied: no store granted `write`",
							"store_forbidden",
						);
					}
					const a = isPlainObject(args) ? args : {};
					guardArgs(a);
					// Blast-radius containment: a broad/empty `where` can still only reach
					// rows inside the granted stores.
					const where = clampStoreWhere(a.where, writeStores);
					return col.delete!({ where }, DOCUMENT_STORE_SYSTEM_CONTEXT);
				}
			: undefined,
	};
}

/**
 * Resolve whether collection `name` has its OWN explicit `.access()` rule for the
 * write `op` (G4, the non-document_store path). Returns `true` ONLY when an
 * explicit rule is declared — `false`/absent means the framework would fall back
 * to the rule-less `!!session` default, which the synthesized app-principal
 * satisfies (the WS-2 critical), so the write MUST be denied. Returning `false`
 * when the rule set cannot be determined FAILS CLOSED. The live runner backs this
 * with `app.getCollectionConfig(name).state.access[op]`.
 */
export type CollectionWriteRuleResolver = (
	collectionName: string,
	op: "create" | "update" | "delete",
) => boolean;

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
 * express (G1/G2/G3/G4) and then perform the real primitive call via `ctx`.
 *
 * @param appId - validated app identifier (the `{appId}` path segment).
 * @param ctx - the request app-context (or a structural double).
 * @param capabilities - the run's declared scope. READ here for the G4 write
 *   boundary: `data.stores` supplies the `document_store` namespaces granted to
 *   this run (the row-filter clamp keys on them). The per-glob/per-collection
 *   grant check itself is still the broker's job; the HOST bounds (G1/G2/G3) are
 *   independent of it. A loose/absent value grants no stores (default-deny).
 * @param relationFieldsFor - resolves a collection's relation field names for the
 *   G3 `where`/`orderBy` guard. When omitted, OR when it returns `null` for a
 *   collection, the guard FAILS CLOSED (rejects any `where`/`orderBy` field
 *   reference on that collection). The live runner supplies a resolver backed by
 *   runtime collection metadata.
 * @param collectionWriteRuleFor - resolves whether a NON-`document_store`
 *   collection has its OWN explicit `.access()` rule for a write op (G4). A write
 *   handler is wired ONLY when this returns `true`; absent/`false` ⇒ no write
 *   handler ⇒ the broker fails closed (`not_implemented`), so the rule-less
 *   `!!session` fallback can never be exploited (the WS-2 critical). When omitted,
 *   NO non-document_store write is ever wired (the safe default).
 */
export function buildMiniAppBindingTarget(
	appId: string,
	ctx: MiniAppBindingCtx,
	capabilities?: unknown,
	relationFieldsFor?: RelationFieldsResolver,
	collectionWriteRuleFor?: CollectionWriteRuleResolver,
): BindingTarget {
	// Defense-in-depth: never build a tenant scope / principal from a malformed
	// `appId` (the route validates via `resolveApp`, but M5/cron reuse this helper).
	assertValidAppId(appId);
	const principal = buildAppPrincipalSession(appId, ctx);
	const dispatchContext: MiniAppDispatchContext = {
		accessMode: "user",
		session: principal,
	};

	// The run's granted `document_store` namespaces (G4). Read defensively — a
	// non-object capabilities value yields no stores (default-deny).
	const storeGrants =
		capabilities && typeof capabilities === "object"
			? (capabilities as { data?: { stores?: unknown } }).data?.stores
			: undefined;
	const stores =
		storeGrants && typeof storeGrants === "object"
			? (storeGrants as Record<string, Array<"read" | "write">>)
			: undefined;

	const files: NonNullable<BindingTarget["files"]> = {
		async read(args: unknown) {
			const a = (args ?? {}) as { path?: unknown };
			const path = clampReadPath(appId, a.path);
			if (path === null) {
				throw new MiniAppBindingError(
					`files.read path is outside the app's scope ` +
						`(company/apps/${appId}.app/ or company/apps/${appId}/data/)`,
					"out_of_scope",
				);
			}
			// G1 clamp passed → the path is the app's OWN data; dispatch system-mode
			// (the clamp IS the authorization; the assets collection's user rule
			// must not additionally gate the app's own already-clamped data).
			return ctx.services.knowledgeResource.readByPath(
				path,
				KNOWLEDGE_SYSTEM_CONTEXT,
			);
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
					`files.write path is outside the app's writable scope ` +
						`(company/apps/${appId}/data/ only; the .app bundle is read-only)`,
					"out_of_scope",
				);
			}
			const body = a.body ?? a.content;
			if (typeof body !== "string") {
				throw new MiniAppBindingError(
					"files.write requires a string `body`",
					"bad_args",
				);
			}
			// G1 write-clamp passed (in-subtree AND not under `_app/`) → dispatch
			// system-mode on the app's OWN already-authorized data (see read above).
			return ctx.services.knowledgeResource.writeByPath(
				{
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
				},
				KNOWLEDGE_SYSTEM_CONTEXT,
			);
		},

		async list(args: unknown) {
			const a = (args ?? {}) as { path?: unknown };
			// Default to the app's writable data root when no path is given.
			const requested =
				a.path === undefined || a.path === null || a.path === ""
					? appDataPrefix(appId)
					: a.path;
			const path = clampReadPath(appId, requested);
			if (path === null) {
				throw new MiniAppBindingError(
					`files.list path is outside the app's scope ` +
						`(company/apps/${appId}.app/ or company/apps/${appId}/data/)`,
					"out_of_scope",
				);
			}
			const prefix = path.endsWith("/") ? path : `${path}/`;
			// G1 clamp passed → list the app's OWN subtree under system-mode.
			return ctx.services.knowledgeResource.listByPrefix(
				prefix,
				KNOWLEDGE_SYSTEM_CONTEXT,
			);
		},
	};

	// Per-collection surface. Reads (`find|findOne`) carry the HOST-SIDE invariants
	// the manifest cannot express: user-mode + the run's non-privileged principal
	// (G2 — NEVER system) and the relation guard (G3 — `where`/`orderBy`/relation-
	// expansion). WRITES (`create|update|delete`) are the G4 §7 write boundary
	// (Decision 8) and are wired ONLY through a SAFE path:
	//   • `document_store` → the row-filter store-grant clamp ({@link
	//     buildDocumentStoreAccessor}, system-mode, the clamp IS the authorization).
	//   • an OTHER collection → ONLY when `collectionWriteRuleFor` proves it has its
	//     OWN explicit `.access()` write rule (user-mode + the app-principal, so the
	//     collection's rule actually gates it). A rule-less collection gets NO write
	//     handler → the broker fails closed (`not_implemented`) → the `!!session`
	//     fallback (which the synthesized app-principal satisfies) is NEVER reached.
	//     The G3 guards also apply: reject `with`/`populate` + a relation `where`/
	//     `orderBy` on the create payload / update-delete where.
	//
	// IMPORTANT: this is a PLAIN object with OWN properties — NOT a Proxy. The
	// broker gates dispatch with `Object.prototype.hasOwnProperty.call(cols, name)`
	// (prototype-safety), which consults a Proxy's `getOwnPropertyDescriptor` trap,
	// not its `get`/`has` traps; a bare Proxy would report no own keys and the
	// broker would never dispatch. We build a null-prototype map of own keys so the
	// hasOwnProperty gate passes for real collections and nothing leaks up a chain.
	const collections = Object.create(null) as NonNullable<
		BindingTarget["collections"]
	>;
	for (const name of Object.keys(ctx.collections)) {
		const col = ownCollection(ctx.collections, name);
		if (!col) continue;

		// `document_store` gets the dedicated G4 row-filter store-grant accessor
		// (its own read+write clamp), NOT the generic per-collection read accessor.
		if (name === DOCUMENT_STORE_COLLECTION) {
			collections[name] = buildDocumentStoreAccessor(appId, col, stores);
			continue;
		}

		// Resolve the collection's relation field set ONCE (closed over below). A
		// missing resolver or an unresolved set (`null`) makes the G3 guard fail
		// closed for this collection.
		const relationFields: Set<string> | null = relationFieldsFor
			? relationFieldsFor(name)
			: null;

		/** Wire a write op ONLY if the collection has an explicit `.access()` rule. */
		const wireWrite = (
			op: "create" | "update" | "delete",
			fn: ((args: unknown, ctx?: unknown) => Promise<unknown>) | undefined,
		) => {
			if (!fn) return undefined;
			if (!collectionWriteRuleFor || !collectionWriteRuleFor(name, op)) {
				// No explicit write rule → DENY (fail closed): leaving it unwired makes
				// the broker return `not_implemented`, so the rule-less `!!session`
				// fallback can never make a write-rule-less collection writable.
				return undefined;
			}
			return async (args: unknown) => {
				// G3 write-side guard: reject relation expansion / a relation `where`/
				// `orderBy` smuggled into the write args (same oracle surface as reads).
				assertNoRelationExpansion(args, relationFields);
				return fn(args ?? {}, dispatchContext);
			};
		};

		collections[name] = {
			// Reads (G2 user-mode + G3 `where`/`orderBy`/relation-expansion guard).
			find: col.find
				? async (args: unknown) => {
						assertNoRelationExpansion(args, relationFields);
						return col.find!(args ?? {}, dispatchContext);
					}
				: undefined,
			findOne: col.findOne
				? async (args: unknown) => {
						assertNoRelationExpansion(args, relationFields);
						return col.findOne!(args ?? {}, dispatchContext);
					}
				: undefined,
			// Writes (G4 — wired only with an explicit access rule; user-mode + G3).
			create: wireWrite("create", col.create),
			update: wireWrite("update", col.update),
			delete: wireWrite("delete", col.delete),
		};
	}

	return {
		files,
		collections,
	};
}
