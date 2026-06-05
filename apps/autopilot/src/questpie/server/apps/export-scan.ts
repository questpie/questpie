/**
 * Lightweight static scan of an entry module's export NAMES.
 *
 * The app endpoint/cron surface is inferred from exports (Val Town convention:
 * `export default` = HTTP handler, a `cron`-named export = scheduled) — see
 * `.private/knowledge-miniapps-mvp.md` §11.4. We only need the export *names*,
 * so a regex scan is sufficient and avoids executing untrusted guest source.
 *
 * LIMITATIONS (documented, not bugs): this is a syntactic scan, not a parse.
 *   - Dynamically attached exports (`export { x as y }` computed at runtime,
 *     `Object.defineProperty(exports, ...)`, re-exports resolved at load time)
 *     are NOT detected — only statically written `export` keywords.
 *   - `export * from "..."` is ignored (no concrete local names).
 *   - The patterns match `export` on a word boundary only (`\bexport`), NOT a
 *     statement boundary, so an `export` written inside a string or comment can
 *     yield a phantom export name. This is acceptable for the trusted-guest MVP.
 * For the MVP guest contract (a single entry that `export default`s a handler and
 * optionally `export const cron = ...`) this is exact.
 */

/** Distinct export names found in a module source. `default` denotes `export default`. */
export interface ScannedExports {
	/** True when the module has an `export default`. */
	hasDefault: boolean;
	/** Statically-declared named exports (excludes `default`). */
	named: string[];
}

const DEFAULT_EXPORT = /\bexport\s+default\b/;

// `export const/let/var/function/async function/class NAME`
const DECLARATION_EXPORT =
	/\bexport\s+(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)/g;

// `export { a, b as c, default as d }`
const NAMED_EXPORT_CLAUSE = /\bexport\s*\{([^}]*)\}/g;

/**
 * Scan `source` for its export names. Does not execute the source.
 */
export function scanExports(source: string): ScannedExports {
	const named = new Set<string>();
	let hasDefault = DEFAULT_EXPORT.test(source);

	for (const match of source.matchAll(DECLARATION_EXPORT)) {
		named.add(match[1]);
	}

	for (const clause of source.matchAll(NAMED_EXPORT_CLAUSE)) {
		const body = clause[1];
		for (const part of body.split(",")) {
			const spec = part.trim();
			if (!spec) continue;
			// `local as exported` → take the exported (right-hand) binding.
			const asMatch = spec.match(/(?:\bas\b)\s+([A-Za-z_$][\w$]*)\s*$/);
			const exported = asMatch
				? asMatch[1]
				: (spec.match(/^([A-Za-z_$][\w$]*)/)?.[1] ?? "");
			if (!exported) continue;
			if (exported === "default") {
				hasDefault = true;
			} else {
				named.add(exported);
			}
		}
	}

	return { hasDefault, named: [...named] };
}
