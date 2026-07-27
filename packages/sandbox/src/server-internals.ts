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

const MAX_RESULT_DEPTH = 32;
const MAX_RESULT_NODES = 10_000;
const MAX_RESULT_JSON_BYTES = 1_048_576;
const MAX_RESULT_LOGS = 1_000;
const MAX_RESULT_LOG_BYTES = 4_000;
const MAX_TOTAL_LOG_BYTES = 1_048_576;

function exactKeys(
	value: Record<string, unknown>,
	required: readonly string[],
	optional: readonly string[],
): boolean {
	const keys = Object.keys(value);
	return (
		required.every((key) => keys.includes(key)) &&
		keys.every((key) => required.includes(key) || optional.includes(key))
	);
}

function isBoundedJson(
	value: unknown,
	budget = { nodes: 0, bytes: 0 },
	depth = 0,
	maximumBytes = MAX_RESULT_JSON_BYTES,
): boolean {
	if (depth > MAX_RESULT_DEPTH) return false;
	budget.nodes += 1;
	if (budget.nodes > MAX_RESULT_NODES) return false;
	if (value === null || typeof value === "boolean") {
		budget.bytes += 5;
	} else if (typeof value === "number") {
		if (!Number.isFinite(value)) return false;
		budget.bytes += 24;
	} else if (typeof value === "string") {
		budget.bytes += new TextEncoder().encode(value).byteLength;
	} else if (Array.isArray(value)) {
		budget.bytes += 2;
		for (const item of value) {
			if (!isBoundedJson(item, budget, depth + 1, maximumBytes)) return false;
		}
	} else if (typeof value === "object" && value !== null) {
		budget.bytes += 2;
		for (const [key, item] of Object.entries(value)) {
			budget.bytes += new TextEncoder().encode(key).byteLength;
			if (!isBoundedJson(item, budget, depth + 1, maximumBytes)) return false;
		}
	} else {
		return false;
	}
	return budget.bytes <= maximumBytes;
}

export function parseSandboxRunResult(
	value: unknown,
): (RunOutcome & { ms?: number }) | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const result = value as Record<string, unknown>;
	if (
		!exactKeys(result, ["ok", "logs"], ["output", "error", "timedOut", "ms"]) ||
		typeof result.ok !== "boolean" ||
		!Array.isArray(result.logs) ||
		result.logs.length > MAX_RESULT_LOGS ||
		(result.error !== undefined && typeof result.error !== "string") ||
		(result.timedOut !== undefined && typeof result.timedOut !== "boolean") ||
		(result.ms !== undefined &&
			(typeof result.ms !== "number" ||
				!Number.isFinite(result.ms) ||
				result.ms < 0))
	) {
		return null;
	}
	if (
		(result.ok === true &&
			(Object.hasOwn(result, "error") || Object.hasOwn(result, "timedOut"))) ||
		(result.ok === false &&
			(typeof result.error !== "string" ||
				Object.hasOwn(result, "output") ||
				(Object.hasOwn(result, "timedOut") && result.timedOut !== true)))
	) {
		return null;
	}
	let logBytes = 0;
	for (const log of result.logs) {
		if (typeof log !== "string") return null;
		const bytes = new TextEncoder().encode(log).byteLength;
		logBytes += bytes;
		if (bytes > MAX_RESULT_LOG_BYTES || logBytes > MAX_TOTAL_LOG_BYTES) {
			return null;
		}
	}
	if (result.output !== undefined && !isBoundedJson(result.output)) return null;
	return {
		ok: result.ok,
		...(result.output !== undefined ? { output: result.output } : {}),
		...(typeof result.error === "string" ? { error: result.error } : {}),
		logs: result.logs as string[],
		...(typeof result.timedOut === "boolean"
			? { timedOut: result.timedOut }
			: {}),
		...(typeof result.ms === "number" ? { ms: result.ms } : {}),
	};
}

export type BrokerRelayResult =
	| { ok: true; value?: unknown }
	| {
			ok: false;
			error: { code: string; message: string; correlationId?: string };
	  };

const BROKER_ERROR_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
	bad_method: "invalid sandbox binding method",
	bad_args: "invalid sandbox binding arguments",
	unauthorized: "sandbox binding authorization failed",
	forbidden: "sandbox binding operation forbidden",
	not_implemented: "sandbox binding operation unavailable",
	execution_error: "sandbox binding operation failed",
});

export function parseBrokerResponse(
	value: unknown,
	maxValueBytes = MAX_RESULT_JSON_BYTES,
): BrokerRelayResult | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const response = value as Record<string, unknown>;
	if (response.ok === true) {
		if (!exactKeys(response, ["ok", "value"], [])) return null;
		if (!isBoundedJson(response.value, undefined, 0, maxValueBytes))
			return null;
		return { ok: true, value: response.value };
	}
	if (
		response.ok !== false ||
		!exactKeys(response, ["ok", "error"], []) ||
		!response.error ||
		typeof response.error !== "object" ||
		Array.isArray(response.error)
	) {
		return null;
	}
	const error = response.error as Record<string, unknown>;
	if (
		!exactKeys(error, ["code", "message"], ["correlationId"]) ||
		typeof error.code !== "string" ||
		typeof error.message !== "string" ||
		(error.correlationId !== undefined &&
			(typeof error.correlationId !== "string" ||
				!/^[\w-]{1,128}$/.test(error.correlationId)))
	) {
		return null;
	}
	const code = Object.hasOwn(BROKER_ERROR_MESSAGES, error.code)
		? error.code
		: "execution_error";
	return {
		ok: false,
		error: {
			code,
			message: BROKER_ERROR_MESSAGES[code]!,
			...(typeof error.correlationId === "string"
				? { correlationId: error.correlationId }
				: {}),
		},
	};
}

/** Normalize a broker URL for comparison (drop a trailing slash; ignore case of origin). */
export function normalizeBrokerUrl(raw: string): string | null {
	try {
		const u = new URL(raw);
		if (
			(u.protocol !== "http:" && u.protocol !== "https:") ||
			u.username.length > 0 ||
			u.password.length > 0 ||
			u.hash.length > 0
		) {
			return null;
		}
		// Compare origin (lowercased by URL) + pathname without a trailing slash.
		const path = u.pathname.replace(/\/$/, "");
		return `${u.origin}${path}${u.search}`;
	} catch {
		return null;
	}
}

/**
 * Reject a guest's bindings target URL unless it matches the supervisor's
 * configured expected broker URL. Returns an error string to surface, or
 * `null` only when the URL is acceptable. Bindings fail closed when the
 * supervisor has no canonical broker target configured.
 */
export function brokerUrlRejection(
	url: unknown,
	expected: string | undefined,
): string | null {
	if (!expected || normalizeBrokerUrl(expected) === null) {
		return "sandbox broker URL is not configured";
	}
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

export function clampInt(
	v: unknown,
	def: number,
	min: number,
	max: number,
): number {
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
export function extractResult(
	stdout: string,
	marker: string,
): RunOutcome | null {
	const idx = stdout.lastIndexOf(marker);
	if (idx === -1) return null;
	const after = stdout.slice(idx + marker.length);
	const newline = after.indexOf("\n");
	const json = newline === -1 ? after : after.slice(0, newline);
	try {
		const parsed = JSON.parse(json);
		return parseSandboxRunResult(parsed);
	} catch {
		return null;
	}
}
