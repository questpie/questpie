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
import { BINDINGS_TOKEN_HEADER, FRAME_MARKER } from "./types.ts";
import type {
	SandboxCapabilities,
	SandboxRunRequest,
	SandboxRunResult,
} from "./types.ts";

const RESULT_MARKER = "__QP_SANDBOX_RESULT__";
/** Bound on a single binding RPC round-trip to the host broker. */
const BROKER_FETCH_TIMEOUT_MS = 10_000;

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

/**
 * DEFENSE-IN-DEPTH for the bindings path: the TRUSTED broker URL the supervisor
 * is willing to relay a guest's binding RPCs to (carrying the per-run scoped
 * token). The runner already sources this from CONFIG (never the request `Host`),
 * but if a future/spoofed caller hands a stray `bindings.url`, the supervisor
 * must NOT mail the token to it. Set this env to the SAME trusted internal broker
 * URL the app uses; any `bindings.url` that does not match is rejected before any
 * relay. When UNSET, this check is skipped (back-compat) — set it in production.
 */
const EXPECTED_BROKER_URL = Deno.env.get("SANDBOX_BROKER_URL")?.trim();

/** Normalize a broker URL for comparison (drop a trailing slash; ignore case of origin). */
function normalizeBrokerUrl(raw: string): string | null {
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
 * configured {@link EXPECTED_BROKER_URL}. Returns an error string to surface, or
 * `null` when the URL is acceptable (or no expectation is configured).
 */
function brokerUrlRejection(url: unknown): string | null {
	if (!EXPECTED_BROKER_URL) return null; // not configured → skip (back-compat)
	if (typeof url !== "string" || url.length === 0) {
		return "bindings.url is missing";
	}
	const got = normalizeBrokerUrl(url);
	const want = normalizeBrokerUrl(EXPECTED_BROKER_URL);
	if (got === null) return `bindings.url is not a valid URL: ${url}`;
	if (got !== want) {
		return `bindings.url does not match the configured broker URL`;
	}
	return null;
}

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
 * Relay ONE binding RPC to the host broker (supervisor → app, server-to-server),
 * carrying the per-run scoped token. NEVER throws — a broker/network failure is
 * surfaced to the guest as a structured `rpc-result` error, so the guest's call
 * rejects cleanly instead of hanging.
 *
 * This is the ONLY component that knows the token + broker URL; guest code never
 * sees them. The broker is reached over the network HERE (trusted host↔host),
 * which is distinct from the GUEST's egress (the guest cannot fetch the broker —
 * its allowlist rejects loopback/private IPs by design).
 */
async function brokerCall(
	bindings: { url: string; token: string },
	method: string,
	args: unknown,
): Promise<{ ok: boolean; value?: unknown; error?: { code: string; message: string } }> {
	const controller = new AbortController();
	const t = setTimeout(() => controller.abort(), BROKER_FETCH_TIMEOUT_MS);
	try {
		const res = await fetch(bindings.url, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				[BINDINGS_TOKEN_HEADER]: bindings.token,
			},
			body: JSON.stringify({ method, args }),
			signal: controller.signal,
		});
		const text = await res.text();
		try {
			return JSON.parse(text);
		} catch {
			return {
				ok: false,
				error: {
					code: "execution_error",
					message: `broker returned non-JSON (HTTP ${res.status})`,
				},
			};
		}
	} catch (err) {
		return {
			ok: false,
			error: {
				code: "execution_error",
				message: `broker request failed: ${err instanceof Error ? err.message : String(err)}`,
			},
		};
	} finally {
		clearTimeout(t);
	}
}

/**
 * Drive a BINDINGS run: feed the framed envelope, stream the guest's stdout,
 * demultiplex `rpc` (relay to the broker, reply on the guest's stdin) vs the
 * final `result`. Returns the run outcome (without `ms`).
 *
 * Multiplexing contract: the guest writes one JSON line per message, each
 * prefixed by {@link FRAME_MARKER}. The supervisor:
 *   - `rpc`     → `brokerCall()` → write a framed `rpc-result` to stdin.
 *   - `result`  → capture as the run outcome and stop.
 * Non-framed stdout lines (stray guest prints) are ignored.
 */
