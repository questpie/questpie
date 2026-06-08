import { posix } from "node:path";

import { type AppManifest, parseInlineManifest } from "./manifest.js";
import { scanServerModule } from "./actions-scan.js";
import { scanExports } from "./export-scan.js";

/**
 * App resolver — derives a mini-app from the unified `assets` file store.
 *
 * v2 (`.private/miniapps-v2-design.md` ★ RESOLVED + §2/§3.2/§4): a mini-app is a
 * `.app` FOLDER convention. The bundle is the subtree under
 * `company/apps/{appId}.app/` in the `assets` file store (file-as-DB) — the
 * `.app` suffix marks it (macOS-.app semantics). It contains by convention
 * `server.ts` (REQUIRED: inline `export const manifest` + the opt-in
 * `export const actions` registry + optional cron exports), plus optional
 * `index.html` + `*.jsx` + `assets/*`.
 *
 * This REUSES the v1 subtree read path
 * (`collections.assets.find({ where: { path: { startsWith } } })`), re-keyed:
 *   - off the `.app/` suffix (was `_app/manifest.json`);
 *   - reading the manifest from the INLINE `export const manifest` in `server.ts`
 *     (was a separate `_app/manifest.json` file) — the throw-on-missing-manifest
 *     is DROPPED; a bundle with no `server.ts`/manifest is an `AppResolutionError`;
 *   - reading the HTTP surface from the OPT-IN `export const actions = { … }`
 *     registry, STATICALLY AST-parsed ({@link scanServerModule}), NOT inferred
 *     from "every export" (the corrected Val Town lesson). Cron stays inferred by
 *     name. Framework names are reserved and a collision FAILS CLOSED.
 *
 * The `.app` bundle is guest-READ-ONLY; writable app data lives OUTSIDE it under
 * `company/apps/{appId}/data/**` (see `mini-app-bindings.ts` `clampWritePath`).
 *
 * Reads use the file-store read path under `collections.assets`; this module does
 * NOT touch `services/knowledge-resource.ts` (owned elsewhere).
 */

/** Default server entry filename in the `.app` bundle when the manifest omits `entry`. */
const DEFAULT_ENTRY = "server.ts";

/**
 * Framework-reserved action names. The opt-in `actions` registry MUST NOT expose
 * any of these as an HTTP action, and a cron export MUST NOT shadow one either —
 * the resolver FAILS CLOSED on a collision (Cloudflare-RPC reserved-method
 * lesson). `manifest`/`actions`/`cron` are the framework export contract; `fetch`
 * is the host bridge primitive; `default` is reserved (a default handler is cron,
 * never an HTTP action surface in v2).
 */
export const RESERVED_ACTION_NAMES: ReadonlySet<string> = new Set([
	"manifest",
	"actions",
	"cron",
	"fetch",
	"default",
]);

/**
 * Minimal structural shape of an `assets` file-store record the resolver
 * consumes. The real `ctx.collections.assets.find` returns wider rows; this is
 * the subset we read, so test doubles only need to provide these fields.
 */
export interface KnowledgeRecordLike {
	path?: string | null;
	body?: string | null;
}

/** Result shape of `collections.assets.find(...)`. */
export interface KnowledgeFindResult {
	docs: KnowledgeRecordLike[];
}

/**
 * The dependency the resolver needs: just `assets.find`. `ctx.collections`
 * structurally satisfies this, and a test double can provide it directly.
 */
export interface AppResolverCollections {
	assets: {
		find(args: {
			where: { path: { startsWith: string } };
			limit?: number;
		}): Promise<KnowledgeFindResult>;
	};
}

/** A statically-resolved HTTP action exposed by the opt-in `actions` registry. */
export interface ResolvedEndpoint {
	/** Action name = the registry key (the `{action}` path segment). */
	name: string;
	/**
	 * Always `false` in v2 — `export default` is RESERVED (treated as cron, never
	 * an HTTP action). Kept for wire/shape compatibility with the runner + route.
	 */
	isDefault: boolean;
	/**
	 * True iff this action was declared via `defineAction({ input: … })` — the
	 * host-visible signal that the action carries an input schema. Statically
	 * detected; the schema object itself is NOT readable without executing the
	 * guest (see the task report on host-side validation).
	 */
	hasInputSchema: boolean;
}

/** A statically-inferred scheduled (cron) handler exposed by the app entry. */
export interface ResolvedCron {
	/** Export name of the cron handler (e.g. `cron`, `cronDigest`). */
	name: string;
}

