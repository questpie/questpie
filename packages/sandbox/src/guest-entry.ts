/**
 * Guest entry — runs INSIDE each freshly-spawned Deno subprocess (one per
 * untrusted request). This file is the in-process half of the hardened sandbox.
 *
 * Runs under Deno ONLY. Excluded from the package's tsc typecheck (it uses Deno
 * globals); shipped as source and executed via `deno run <flags> guest-entry.ts`.
 *
 * Threat-model hardening applied here, BEFORE any guest code runs:
 *   - `globalThis.Worker = undefined`  → guest cannot spawn nested Workers
 *     (the M1 orphan-CPU DoS: terminate() doesn't reap grandchild Workers).
 *     Process death reaps everything, but denying Worker also removes the vector.
 *   - delete `SharedArrayBuffer` + `Atomics` → removes the timer-amplification
 *     gadget needed for Spectre cache side-channels against co-resident tenants.
 *   - console.* captured into a logs[] buffer, returned with the result.
 *   - guest must `export default` a `function(input)` (Val Town semantics).
 *   - everything wrapped in try/catch → a guest throw is a structured error.
 *
 * Process-level hardening (memory cap, fs/env/run/ffi denial, scoped net/import)
 * is applied by the SUPERVISOR via Deno CLI flags — see `sandbox-server.ts`.
 *
 * I/O protocol (stdin → stdout, single JSON line each):
 *   stdin  : { source: string, input: unknown, secrets?: Record<string,string> }
 *   stdout : { ok, output?, logs, error? }   (prefixed by RESULT_MARKER)
 */

// @ts-nocheck — Deno runtime file; not part of the Bun/tsc typecheck graph.

/** Marker so the supervisor can pick the result line out of guest stdout noise. */
const RESULT_MARKER = "__QP_SANDBOX_RESULT__";

// ── 1. HARDEN GLOBALS (must happen before importing/eval'ing guest source) ──

// Remove nested-Worker capability (orphan-CPU DoS vector).
try {
	// deno-lint-ignore no-explicit-any
	(globalThis as any).Worker = undefined;
} catch {
	/* non-configurable in some builds; the no-Worker subprocess flag still helps */
}

// Remove Spectre timer-amplification primitives.
for (const name of ["SharedArrayBuffer", "Atomics"]) {
	try {
		// deno-lint-ignore no-explicit-any
		delete (globalThis as any)[name];
	} catch {
		try {
			// deno-lint-ignore no-explicit-any
			(globalThis as any)[name] = undefined;
		} catch {
			/* best effort */
		}
	}
}

// ── 2. CAPTURE CONSOLE ──

const logs: string[] = [];
const MAX_LOGS = 1000;
const MAX_LOG_LEN = 4000;
const orig = {
	log: console.log.bind(console),
	error: console.error.bind(console),
	warn: console.warn.bind(console),
	info: console.info.bind(console),
};
for (const level of ["log", "error", "warn", "info"] as const) {
	// deno-lint-ignore no-explicit-any
	(console as any)[level] = (...args: unknown[]) => {
		if (logs.length < MAX_LOGS) {
			const line =
				level +
				": " +
				args
					.map((a) => {
						try {
							return typeof a === "string" ? a : JSON.stringify(a);
						} catch {
							return String(a);
						}
					})
					.join(" ");
			logs.push(line.length > MAX_LOG_LEN ? line.slice(0, MAX_LOG_LEN) + "…" : line);
		}
	};
}

// ── 3. READ THE REQUEST FROM STDIN ──

async function readStdin(): Promise<string> {
	const chunks: Uint8Array[] = [];
	// deno-lint-ignore no-explicit-any
	const stdin = (Deno as any).stdin;
	const buf = new Uint8Array(65536);
	while (true) {
		const n = await stdin.read(buf);
		if (n === null) break;
		chunks.push(buf.slice(0, n));
	}
	let total = 0;
	for (const c of chunks) total += c.length;
	const merged = new Uint8Array(total);
	let off = 0;
	for (const c of chunks) {
		merged.set(c, off);
		off += c.length;
	}
	return new TextDecoder().decode(merged);
}

function emit(result: { ok: boolean; output?: unknown; logs: string[]; error?: string }) {
	let payload: string;
	try {
		payload = JSON.stringify(result);
	} catch {
		payload = JSON.stringify({
			ok: false,
			error: "result not serializable",
			logs: result.logs ?? [],
		});
	}
	// Single marked line to stdout. The supervisor scans for the marker.
	orig.log(RESULT_MARKER + payload);
}

async function main() {
	let req: { source: string; input: unknown; secrets?: Record<string, string> };
	try {
		const raw = await readStdin();
		req = JSON.parse(raw);
	} catch (err) {
		emit({ ok: false, error: "failed to read/parse request envelope", logs });
		return;
	}

	// Expose injected secrets to the guest (NOT embedded in source).
	try {
		// deno-lint-ignore no-explicit-any
		(globalThis as any).__secrets = req.secrets ?? {};
	} catch {
		/* noop */
	}

	try {
		// Import the guest as a blob module so its own top-level remote imports are
		// governed by the subprocess's scoped `--allow-import`. blob: URLs are not
		// remote hosts and need no import permission.
		const guestUrl = URL.createObjectURL(
			new Blob([req.source], { type: "application/typescript" }),
		);
		const mod = await import(guestUrl);
		const entry = mod.default;
		if (typeof entry !== "function") {
			throw new Error("guest must 'export default' a function(input)");
		}
		const output = await entry(req.input);
		emit({ ok: true, output, logs });
	} catch (err) {
		emit({
			ok: false,
			error: err instanceof Error ? err.message : String(err),
			logs,
		});
	}
}

await main();
// Ensure the process exits promptly even if the guest left timers/handles open.
// deno-lint-ignore no-explicit-any
(Deno as any).exit(0);
