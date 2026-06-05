/**
 * Sandbox server — standalone Deno HTTP supervisor for UNTRUSTED code execution.
 *
 * Runs under Deno ONLY (the main QUESTPIE app, Bun/Node, calls it over HTTP via
 * the `executor` adapter — the main app image needs NO Deno). Excluded from the
 * package's tsc typecheck; shipped as source.
 *
 * SECURITY MODEL (hardened per M1 adversarial review — see decision
 * `untrusted-exec-needs-process-isolation-not-in-process-workers`):
 *
 *   Each untrusted request spawns a FRESH `deno run` SUBPROCESS (process-per-
 *   request), NOT a warm in-process Worker. This is the core fix: in-process
 *   Workers are a permission boundary but NOT a resource boundary —
 *     (1) `memoryMb` is unenforceable in-process (V8 heap is process-wide); a
 *         memory bomb OOM-kills the whole service + concurrent tenants.
 *     (2) `worker.terminate()` does not reap grandchild Workers; a nested
 *         `while(true)` Worker orphan pins a core forever.
 *   A per-request subprocess fixes BOTH: `--v8-flags=--max-old-space-size` is a
 *   REAL per-guest memory bound, and killing the process reaps every orphan.
 *
 *   Per-subprocess flags:
 *     --v8-flags=--max-old-space-size=<memoryMb>   hard memory bound
 *     --allow-net=<hosts>     scoped fetch() allowlist   (INDEPENDENT axis)
 *     --allow-import=<hosts>  scoped module-import allowlist (INDEPENDENT axis)
 *     --no-prompt             never block on a permission prompt
 *     (no --allow-read/write/env/run/ffi/sys → all DENIED by default)
 *   Plus in-guest hardening in `guest-entry.ts`: Worker=undefined,
 *   SharedArrayBuffer/Atomics removed.
 *
 *   I/O: request envelope in via stdin, result line out via stdout.
 *   Hard kill on wall-timeout. Spawn failures → structured {ok:false,error}.
 *
 * EGRESS / SSRF: net + import hosts are validated against the private-IP policy
 * (`net-validation.ts`) at request time — a host that IS or RESOLVES TO a
 * private/link-local/loopback/metadata IP is rejected before spawn.
 *
 * TODO(security): connect-time DNS-rebind PINNING is NOT implemented. We reject
 * private IPs at request/manifest time, but a hostname that passes validation
 * and then re-resolves to a private IP at fetch()/redirect time (TOCTOU rebind)
 * is not yet re-checked per-connect. Closing this needs a connect-time hook or
 * an egress proxy that re-validates the resolved IP on every connect/redirect.
 * Until then: untrusted prod NEEDS-HUMAN-SIGNOFF (see task flag).
 *
 * Run:
 *   deno run --allow-net --allow-env --allow-run --allow-read \
 *     src/sandbox-server.ts
 *
 *   (The SERVER needs: net to bind + spawn children that inherit nothing from it;
 *    run to spawn `deno`; read to load guest-entry.ts; env to read PORT/DENO_BIN.
 *    These are the SUPERVISOR's perms — each GUEST subprocess gets only the
 *    scoped flags above and inherits none of the supervisor's grants.)
 */

// @ts-nocheck — Deno runtime file; not part of the Bun/tsc typecheck graph.

import { validateEgressHosts } from "./net-validation.ts";
import type {
	SandboxCapabilities,
	SandboxRunRequest,
	SandboxRunResult,
} from "./types.ts";

const RESULT_MARKER = "__QP_SANDBOX_RESULT__";

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 30_000;
const DEFAULT_MEMORY_MB = 128;
const MIN_MEMORY_MB = 16;
const MAX_MEMORY_MB = 1024;
/** Grace period after wall-timeout before SIGKILL (SIGTERM first). */
const KILL_GRACE_MS = 250;