/** Fully resolved app: manifest, capabilities, entry source, action/cron surface. */
export interface ResolvedApp {
	appId: string;
	/** File path prefix of the `.app` bundle the app was read from. */
	pathPrefix: string;
	manifest: AppManifest;
	/** Convenience alias of `manifest.capabilities`. */
	capabilities: AppManifest["capabilities"];
	/** File path of the resolved server entry inside the `.app` bundle. */
	entryPath: string;
	/** Raw server entry source (TypeScript). */
	entrySource: string;
	/** HTTP actions read from the opt-in `actions` registry. */
	endpoints: ResolvedEndpoint[];
	/** Cron handlers inferred from the entry exports by name. */
	crons: ResolvedCron[];
}

/** Error thrown when an app cannot be resolved from the file store. */
export class AppResolutionError extends Error {
	constructor(
		message: string,
		readonly appId: string,
	) {
		super(message);
		this.name = "AppResolutionError";
	}
}

/**
 * Allowed `appId` charset: a lowercase DNS-label-like slug. MUST start with an
 * alphanumeric and contain only `[a-z0-9-]` thereafter.
 *
 * Constraining this is security-relevant: `appId` is interpolated into the file
 * path prefix (`company/apps/{appId}.app/`) AND into the synthesized,
 * unprivileged dispatch principal id (`app:{appId}` — see
 * `mini-app-bindings.ts` `buildAppPrincipalSession`). A loose charset could let a
 * crafted `appId` (uppercase, `:`/`/`, path tricks) collide with or inject a real
 * user id, or smuggle path segments. The slug form makes `app:{appId}` a
 * disjoint, non-resolvable namespace.
 */
const APP_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Validate an `appId` against {@link APP_ID_RE}. Throws {@link AppResolutionError}
 * on a malformed id. Call this BEFORE using `appId` to build paths or principals.
 */
export function assertValidAppId(appId: unknown): asserts appId is string {
	if (typeof appId !== "string" || !APP_ID_RE.test(appId)) {
		throw new AppResolutionError(
			`Invalid appId: ${JSON.stringify(appId)} (must match ${APP_ID_RE})`,
			typeof appId === "string" ? appId : String(appId),
		);
	}
}

/**
 * Path prefix of an app's `.app` bundle subtree: `company/apps/{appId}.app/`.
 * This is the guest-READ-ONLY code/manifest/UI subtree.
 */
export function appBundlePrefix(appId: string): string {
	return `company/apps/${appId}.app/`;
}

/**
 * Path prefix of an app's WRITABLE data subtree: `company/apps/{appId}/data/`.
 * This lives OUTSIDE the `.app` bundle (★ RESOLVED) so a guest can never write
 * its own code/manifest. Note `{appId}/data/` and `{appId}.app/` are DISJOINT
 * prefixes — a write confined here can never reach the bundle.
 */
export function appDataPrefix(appId: string): string {
	return `company/apps/${appId}/data/`;
}

/**
 * Classify exports into the cron surface (cron stays inferred by name in v2).
 *
 * Convention (§3.2): an export named `cron` (or `cron`-prefixed, e.g.
 * `cronDigest`) = scheduled. Cron has NO HTTP exposure, so inference by name is
 * safe (unlike the HTTP surface, which is opt-in via `actions`). `export default`
 * is RESERVED and treated as a cron-style handler, never an HTTP action.
 */
function classifyCrons(source: string): ResolvedCron[] {
	const { named } = scanExports(source);
	const isCron = (name: string) => /^cron($|[A-Z_])/.test(name);
	const crons: ResolvedCron[] = [];
	for (const name of named) {
		if (isCron(name)) crons.push({ name });
	}
	return crons;
}

/**
 * Resolve the OPT-IN HTTP action surface + the cron surface from a `server.ts`,
 * failing closed on anything the static parse cannot prove safe.
 *
 * @throws {AppResolutionError} when `actions` is missing/non-literal/uses
 *   spread/computed keys, or when any action key OR cron name collides with a
 *   reserved framework name.
 */
