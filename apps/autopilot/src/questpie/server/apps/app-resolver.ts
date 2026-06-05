import { posix } from "node:path";

import { type AppManifest, parseAppManifest } from "./manifest.js";
import { scanExports } from "./export-scan.js";

/**
 * App resolver — derives a mini-app from the Knowledge tree.
 *
 * An "app" is NOT a collection; it is the subtree under
 * `company/apps/{appId}/` in Knowledge (file-as-DB). The resolver reads that
 * subtree, parses `_app/manifest.json`, loads the server entry source, and
 * infers the endpoint/cron surface from the entry's exports.
 *
 * Design: `.private/knowledge-miniapps-mvp.md` §8 (M3), §11.4, §14 and
 * `.private/knowledge-path-conventions.md` §2.
 *
 * Reads use the EXISTING knowledge read path
 * (`collections.knowledge.find({ where: { path: { startsWith } } })`) — this
 * module does NOT touch `services/knowledge-resource.ts` (owned elsewhere).
 */

/** Default server entry filename under `_app/` when the manifest omits `entry`. */
const DEFAULT_ENTRY = "server.ts";

/** Manifest filename under `_app/`. */
const MANIFEST_FILE = "manifest.json";

/**
 * Minimal structural shape of a Knowledge record the resolver consumes. The
 * real `ctx.collections.knowledge.find` returns wider rows; this is the subset
 * we read, so test doubles only need to provide these fields.
 */
export interface KnowledgeRecordLike {
	path?: string | null;
	body?: string | null;
}

/** Result shape of `collections.knowledge.find(...)`. */
export interface KnowledgeFindResult {
	docs: KnowledgeRecordLike[];
}

/**
 * The dependency the resolver needs: just `knowledge.find`. `ctx.collections`
 * structurally satisfies this, and a test double can provide it directly.
 */
export interface AppResolverCollections {
	knowledge: {
		find(args: {
			where: { path: { startsWith: string } };
			limit?: number;
		}): Promise<KnowledgeFindResult>;
	};
}

/** A statically-inferred HTTP endpoint exposed by the app entry. */
export interface ResolvedEndpoint {
	/** Endpoint name. `"default"` is the `export default` handler. */
	name: string;
	/** True for the `export default` handler. */
	isDefault: boolean;
}

/** A statically-inferred scheduled (cron) handler exposed by the app entry. */
export interface ResolvedCron {
	/** Export name of the cron handler (e.g. `cron`, `cronDigest`). */
	name: string;
}

/** Fully resolved app: manifest, capabilities, entry source, inferred surface. */
export interface ResolvedApp {
	appId: string;
	/** Knowledge path prefix the app was read from. */
	pathPrefix: string;
	manifest: AppManifest;
	/** Convenience alias of `manifest.capabilities`. */
	capabilities: AppManifest["capabilities"];
	/** Knowledge path of the resolved server entry. */
	entryPath: string;
	/** Raw server entry source (TypeScript). */
	entrySource: string;
	/** HTTP endpoints inferred from the entry exports. */
	endpoints: ResolvedEndpoint[];
	/** Cron handlers inferred from the entry exports. */
	crons: ResolvedCron[];
}

/** Error thrown when an app cannot be resolved from the Knowledge tree. */
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
 * Constraining this is security-relevant: `appId` is interpolated into the
 * Knowledge path prefix (`company/apps/{appId}/`) AND into the synthesized,
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

/** Knowledge path prefix for an app's subtree: `company/apps/{appId}/`. */
export function appPathPrefix(appId: string): string {
	return `company/apps/${appId}/`;
}

/**
 * Classify exports into the endpoint/cron surface.
 *
 * Convention (§11.4): `export default` = HTTP handler; an export named `cron`
 * (or `cron`-prefixed, e.g. `cronDigest`) = scheduled. Remaining named exports
 * are additional named HTTP endpoints (Val Town allows several per module).
 */
function classifyExports(source: string): {
	endpoints: ResolvedEndpoint[];
	crons: ResolvedCron[];
} {
	const { hasDefault, named } = scanExports(source);
	const isCron = (name: string) => /^cron($|[A-Z_])/.test(name);

	const endpoints: ResolvedEndpoint[] = [];
	if (hasDefault) endpoints.push({ name: "default", isDefault: true });

	const crons: ResolvedCron[] = [];
	for (const name of named) {
		if (isCron(name)) crons.push({ name });
		else endpoints.push({ name, isDefault: false });
	}

	return { endpoints, crons };
}

/**
 * Resolve an app from the Knowledge tree.
 *
 * @param appId - App identifier (the `{appId}` path segment).
 * @param collections - Knowledge read access (`ctx.collections` or a double).
 * @returns The {@link ResolvedApp}.
 * @throws {AppResolutionError} when the manifest or entry is missing.
 * @throws {Error} (zod/JSON) when the manifest is present but invalid.
 */
export async function resolveApp(
	appId: string,
	collections: AppResolverCollections,
): Promise<ResolvedApp> {
	assertValidAppId(appId);

	const pathPrefix = appPathPrefix(appId);
	const result = await collections.knowledge.find({
		where: { path: { startsWith: pathPrefix } },
	});

	// Index the subtree by path (normalized, no leading slash) for O(1) lookups.
	const byPath = new Map<string, string>();
	for (const doc of result.docs) {
		if (typeof doc.path === "string") {
			byPath.set(doc.path, doc.body ?? "");
		}
	}

	const manifestPath = posix.join(pathPrefix, "_app", MANIFEST_FILE);
	const manifestRaw = byPath.get(manifestPath);
	if (manifestRaw === undefined) {
		throw new AppResolutionError(
			`App "${appId}" has no manifest at ${manifestPath}`,
			appId,
		);
	}

	const manifest = parseAppManifest(manifestRaw);

	const entryRelative = manifest.entry ?? DEFAULT_ENTRY;
	const entryPath = posix.join(pathPrefix, "_app", entryRelative);
	const entrySource = byPath.get(entryPath);
	if (entrySource === undefined) {
		throw new AppResolutionError(
			`App "${appId}" entry not found at ${entryPath}`,
			appId,
		);
	}

	const { endpoints, crons } = classifyExports(entrySource);

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