const GUEST_ENTRY_URL = new URL("./guest-entry.ts", import.meta.url);
const GUEST_ENTRY_PATH = GUEST_ENTRY_URL.pathname;
const DENO_BIN = Deno.env.get("DENO_BIN") ?? Deno.execPath();

function clampInt(v: unknown, def: number, min: number, max: number): number {
	const n = Number(v);
	if (!Number.isFinite(n)) return def;
	return Math.min(Math.max(Math.round(n), min), max);
}

/**
 * Deno's BUILT-IN default `--allow-import` allowlist, applied when the flag is
 * OMITTED. Omitting `--allow-import` does NOT mean "deny" — it silently grants
 * these 7 hosts (incl. esm.sh). So when a guest's import allowlist is empty we
 * must EXPLICITLY `--deny-import` these, or the guest could import from them.
 * (Verified on Deno 2.7.8: bare `--deny-import` is a no-op; the value form works.)
 */
const DENO_DEFAULT_IMPORT_HOSTS = [
	"deno.land:443",
	"jsr.io:443",
	"esm.sh:443",
	"raw.esm.sh:443",
	"cdn.jsdelivr.net:443",
	"raw.githubusercontent.com:443",
	"gist.githubusercontent.com:443",
];

/**
 * Build the `--allow-net` flag for a guest's net allowlist.
 * Omitting it = no network (verified: NotCapable), so empty → no flag.
 */
