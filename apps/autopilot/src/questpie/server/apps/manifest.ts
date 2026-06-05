import ts from "typescript";
import { z } from "zod";

import type { ExecutorCapabilities } from "questpie/executor";

/**
 * App manifest schema — the mini-app capability scope.
 *
 * Design: `.private/knowledge-miniapps-mvp.md` §8 (M3), §11.4, §14 and
 * `.private/miniapps-v2-design.md` ★ RESOLVED + §2/§3.2.
 *
 * v2 (★ RESOLVED): the manifest is declared INLINE as `export const manifest = …`
 * inside the `.app` bundle's `server.ts` (no `_app/manifest.json` file). It is
 * re-extracted + re-validated against this schema on EVERY run (see
 * {@link parseInlineManifest} + the app resolver). The legacy JSON-string path
 * ({@link parseAppManifest}) is retained for callers that already hold a parsed
 * manifest string.
 *
 * The manifest declares ONLY `capabilities` — the default-deny security scope,
 * which CANNOT be inferred from code. The HTTP surface is NOT declared here; v2
 * reads it from the OPT-IN `export const actions = { … }` registry (cron stays
 * inferred by name). See {@link ../apps/app-resolver}.
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

		/** Files (file-as-DB) scoped path globs. */
		files: z
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
		 * File path of the server entry, relative to the `.app` bundle root (e.g.
		 * `"server.ts"`). When omitted the resolver falls back to the conventional
		 * default entry (`server.ts`). The entry hosts the inline `manifest`, the
		 * opt-in `actions` registry, and any cron exports.
		 *
		 * Must stay within the bundle: no leading `/` (absolute) and no `..` path
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
 * Parse and validate a manifest from a JSON string or an already-parsed object.
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

/** Error thrown when the inline `export const manifest` cannot be extracted. */
export class InlineManifestError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "InlineManifestError";
	}
}

/** Object-literal keys that would pollute the prototype chain — always rejected. */
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Convert a STATIC AST literal node into a plain JS value. Accepts ONLY JSON-like
 * literals — string/number/boolean/null, arrays, and object literals with static
 * keys. Any non-literal (identifier, call, template with substitutions, spread,
 * computed key, …) is REJECTED, because the manifest is the capability source and
 * must be fully knowable WITHOUT executing the untrusted module.
 *
 * Prototype-pollution safe: forbidden keys (`__proto__`/`constructor`/`prototype`)
 * are rejected, and properties are defined as OWN enumerable data properties on a
 * null-prototype object so a `"__proto__"`-via-quotes key can never reach the
 * prototype.
 */
function literalNodeToValue(node: ts.Expression): unknown {
	if (ts.isStringLiteralLike(node)) return node.text;
	if (ts.isNumericLiteral(node)) return Number(node.text);
	if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
	if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
	if (node.kind === ts.SyntaxKind.NullKeyword) return null;
	// A negative numeric literal (`-5`) parses as a prefix-minus over a number.
	if (
		ts.isPrefixUnaryExpression(node) &&
		node.operator === ts.SyntaxKind.MinusToken &&
		ts.isNumericLiteral(node.operand)
	) {
		return -Number(node.operand.text);
	}
	if (ts.isArrayLiteralExpression(node)) {
		const arr: unknown[] = [];
		for (const el of node.elements) {
			if (ts.isSpreadElement(el)) {
				throw new InlineManifestError("manifest array contains a spread element");
			}
			arr.push(literalNodeToValue(el));
		}
		return arr;
	}
	if (ts.isObjectLiteralExpression(node)) {
		const obj = Object.create(null) as Record<string, unknown>;
		for (const prop of node.properties) {
			if (!ts.isPropertyAssignment(prop)) {
				throw new InlineManifestError(
					"manifest object contains a non-literal property (spread/method/shorthand)",
				);
			}
			let key: string;
			if (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) {
				key = prop.name.text;
			} else {
				throw new InlineManifestError("manifest object has a computed/dynamic key");
			}
			if (FORBIDDEN_KEYS.has(key)) {
				throw new InlineManifestError(`manifest object has a forbidden key "${key}"`);
			}
			Object.defineProperty(obj, key, {
				value: literalNodeToValue(prop.initializer),
				enumerable: true,
				writable: true,
				configurable: true,
			});
		}
		return obj;
	}
	throw new InlineManifestError(
		`manifest contains a non-literal value (${ts.SyntaxKind[node.kind]}); ` +
			"the inline manifest must be a static object literal",
	);
}

/**
 * Extract + validate the INLINE `export const manifest = { … }` from a mini-app
 * `server.ts`, WITHOUT executing the untrusted source.
 *
 * The manifest is the capability source re-derived + re-validated on EVERY run
 * (★ RESOLVED §2/§3.2), so it must be a STATIC object literal of JSON-like values
 * — parsed from the TypeScript AST (no `eval`, no module load), prototype-pollution
 * guarded, then validated against {@link appManifestSchema}.
 *
 * @param source - the raw `server.ts` TypeScript source.
 * @returns the typed {@link AppManifest}.
 * @throws {InlineManifestError} when no `export const manifest` object literal is
 *   present, or it contains a non-static value.
 * @throws {z.ZodError} when the extracted manifest is structurally invalid.
 */
export function parseInlineManifest(source: string): AppManifest {
	const sf = ts.createSourceFile(
		"server.ts",
		source,
		ts.ScriptTarget.Latest,
		/* setParentNodes */ true,
		ts.ScriptKind.TS,
	);

	let manifestNode: ts.Expression | undefined;
	for (const stmt of sf.statements) {
		if (!ts.isVariableStatement(stmt)) continue;
		const isExported = ts
			.getModifiers(stmt)
			?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
		if (!isExported) continue;
		for (const decl of stmt.declarationList.declarations) {
			if (ts.isIdentifier(decl.name) && decl.name.text === "manifest") {
				manifestNode = decl.initializer;
			}
		}
	}

	if (manifestNode === undefined) {
		throw new InlineManifestError(
			"the mini-app server.ts must export an inline `export const manifest = { … }`",
		);
	}
	if (!ts.isObjectLiteralExpression(manifestNode)) {
		throw new InlineManifestError(
			"`export const manifest` must be assigned a plain object literal",
		);
	}

	const value = literalNodeToValue(manifestNode);
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