function resolveSurface(
	appId: string,
	source: string,
): { endpoints: ResolvedEndpoint[]; crons: ResolvedCron[] } {
	const scanned = scanServerModule(source);

	// The HTTP surface MUST be an explicit, statically-knowable object literal.
	if (!scanned.hasActionsExport) {
		throw new AppResolutionError(
			`App "${appId}" server entry has no opt-in \`export const actions = { … }\` ` +
				"registry (the HTTP surface is opt-in; no export is HTTP-callable without it)",
			appId,
		);
	}
	if (!scanned.actionsIsLiteral) {
		throw new AppResolutionError(
			`App "${appId}" \`export const actions\` must be a plain object literal ` +
				"(its keys are read statically; a dynamic value is rejected)",
			appId,
		);
	}
	if (scanned.hadSpread || scanned.hadComputed) {
		throw new AppResolutionError(
			`App "${appId}" \`export const actions\` uses a spread or computed key; ` +
				"the action surface must be fully static (fail-closed)",
			appId,
		);
	}

	// Reserved-name collision FAILS CLOSED (Cloudflare-RPC reserved-method lesson).
	for (const key of scanned.actionKeys) {
		if (RESERVED_ACTION_NAMES.has(key)) {
			throw new AppResolutionError(
				`App "${appId}" action "${key}" collides with a reserved framework name ` +
					`(${[...RESERVED_ACTION_NAMES].join(", ")}); rename it`,
				appId,
			);
		}
	}

	const crons = classifyCrons(source);
	const cronNames = new Set(crons.map((c) => c.name));
	// An action key MUST NOT also be a cron export name — a single name cannot be
	// both an HTTP action and a scheduled handler (ambiguous dispatch). Fail closed.
	for (const key of scanned.actionKeys) {
		if (cronNames.has(key)) {
			throw new AppResolutionError(
				`App "${appId}" name "${key}" is both an action and a cron export; ` +
					"a name cannot be both — rename one",
				appId,
			);
		}
	}

	// De-dupe keys (a literal can repeat a key; the last wins at runtime, but the
	// HTTP surface is a set) and join the `defineAction` input-schema signal.
	const seen = new Set<string>();
	const endpoints: ResolvedEndpoint[] = [];
	for (const key of scanned.actionKeys) {
		if (seen.has(key)) continue;
		seen.add(key);
		endpoints.push({
			name: key,
			isDefault: false,
			hasInputSchema: scanned.defineActionInputByVar[key] === true,
		});
	}

	return { endpoints, crons };
}

/**
 * Resolve an app from the `assets` file store.
 *
 * @param appId - App identifier (the `{appId}` path segment).
 * @param collections - file-store read access (`ctx.collections` or a double).
 * @returns The {@link ResolvedApp}.
 * @throws {AppResolutionError} when the `.app` bundle, its `server.ts`, the inline
 *   manifest, or the opt-in `actions` registry is missing/invalid, or a reserved
 *   name collides.
 * @throws {z.ZodError} when the inline manifest is present but structurally invalid.
 */
export async function resolveApp(
	appId: string,
	collections: AppResolverCollections,
): Promise<ResolvedApp> {
	assertValidAppId(appId);

	const pathPrefix = appBundlePrefix(appId);
	const result = await collections.assets.find({
		where: { path: { startsWith: pathPrefix } },
	});

	// Index the `.app` subtree by path (no leading slash) for O(1) lookups.
	const byPath = new Map<string, string>();
	for (const doc of result.docs) {
		if (typeof doc.path === "string") {
			byPath.set(doc.path, doc.body ?? "");
		}
	}

	if (byPath.size === 0) {
		throw new AppResolutionError(
			`App "${appId}" has no .app bundle at ${pathPrefix}`,
			appId,
		);
	}

	// The server entry holds the inline manifest + the opt-in actions registry.
	// (We must read the entry FIRST to extract the manifest, hence we resolve the
	// default entry path; a manifest `entry` override is read AFTER, below.)
	const defaultEntryPath = posix.join(pathPrefix, DEFAULT_ENTRY);
	let entryPath = defaultEntryPath;
	let entrySource = byPath.get(entryPath);
	if (entrySource === undefined) {
		throw new AppResolutionError(
			`App "${appId}" .app bundle has no server entry at ${entryPath}`,
			appId,
		);
	}

	// Extract + re-validate the INLINE manifest from the entry on EVERY resolve
	// (★ RESOLVED §2: the manifest is re-derived + re-validated every run — it is
	// the capability source and must never be trusted from a stale read).
	let manifest = parseInlineManifest(entrySource);

	// Honor a manifest `entry` override (the real entry may not be `server.ts`).
	// The manifest itself, however, was declared in `server.ts`, so we keep using
	// `server.ts` as the manifest source and only re-point the EXECUTED entry.
	if (manifest.entry && manifest.entry !== DEFAULT_ENTRY) {
		const overridePath = posix.join(pathPrefix, manifest.entry);
		const overrideSource = byPath.get(overridePath);
		if (overrideSource === undefined) {
			throw new AppResolutionError(
				`App "${appId}" manifest entry not found at ${overridePath}`,
				appId,
			);
		}
		entryPath = overridePath;
		entrySource = overrideSource;
		// Re-extract the manifest from the overridden entry so the inline manifest
		// and the executed code are the SAME module (no split-source capability gap).
		manifest = parseInlineManifest(entrySource);
	}

	const { endpoints, crons } = resolveSurface(appId, entrySource);

	return {
		appId,
		pathPrefix,
		manifest,
		capabilities: manifest.capabilities,
		entryPath,
		entrySource,
		endpoints,
		crons,
	};
}