function netFlag(hosts: string[]): string[] {
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
function importFlags(hosts: string[]): string[] {
	const cleaned = hosts.map((h) => h.trim()).filter((h) => h.length > 0);
	if (cleaned.length) {
		return [`--allow-import=${cleaned.join(",")}`];
	}
	return [`--deny-import=${DENO_DEFAULT_IMPORT_HOSTS.join(",")}`];
}

interface RunOutcome extends Omit<SandboxRunResult, "ms"> {}

/**
 * Execute one untrusted request in a fresh, hardened Deno subprocess.
 * Never throws — spawn/IO failures are caught and returned as structured errors.
 */
async function runInSubprocess(req: SandboxRunRequest): Promise<SandboxRunResult> {
	const started = performance.now();
	const finish = (r: RunOutcome): SandboxRunResult => ({
		...r,
		ms: Math.round(performance.now() - started),
	});

	const caps: SandboxCapabilities = req.capabilities ?? {
		net: [],
		import: [],
		timeoutMs: DEFAULT_TIMEOUT_MS,
		memoryMb: DEFAULT_MEMORY_MB,
	};
	const timeoutMs = clampInt(caps.timeoutMs, DEFAULT_TIMEOUT_MS, 1, MAX_TIMEOUT_MS);
	const memoryMb = clampInt(caps.memoryMb, DEFAULT_MEMORY_MB, MIN_MEMORY_MB, MAX_MEMORY_MB);
	const netHosts = Array.isArray(caps.net) ? caps.net : [];
	const importHosts = Array.isArray(caps.import) ? caps.import : [];

	// ── EGRESS VALIDATION (SSRF / private-IP rejection) — before spawn. ──
	const egress = await validateEgressHosts([...netHosts, ...importHosts]);
	if (!egress.ok) {
		return finish({ ok: false, error: `egress blocked: ${egress.reason}`, logs: [] });
	}

	// ── BUILD THE HARDENED SUBPROCESS COMMAND. ──
	const args = [
		"run",
		"--no-prompt",
		`--v8-flags=--max-old-space-size=${memoryMb}`,
		// net + import are INDEPENDENT axes from the manifest (do NOT alias import=net).
		...netFlag(netHosts),
		...importFlags(importHosts),
		// Guest-entry needs to read ITS OWN file. We grant read scoped to that one
		// path; the guest source runs as a blob module (no fs), and fs ops inside the
		// guest still fail because the guest cannot widen this scope.
		`--allow-read=${GUEST_ENTRY_PATH}`,
		GUEST_ENTRY_PATH,
	];

	let child: Deno.ChildProcess;
	try {
		const command = new Deno.Command(DENO_BIN, {
			args,
			stdin: "piped",
			stdout: "piped",
			stderr: "piped",
			// Do NOT leak the supervisor's env into the guest process.
			clearEnv: true,
			env: {},
		});
		child = command.spawn();
	} catch (err) {
		// Spawn-throw → structured error, never a bare 500.
		return finish({
			ok: false,
			error: `failed to spawn sandbox subprocess: ${err instanceof Error ? err.message : String(err)}`,
			logs: [],
		});
	}

	let timedOut = false;
	let killTimer: number | undefined;
	let graceTimer: number | undefined;

	try {
		// Write the request envelope to the child's stdin, then close it.
		const envelope = JSON.stringify({
			source: req.source,
			input: req.input,
			secrets: req.secrets ?? {},
		});
		const writer = child.stdin.getWriter();
		await writer.write(new TextEncoder().encode(envelope));
		await writer.close();

		// HARD wall-time: SIGTERM, then SIGKILL after a grace period.
		killTimer = setTimeout(() => {
			timedOut = true;
			try {
				child.kill("SIGTERM");
			} catch {
				/* already gone */
			}
			graceTimer = setTimeout(() => {
				try {
					child.kill("SIGKILL");
				} catch {
					/* already gone */
				}
			}, KILL_GRACE_MS);
		}, timeoutMs);

		const { stdout, stderr } = await child.output();
		clearTimeout(killTimer);
		if (graceTimer !== undefined) clearTimeout(graceTimer);

		if (timedOut) {
			return finish({
				ok: false,
				timedOut: true,
				error: `wall-time exceeded (${timeoutMs}ms)`,
				logs: [],
			});
		}

		const stdoutText = new TextDecoder().decode(stdout);
		const result = extractResult(stdoutText);
		if (result) return finish(result);

		// No marker line → the guest crashed hard (e.g. OOM in its OWN process,
		// blocked import). The subprocess died; the SERVICE is unaffected.
		const stderrText = new TextDecoder().decode(stderr).trim();
		return finish({
			ok: false,
			error:
				stderrText.length > 0
					? `subprocess exited without result: ${stderrText.slice(0, 800)}`
					: "subprocess exited without producing a result",
			logs: [],
		});
	} catch (err) {
		if (killTimer !== undefined) clearTimeout(killTimer);
		if (graceTimer !== undefined) clearTimeout(graceTimer);
		try {
			child.kill("SIGKILL");
		} catch {
			/* noop */
		}
		return finish({
			ok: false,
			error: `sandbox IO error: ${err instanceof Error ? err.message : String(err)}`,
			logs: [],
		});
	}
}

/** Pull the marked JSON result line out of the guest's stdout. */
function extractResult(stdout: string): RunOutcome | null {
	const idx = stdout.lastIndexOf(RESULT_MARKER);
	if (idx === -1) return null;
	const after = stdout.slice(idx + RESULT_MARKER.length);
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

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

const port = Number(Deno.env.get("PORT") ?? 8787);

Deno.serve(
	{ port, onListen: ({ port }) => console.log(`sandbox-server listening on :${port}`) },
	async (request) => {
		const url = new URL(request.url);

		if (request.method === "GET" && url.pathname === "/health") {
			return jsonResponse({ ok: true, runtime: "deno", version: Deno.version.deno });
		}

		if (request.method === "POST" && url.pathname === "/run") {
			let req: SandboxRunRequest;
			try {
				req = (await request.json()) as SandboxRunRequest;
			} catch {
				return jsonResponse({ ok: false, error: "invalid JSON body", logs: [] }, 400);
			}
			if (typeof req?.source !== "string" || !req?.capabilities) {
				return jsonResponse(
					{ ok: false, error: "missing 'source' or 'capabilities'", logs: [] },
					400,
				);
			}
			// runInSubprocess never throws — always a structured result.
			const result = await runInSubprocess(req);
			return jsonResponse(result);
		}

		return jsonResponse({ ok: false, error: "not found", logs: [] }, 404);
	},
);
