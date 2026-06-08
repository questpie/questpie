/**
 * Pure supervisor helpers extracted from `sandbox-server.ts`.
 *
 * This file contains NO Deno globals and NO top-level side effects, so it is
 * importable by BOTH the Deno sandbox server (over a `./server-internals.ts`
 * specifier) AND `bun:test` (over `../src/server-internals.js`). It lands inside
 * the package's `tsconfig` `include` and MUST typecheck clean — keep it plain TS.
 *
 * Behavior is identical to the closures these were lifted from: the two functions
 * that previously read module-level env-derived state (`brokerUrlRejection` →
 * `EXPECTED_BROKER_URL`, `extractResult` → `RESULT_MARKER`) now take that value as
 * a parameter, and the server's single call sites pass the SAME values.
 */

/** Marker prefixed on the guest's final JSON result line on stdout. */
export const RESULT_MARKER = "__QP_SANDBOX_RESULT__";

/**
 * Deno's BUILT-IN default `--allow-import` allowlist, applied when the flag is
 * OMITTED. Omitting `--allow-import` does NOT mean "deny" — it silently grants
 * these 7 hosts (incl. esm.sh). So when a guest's import allowlist is empty we
 * must EXPLICITLY `--deny-import` these, or the guest could import from them.
 * (Verified on Deno 2.7.8: bare `--deny-import` is a no-op; the value form works.)
 */
export const DENO_DEFAULT_IMPORT_HOSTS = [
	"deno.land:443",
	"jsr.io:443",
	"esm.sh:443",
	"raw.esm.sh:443",
	"cdn.jsdelivr.net:443",
	"raw.githubusercontent.com:443",
	"gist.githubusercontent.com:443",
];

/**
 * Run outcome (the result shape WITHOUT the server-measured `ms`). Defined here
 * as a single local interface so the server can import ONE definition. It is
 * structurally `Omit<SandboxRunResult, "ms">`.
 */
export interface RunOutcome {
	ok: boolean;
	output?: unknown;
	logs: string[];
	error?: string;
	timedOut?: boolean;
}

/** Normalize a broker URL for comparison (drop a trailing slash; ignore case of origin). */
export function normalizeBrokerUrl(raw: string): string | null {
	try {
		const u = new URL(raw);
		// Compare origin (lowercased by URL) + pathname without a trailing slash.
		const path = u.pathname.replace(/\/$/, "");
		return `${u.origin}${path}`;
	} catch {
		return null;
	}
}

/**
 * Reject a guest's bindings target URL unless it matches the supervisor's
 * configured expected broker URL. Returns an error string to surface, or
 * `null` when the URL is acceptable (or no expectation is configured).
 */
export function brokerUrlRejection(url: unknown, expected: string | undefined): string | null {
	if (!expected) return null; // not configured → skip (back-compat)
	if (typeof url !== "string" || url.length === 0) {
		return "bindings.url is missing";
	}
	const got = normalizeBrokerUrl(url);
	const want = normalizeBrokerUrl(expected);
	if (got === null) return `bindings.url is not a valid URL: ${url}`;
	if (got !== want) {
		return `bindings.url does not match the configured broker URL`;
	}
	return null;
}

export function clampInt(v: unknown, def: number, min: number, max: number): number {
	const n = Number(v);
	if (!Number.isFinite(n)) return def;
	return Math.min(Math.max(Math.round(n), min), max);
}

/**
 * Build the `--allow-net` flag for a guest's net allowlist.
 * Omitting it = no network (verified: NotCapable), so empty → no flag.
 */
export function netFlag(hosts: string[]): string[] {
	const cleaned = hosts.map((h) => h.trim()).filter((h) => h.length > 0);
	return cleaned.length ? [`--allow-net=${cleaned.join(",")}`] : [];
}

/**
 * Build the import-permission flags for a guest's import allowlist.
 * - Non-empty: `--allow-import=<hosts>` — an explicit value REPLACES Deno's
 *   defaults (verified), so only these hosts are importable.
 * - Empty: omit `--allow-import` AND `--deny-import=<defaults>` to neutralize
 *   the implicit default hosts → no remote imports at all.
 */
export function importFlags(hosts: string[]): string[] {
	const cleaned = hosts.map((h) => h.trim()).filter((h) => h.length > 0);
	if (cleaned.length) {
		return [`--allow-import=${cleaned.join(",")}`];
	}
	return [`--deny-import=${DENO_DEFAULT_IMPORT_HOSTS.join(",")}`];
}

/** Pull the marked JSON result line out of the guest's stdout. */
export function extractResult(stdout: string, marker: string): RunOutcome | null {
	const idx = stdout.lastIndexOf(marker);
	if (idx === -1) return null;
	const after = stdout.slice(idx + marker.length);
	const newline = after.indexOf("\n");
	const json = newline === -1 ? after : after.slice(0, newline);
	try {
		const parsed = JSON.parse(json);
		return {
			ok: !!parsed.ok,
			output: parsed.output,
			error: parsed.error,
			logs: Array.isArray(parsed.logs) ? parsed.logs : [],
		};
	} catch {
		return null;
	}
}