async function relayBindingsRun(
	child: Deno.ChildProcess,
	req: SandboxRunRequest,
	timedOut: () => boolean,
): Promise<RunOutcome> {
	const bindings = req.bindings as { url: string; token: string };
	const encoder = new TextEncoder();
	const decoder = new TextDecoder();
	const stdinWriter = child.stdin.getWriter();

	let stdinOpen = true;
	const closeStdin = async () => {
		if (!stdinOpen) return;
		stdinOpen = false;
		try {
			await stdinWriter.close();
		} catch {
			/* already closed */
		}
	};
	const writeLine = async (obj: unknown) => {
		if (!stdinOpen) return;
		try {
			await stdinWriter.write(encoder.encode(FRAME_MARKER + JSON.stringify(obj) + "\n"));
		} catch {
			/* guest gone */
		}
	};

	// 1. Send the envelope as the FIRST framed line (note: `bindings:true` is a
	//    boolean FLAG to the guest — the token/url are NEVER sent into the guest).
	await writeLine({
		source: req.source,
		input: req.input,
		secrets: req.secrets ?? {},
		bindings: true,
	});

	// 2. Stream stdout, demuxing frames. Outstanding RPCs run concurrently so a
	//    slow broker call doesn't block reading further frames.
	let outcome: RunOutcome | null = null;
	let pending = "";
	const inflight: Array<Promise<void>> = [];

	const handleLine = async (line: string) => {
		if (!line.startsWith(FRAME_MARKER)) return; // stray output → ignore
		let msg: {
			type?: string;
			id?: number;
			method?: string;
			args?: unknown;
			ok?: boolean;
			output?: unknown;
			error?: string;
			logs?: string[];
		};
		try {
			msg = JSON.parse(line.slice(FRAME_MARKER.length));
		} catch {
			return;
		}
		if (msg.type === "rpc" && typeof msg.id === "number" && typeof msg.method === "string") {
			const id = msg.id;
			const p = (async () => {
				const r = await brokerCall(bindings, msg.method as string, msg.args);
				await writeLine({
					type: "rpc-result",
					id,
					ok: !!r.ok,
					value: r.value,
					error: r.error,
				});
			})();
			inflight.push(p);
		} else if (msg.type === "result") {
			outcome = {
				ok: !!msg.ok,
				output: msg.output,
				error: msg.error,
				logs: Array.isArray(msg.logs) ? msg.logs : [],
			};
		}
	};

	try {
		const reader = child.stdout.getReader();
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			pending += decoder.decode(value, { stream: true });
			let idx: number;
			while ((idx = pending.indexOf("\n")) !== -1) {
				const line = pending.slice(0, idx);
				pending = pending.slice(idx + 1);
				await handleLine(line);
			}
			if (outcome) break; // final result seen
			if (timedOut()) break;
		}
		// Flush a trailing line without newline (the final result frame may not
		// be newline-terminated before exit).
		if (!outcome && pending.length > 0) {
			await handleLine(pending.trim());
		}
	} catch {
		/* stdout closed abruptly — fall through to the no-result handling */
	}

	// Settle outstanding broker relays, then close the guest's stdin so its drain
	// loop ends and the process can exit.
	await Promise.allSettled(inflight);
	await closeStdin();

	// Drain remaining stdout + collect stderr for diagnostics, then reap.
	let stderrText = "";
	try {
		const { stderr } = await child.output();
		stderrText = decoder.decode(stderr).trim();
	} catch {
		/* already consumed/killed */
	}

	if (outcome) return outcome;
	return {
		ok: false,
		error:
			stderrText.length > 0
				? `subprocess exited without result: ${stderrText.slice(0, 800)}`
				: "subprocess exited without producing a result",
		logs: [],
	};
}

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

	// BINDINGS URL VALIDATION (token-exfiltration defense) — before spawn.
	// A bindings run mails the per-run token to `bindings.url`; never relay to a
	// URL the supervisor was not configured to trust (see brokerUrlRejection).
	if (req.bindings) {
		const bindingsRejection = brokerUrlRejection(
			(req.bindings as { url?: unknown }).url,
		);
		if (bindingsRejection !== null) {
			return finish({
				ok: false,
				error: `bindings rejected: ${bindingsRejection}`,
				logs: [],
			});
		}
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
		// HARD wall-time: SIGTERM, then SIGKILL after a grace period. Shared by
		// both the legacy and the bindings I/O paths.
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

		// ── BINDINGS PATH: framed stdio relay to the host broker. ──
		if (req.bindings) {
			const outcome = await relayBindingsRun(child, req, () => timedOut);
			clearTimeout(killTimer);
			if (graceTimer !== undefined) clearTimeout(graceTimer);
			if (timedOut) {
				return finish({
					ok: false,
					timedOut: true,
					error: `wall-time exceeded (${timeoutMs}ms)`,
					logs: outcome?.logs ?? [],
				});
			}
			return finish(outcome);
		}

		// ── LEGACY PATH: one envelope in, one result line out (M2 behavior). ──
		const envelope = JSON.stringify({
			source: req.source,
			input: req.input,
			secrets: req.secrets ?? {},
		});
		const writer = child.stdin.getWriter();
		await writer.write(new TextEncoder().encode(envelope));
		await writer.close();

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
