import { z } from "zod";

import type { ExecutorCapabilities } from "questpie/executor";

/**
 * App manifest schema — `_app/manifest.json` (renderer `manifest-v1`).
 *
 * Design: `.private/knowledge-miniapps-mvp.md` §8 (M3), §11.4, §14.
 *
 * The manifest declares ONLY `capabilities` — the default-deny security scope,
 * which CANNOT be inferred from code — plus an optional `entry`/`name`. The
 * endpoint/cron surface is NOT declared here; it is inferred from the entry's
 * exports (Val Town convention: `export default` = HTTP handler, a `cron`-named
 * export = scheduled). See {@link ../apps/app-resolver}.
 *
 * `capabilities` mirrors the framework {@link ExecutorCapabilities} type
 * (`questpie/executor`) so the declared app-API scope is identical across the
 * server `ctx`, the sandbox, and code-mode. The compile-time assertion at the
 * bottom of this file keeps the zod schema and the framework type from drifting.
 */

/** Data-access verbs for a collection (matches `ExecutorCapabilities.data`). */
const collectionAccessSchema = z.array(
	z.enum(["read", "create", "update", "delete"]),
);

/** Data-access verbs for a global (matches `ExecutorCapabilities.data`). */
const globalAccessSchema = z.array(z.enum(["read", "write"]));

/**
 * Capability manifest (default-deny). Every axis is optional; an omitted axis
 * grants nothing. Structurally compatible with {@link ExecutorCapabilities}.
 */
export const appCapabilitiesSchema = z
	.object({
		/** Runtime `fetch()` host allowlist (`host[:port]`). Empty/omitted = no net. */
		net: z.array(z.string()).optional(),
		/** Module-import host allowlist (`host[:port]`). Empty/omitted = no remote imports. */
		import: z.array(z.string()).optional(),

		/** Knowledge (file-as-DB) scoped path globs. */
		knowledge: z
			.object({
				read: z.array(z.string()).optional(),
				write: z.array(z.string()).optional(),
			})
			.optional(),

		/** Collections/globals data access (default-deny per collection/global). */
		data: z
			.object({
				collections: z.record(z.string(), collectionAccessSchema).optional(),
				globals: z.record(z.string(), globalAccessSchema).optional(),
			})
			.optional(),

		/** Allowed service names. */
		services: z.array(z.string()).optional(),
		/** Allowed job names to enqueue. */
		jobs: z.array(z.string()).optional(),
		/** Allowed workflow names to trigger. */
		workflows: z.array(z.string()).optional(),

		/** Hard wall-clock timeout (ms). */
		timeoutMs: z.number().int().positive().optional(),
		/** Hard per-guest memory bound (MB). */
		memoryMb: z.number().int().positive().optional(),
	})
	.strict();

/**
 * App manifest. `capabilities` is required (security is explicit, never
 * inferred); `entry` and `name` are optional metadata.
 */
export const appManifestSchema = z
	.object({
		/**
		 * Knowledge path of the server entry, relative to `_app/` (e.g.
		 * `"server.ts"`). When omitted the resolver falls back to a conventional
		 * default entry. The entry's exports drive endpoint/cron inference.
		 *
		 * Must stay within `_app/`: no leading `/` (absolute) and no `..` path
		 * segment (parent-directory escape).
		 */
		entry: z
			.string()
			.min(1)
			.refine((value) => !value.startsWith("/"), {
				message: "entry must be relative (no leading '/')",
			})
			.refine((value) => !value.split("/").includes(".."), {
				message: "entry must not contain a '..' path segment",
			})
			.optional(),
		/** Human-readable app name (display only). */
		name: z.string().min(1).optional(),
		/** Default-deny capability scope. */
		capabilities: appCapabilitiesSchema,
	})
	.strict();

/** Parsed, validated app manifest. */
export type AppManifest = z.infer<typeof appManifestSchema>;

/** Parsed, validated app capability scope. */
export type AppCapabilities = z.infer<typeof appCapabilitiesSchema>;

/**
 * Parse and validate raw `_app/manifest.json` content.
 *
 * @param raw - The manifest as a JSON string or an already-parsed object.
 * @returns The typed {@link AppManifest}.
 * @throws {z.ZodError} when the manifest is structurally invalid.
 * @throws {SyntaxError} when `raw` is a string that is not valid JSON.
 */
export function parseAppManifest(raw: string | unknown): AppManifest {
	const value = typeof raw === "string" ? JSON.parse(raw) : raw;
	return appManifestSchema.parse(value);
}

/**
 * Compile-time guard: the zod-inferred capability shape must stay assignable to
 * the framework {@link ExecutorCapabilities}. If either drifts, this fails to
 * typecheck (caught by `bun run --cwd apps/autopilot typecheck`).
 */
type _AssertCapabilitiesCompatible = AppCapabilities extends ExecutorCapabilities
	? true
	: never;
const _capabilitiesAreCompatible: _AssertCapabilitiesCompatible = true;
void _capabilitiesAreCompatible;
