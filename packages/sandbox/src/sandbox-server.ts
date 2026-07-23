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
 * private/link-local/loopback/metadata IP is rejected before spawn. The BASELINE
 * runtime defense is the brokered `http.fetch` path (guest runs `--allow-net=[]`,
 * so it cannot open sockets at all → no DNS-rebind surface).
 *
 * DEFENSE-IN-DEPTH (LINUX cloud workers only): on a capable Linux host the guest
 * subprocess is additionally wrapped in a NETWORK NAMESPACE with an nftables
 * egress firewall (`egress-firewall.ts`) that DROPS all traffic to private/link-
 * local/loopback/metadata ranges at the KERNEL and permits only the resolved
 * per-run allowlist — a second, independent boundary that also covers a
 * hypothetical low-level escape. It is GRACEFULLY ABSENT off Linux (and on Linux
 * without `unshare`/`nft`/`ip` or CAP_NET_ADMIN): a one-line notice is logged and
 * the guest spawns exactly as before, with the baseline staying safe via the
 * brokered fetch. The kernel-drop behavior is verified manually on a Linux worker
 * (it cannot be exercised on macOS/Windows). See `egress-firewall.ts`.
 *
 * Run:
 *   deno run --allow-net --allow-env --allow-run --allow-read --allow-write=$TMPDIR \
 *     src/sandbox-server.ts
 *
 *   (The SERVER needs: net to bind + spawn children that inherit nothing from it;
 *    run to spawn `deno` — and, on Linux, `unshare`/`nft`/`ip` for the egress
 *    firewall; read to load guest-entry.ts; env to read PORT/DENO_BIN; write to a
 *    temp dir to stage the per-run nft ruleset (Linux only — harmless elsewhere).
 *    These are the SUPERVISOR's perms — each GUEST subprocess gets only the
 *    scoped flags above and inherits none of the supervisor's grants.)
 */

// @ts-nocheck — Deno runtime file; not part of the Bun/tsc typecheck graph.

import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";

import {
	hashAgentWorkloadSandboxSource,
	verifyAgentWorkloadSandboxAdmission,
	type AgentWorkloadSandboxAdmissionClaims,
} from "./agent-workload-admission.ts";
import { AGENT_WORKLOAD_SANDBOX_DENIAL_MESSAGE } from "./agent-workload-denial.ts";
import {
	createAgentWorkloadRuntimeAdmissionAuditEvent,
	type AgentWorkloadRuntimeAdmissionReason,
} from "./agent-workload-runtime-audit.ts";
import {
	type EgressFirewallPlan,
	planEgressFirewall,
	wrapWithNetns,
} from "./egress-firewall.ts";
import {
	bundleGuestRuntimeSource,
	guestRuntimeDataUrl,
} from "./guest-runtime-source.ts";
import {
	resolveAllowedEndpoints,
	validateEgressHosts,
} from "./net-validation.ts";
import {
	RESULT_MARKER,
	brokerUrlRejection,
	clampInt,
	extractResult,
	importFlags,
	netFlag,
	type RunOutcome,
} from "./server-internals.ts";
import {
	AGENT_WORKLOAD_ADMISSION_HEADER,
	BINDINGS_TOKEN_HEADER,
	FRAME_MARKER,
	NON_AGENT_ADMISSION_HEADER,
} from "./types.ts";
import type {
	SandboxCapabilities,
	SandboxRunRequest,
	SandboxRunResult,
} from "./types.ts";

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
const GUEST_BINDINGS_PATH = new URL("./guest-bindings.ts", import.meta.url)
	.pathname;
const GUEST_ENTRY_SOURCE = await Deno.readTextFile(GUEST_ENTRY_PATH);
const GUEST_BINDINGS_SOURCE = await Deno.readTextFile(GUEST_BINDINGS_PATH);
const GUEST_RUNTIME_MODULE = guestRuntimeDataUrl(
	bundleGuestRuntimeSource(GUEST_ENTRY_SOURCE, GUEST_BINDINGS_SOURCE),
);
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
const AGENT_ADMISSION_SECRET = Deno.env
	.get("SANDBOX_AGENT_ADMISSION_SECRET")
	?.trim();
const AGENT_ADMISSION_KEY_ID =
	Deno.env.get("SANDBOX_AGENT_ADMISSION_KEY_ID")?.trim() ?? "sandbox-agent-v1";
const SANDBOX_INSTANCE_ID = Deno.env.get("SANDBOX_INSTANCE_ID")?.trim() ?? "";
const AGENT_WORK_ROOT_BASE = Deno.env
	.get("SANDBOX_AGENT_WORK_ROOT")
	?.replace(/\/+$/, "");
const NON_AGENT_ADMISSION_SECRET = Deno.env
	.get("SANDBOX_NON_AGENT_ADMISSION_SECRET")
	?.trim();
const consumedAgentAdmissions = new Map<string, number>();

interface SandboxChildProcess {
	readonly stdin: WritableStream<Uint8Array>;
	readonly stdout: ReadableStream<Uint8Array>;
	readonly stderr: Promise<Uint8Array>;
	readonly exited: Promise<void>;
	kill(signal: "SIGKILL" | "SIGTERM"): void;
}

async function readStream(
	stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

function spawnSandboxChild(
	command: string,
	args: string[],
	argv0: string,
): SandboxChildProcess {
	const child = spawn(command, args, {
		argv0,
		cwd: "/",
		env: {},
		stdio: ["pipe", "pipe", "pipe"],
	});
	const exited = new Promise<void>((resolve, reject) => {
		child.once("error", reject);
		child.once("close", () => resolve());
	});
	void exited.catch(() => {});
	return {
		stdin: Writable.toWeb(child.stdin),
		stdout: Readable.toWeb(child.stdout),
		stderr: readStream(Readable.toWeb(child.stderr)),
		exited,
		kill: (signal) => {
			child.kill(signal);
		},
	};
}

function consumeAgentAdmission(
	admission: AgentWorkloadSandboxAdmissionClaims,
): boolean {
	const now = Date.now();
	for (const [admissionId, expiresAt] of consumedAgentAdmissions) {
		if (expiresAt <= now) consumedAgentAdmissions.delete(admissionId);
	}
	if (consumedAgentAdmissions.has(admission.admissionId)) return false;
	consumedAgentAdmissions.set(
		admission.admissionId,
		Date.parse(admission.expiresAt),
	);
	return true;
}

function authenticatesNonAgentHost(value: string | null): boolean {
	if (
		!value ||
		!NON_AGENT_ADMISSION_SECRET ||
		new TextEncoder().encode(NON_AGENT_ADMISSION_SECRET).byteLength < 32
	) {
		return false;
	}
	const expected = new TextEncoder().encode(NON_AGENT_ADMISSION_SECRET);
	const actual = new TextEncoder().encode(value);
	if (actual.byteLength !== expected.byteLength) return false;
	let difference = 0;
	for (let index = 0; index < expected.byteLength; index += 1) {
		difference |= expected[index] ^ actual[index];
	}
	return difference === 0;
}

function auditAgentAdmission(
	decision: "allowed" | "denied",
	reason: AgentWorkloadRuntimeAdmissionReason,
	claims?: AgentWorkloadSandboxAdmissionClaims,
): void {
	console.log(
		JSON.stringify(
			createAgentWorkloadRuntimeAdmissionAuditEvent(decision, reason, claims),
		),
	);
}

function deriveAgentWorkRoot(
	admission: AgentWorkloadSandboxAdmissionClaims,
): string | null {
	if (
		!AGENT_WORK_ROOT_BASE ||
		!AGENT_WORK_ROOT_BASE.startsWith("/") ||
		AGENT_WORK_ROOT_BASE === "/" ||
		AGENT_WORK_ROOT_BASE === Deno.cwd() ||
		AGENT_WORK_ROOT_BASE === Deno.env.get("HOME")
	) {
		return null;
	}
	return `${AGENT_WORK_ROOT_BASE}/${admission.companyId}/${admission.workRequestId}/${admission.attemptId}/${admission.admissionId}`;
}

// ──────────────────────────────────────────────────────────────────────────
// DEFENSE-IN-DEPTH: kernel egress firewall (LINUX-ONLY, cloud workers). S6 of
// spec `sandbox-brokered-http-egress`. The pure planning/ruleset/argv logic
// lives in `egress-firewall.ts` (typechecked + unit-tested under bun). The
// Deno-only PROBING (platform, tool presence, capabilities) + the real spawn
// wrap live here. On non-Linux — or Linux without the tools/caps — the firewall
// NO-OPS with a one-line notice and the guest spawns exactly as before, so the
// macOS/Windows local workers are untouched (baseline safe via brokered fetch).
//
// HONESTY: the kernel-drop guarantee is UNVERIFIABLE off Linux; it is verified
// manually on a Linux worker (see the repro in `egress-firewall.ts`).
//
// Off-switch: set SANDBOX_DISABLE_NETNS_FIREWALL=1 to force the no-op path even
// on a capable Linux host (e.g. when the orchestrator already provides netns).
// ──────────────────────────────────────────────────────────────────────────

const NETNS_FIREWALL_DISABLED =
	Deno.env.get("SANDBOX_DISABLE_NETNS_FIREWALL") === "1";

/** Probe PATH for a tool by exec'ing `<tool> --version` (no shell). Never throws. */
async function hasTool(
	tool: string,
	versionArg = "--version",
): Promise<boolean> {
	try {
		const out = await new Deno.Command(tool, {
			args: [versionArg],
			stdin: "null",
			stdout: "null",
			stderr: "null",
		}).output();
		// `unshare --version` / `nft --version` / `ip -V` all exit 0 when present.
		return out.success;
	} catch {
		return false; // ENOENT (not on PATH) or spawn denied
	}
}

/**
 * Probe whether the supervisor can actually CREATE a filtered netns. We don't
 * parse capability bitmasks — we just attempt the real operation cheaply:
 * `unshare --net --map-root-user true`. If it exits 0 the host supports an
 * (unprivileged-userns or root) network namespace; if it EPERMs, we no-op.
 * This is the most honest probe: it tests the exact syscall path we'll use.
 */
async function canCreateNetns(): Promise<boolean> {
	try {
		const out = await new Deno.Command("unshare", {
			args: ["--net", "--map-root-user", "true"],
			stdin: "null",
			stdout: "null",
			stderr: "null",
		}).output();
		return out.success;
	} catch {
		return false;
	}
}

/** GNU env can set argv[0] for the Deno process inside the netns wrapper. */
async function supportsVirtualArgv0Env(): Promise<boolean> {
	try {
		const output = await new Deno.Command("env", {
			args: ["--argv0=/runtime/deno", "true"],
			stdin: "null",
			stdout: "null",
			stderr: "null",
		}).output();
		return output.success;
	} catch {
		return false;
	}
}

/**
 * Build the per-run egress-firewall plan: probe the platform/tools/caps and
 * resolve the guest's allowlist (net+import hosts) to the PUBLIC IPs that become
 * the kernel `accept` rules. Pure decision logic is delegated to
 * `planEgressFirewall`; this only feeds it real probe results. Never throws.
 */
async function buildEgressFirewallPlan(
	netHosts: string[],
	importHosts: string[],
): Promise<EgressFirewallPlan> {
	if (NETNS_FIREWALL_DISABLED) {
		return {
			applied: false,
			reason: "disabled via SANDBOX_DISABLE_NETNS_FIREWALL=1",
		};
	}
	const os = Deno.build.os; // "linux" | "darwin" | "windows" — Deno's vocabulary
	// Cheap OS gate FIRST: skip the (slowish) tool/cap probes entirely off Linux.
	if (os !== "linux") {
		return planEgressFirewall({
			os,
			allow: [],
			tools: { unshare: false, nft: false, ip: false },
			hasCaps: false,
		});
	}
	const [unshare, nft, ip] = await Promise.all([
		hasTool("unshare"),
		hasTool("nft"),
		hasTool("ip", "-V"),
	]);
	const hasCaps = unshare ? await canCreateNetns() : false;
	// Resolve the allowlist to public IPs (best-effort; never throws). For the
	// brokered path netHosts is [] → pure default-deny netns.
	const allow = await resolveAllowedEndpoints([...netHosts, ...importHosts]);
	return planEgressFirewall({
		os,
		allow,
		tools: { unshare, nft, ip },
		hasCaps,
	});
}

/**
 * Write the per-run nft ruleset to a temp file and return `{ cmd, args, cleanup }`
 * wrapping the guest argv with `unshare`. The temp file is read by `nft -f` inside
 * the new netns, then removed by `cleanup()` after the run. Never throws — on any
 * IO failure it returns `null` so the caller falls back to the un-wrapped spawn.
 */
async function applyEgressFirewall(
	guestArgv: string[],
	ruleset: string,
): Promise<{
	cmd: string;
	args: string[];
	cleanup: () => Promise<void>;
} | null> {
	let rulesetPath: string;
	try {
		rulesetPath = await Deno.makeTempFile({
			prefix: "qp-sandbox-egress-",
			suffix: ".nft",
		});
		await Deno.writeTextFile(rulesetPath, ruleset);
	} catch (err) {
		console.warn(
			`[sandbox] egress firewall: failed to stage ruleset (${err instanceof Error ? err.message : String(err)}); spawning without netns`,
		);
		return null;
	}
	const { cmd, args } = wrapWithNetns(guestArgv, rulesetPath);
	return {
		cmd,
		args,
		cleanup: async () => {
			try {
				await Deno.remove(rulesetPath);
			} catch {
				/* best-effort */
			}
		},
	};
}

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
): Promise<{
	ok: boolean;
	value?: unknown;
	error?: { code: string; message: string };
}> {
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
	child: SandboxChildProcess,
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
			await stdinWriter.write(
				encoder.encode(FRAME_MARKER + JSON.stringify(obj) + "\n"),
			);
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
		if (
			msg.type === "rpc" &&
			typeof msg.id === "number" &&
			typeof msg.method === "string"
		) {
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
		const stderr = await child.stderr;
		await child.exited;
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
async function runInSubprocess(
	req: SandboxRunRequest,
	workloadAdmission: AgentWorkloadSandboxAdmissionClaims | null = null,
): Promise<SandboxRunResult> {
	const started = performance.now();
	// Best-effort teardown for per-run resources (work root, firewall ruleset).
	const cleanup: Array<() => void> = [];
	const finish = (r: RunOutcome): SandboxRunResult => {
		for (const dispose of cleanup.splice(0)) {
			try {
				dispose();
			} catch {
				/* best-effort cleanup */
			}
		}
		return { ...r, ms: Math.round(performance.now() - started) };
	};

	const caps: SandboxCapabilities = req.capabilities ?? {
		net: [],
		import: [],
		timeoutMs: DEFAULT_TIMEOUT_MS,
		memoryMb: DEFAULT_MEMORY_MB,
	};
	const timeoutMs = clampInt(
		caps.timeoutMs,
		DEFAULT_TIMEOUT_MS,
		1,
		MAX_TIMEOUT_MS,
	);
	const memoryMb = clampInt(
		caps.memoryMb,
		DEFAULT_MEMORY_MB,
		MIN_MEMORY_MB,
		MAX_MEMORY_MB,
	);
	const netHosts = Array.isArray(caps.net) ? caps.net : [];
	const importHosts = Array.isArray(caps.import) ? caps.import : [];

	// ── EGRESS VALIDATION (SSRF / private-IP rejection) — before spawn. ──
	const egress = await validateEgressHosts([...netHosts, ...importHosts]);
	if (!egress.ok) {
		return finish({
			ok: false,
			error: `egress blocked: ${egress.reason}`,
			logs: [],
		});
	}

	// BINDINGS URL VALIDATION (token-exfiltration defense) — before spawn.
	// A bindings run mails the per-run token to `bindings.url`; never relay to a
	// URL the supervisor was not configured to trust (see brokerUrlRejection).
	if (req.bindings) {
		const bindingsRejection = brokerUrlRejection(
			(req.bindings as { url?: unknown }).url,
			EXPECTED_BROKER_URL,
		);
		if (bindingsRejection !== null) {
			return finish({
				ok: false,
				error: `bindings rejected: ${bindingsRejection}`,
				logs: [],
			});
		}
	}

	// Every subprocess receives a fresh host-private cwd. The guest has no file
	// permissions for it and guest-entry exposes only the virtual `/work` name.
	let guestWorkRoot: string;
	try {
		if (workloadAdmission) {
			const derived = deriveAgentWorkRoot(workloadAdmission);
			if (!derived) throw new Error("invalid Agent work root configuration");
			guestWorkRoot = derived;
			await Deno.mkdir(guestWorkRoot, { recursive: true });
		} else {
			guestWorkRoot = await Deno.makeTempDir({ prefix: "qp-sandbox-work-" });
		}
		cleanup.push(() => Deno.removeSync(guestWorkRoot, { recursive: true }));
	} catch {
		return finish({
			ok: false,
			error: "failed to create sandbox work root",
			logs: [],
		});
	}
	// ── BUILD THE HARDENED SUBPROCESS COMMAND. ──
	const args = [
		"run",
		"--no-prompt",
		`--v8-flags=--max-old-space-size=${memoryMb}`,
		// net + import are INDEPENDENT axes from the manifest (do NOT alias import=net).
		...netFlag(netHosts),
		...importFlags(importHosts),
		// A self-contained data module needs neither a host path nor a socket, so it
		// remains loadable after the Linux network namespace is created.
		GUEST_RUNTIME_MODULE,
	];

	// ── DEFENSE-IN-DEPTH: wrap the spawn in a filtered netns on capable Linux. ──
	// The guest argv is `[DENO_BIN, ...args]`. On Linux+tools+caps we prefix it
	// with `unshare --net … nft -f <ruleset> … exec <guest>` so the kernel DROPS
	// egress to private/metadata ranges. Everywhere else this is a logged no-op
	// and `spawnCmd`/`spawnArgs` stay the un-wrapped guest command.
	let spawnCmd = DENO_BIN;
	let spawnArgs = args;
	try {
		const plan = await buildEgressFirewallPlan(netHosts, importHosts);
		if (plan.applied) {
			const canVirtualizeArgv0 = await supportsVirtualArgv0Env();
			const wrapped = canVirtualizeArgv0
				? await applyEgressFirewall(
						["env", "--argv0=/runtime/deno", DENO_BIN, ...args],
						plan.nftRuleset,
					)
				: null;
			if (wrapped) {
				spawnCmd = wrapped.cmd;
				spawnArgs = wrapped.args;
				cleanup.push(() => void wrapped.cleanup());
				console.log(
					`[sandbox] egress firewall: ACTIVE (netns + nftables, ${plan.allowCount} allow rule(s))`,
				);
			} else if (!canVirtualizeArgv0) {
				console.log(
					"[sandbox] egress firewall: skipped — env lacks argv0 virtualization; baseline isolation remains active",
				);
			}
			// wrapped === null → staging failed; fall through to the un-wrapped spawn.
		} else {
			// One-line notice so operators see WHY it's off (non-Linux, missing
			// tool, no caps, or disabled). Not an error — the baseline is safe.
			console.log(`[sandbox] egress firewall: skipped — ${plan.reason}`);
		}
	} catch (err) {
		// The firewall is additive: never let a probe error block a run.
		console.warn(
			`[sandbox] egress firewall: probe failed (${err instanceof Error ? err.message : String(err)}); spawning without netns`,
		);
	}

	let child: SandboxChildProcess;
	try {
		child = spawnSandboxChild(spawnCmd, spawnArgs, "/runtime/deno");
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

		const [stdout, stderr] = await Promise.all([
			readStream(child.stdout),
			child.stderr,
			child.exited,
		]);
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
		const result = extractResult(stdoutText, RESULT_MARKER);
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

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

const port = Number(Deno.env.get("PORT") ?? 8787);

Deno.serve(
	{
		port,
		onListen: ({ port }) => {
			console.log(`sandbox-server listening on :${port}`);
		},
	},
	async (request) => {
		const url = new URL(request.url);
		if (request.method === "GET" && url.pathname === "/health") {
			return jsonResponse({
				ok: true,
				runtime: "deno",
				version: Deno.version.deno,
			});
		}

		if (request.method === "POST" && url.pathname === "/run") {
			let req: SandboxRunRequest;
			let requestBody: string;
			try {
				requestBody = await request.text();
				req = JSON.parse(requestBody) as SandboxRunRequest;
			} catch {
				return jsonResponse(
					{ ok: false, error: "invalid JSON body", logs: [] },
					400,
				);
			}
			let workloadAdmission: AgentWorkloadSandboxAdmissionClaims | null = null;
			let workloadDenialReason: AgentWorkloadRuntimeAdmissionReason = "missing";
			let workloadDenialClaims: AgentWorkloadSandboxAdmissionClaims | undefined;
			if (
				req?.mode === "non_agent" &&
				!authenticatesNonAgentHost(
					request.headers.get(NON_AGENT_ADMISSION_HEADER),
				)
			) {
				auditAgentAdmission("denied", "non_agent_unauthorized");
				return jsonResponse(
					{
						ok: false,
						error: AGENT_WORKLOAD_SANDBOX_DENIAL_MESSAGE,
						logs: [],
					},
					403,
				);
			}
			if (req?.mode === "agent_workload") {
				const envelope = request.headers.get(AGENT_WORKLOAD_ADMISSION_HEADER);
				if (envelope && AGENT_ADMISSION_SECRET) {
					try {
						const verification = await verifyAgentWorkloadSandboxAdmission(
							{
								keyId: AGENT_ADMISSION_KEY_ID,
								secret: new TextEncoder().encode(AGENT_ADMISSION_SECRET),
								instanceId: SANDBOX_INSTANCE_ID,
							},
							envelope,
							requestBody,
						);
						if (verification.ok) {
							workloadAdmission = verification.claims;
						} else {
							workloadDenialReason = verification.reason;
							workloadDenialClaims = verification.claims;
						}
					} catch {
						workloadAdmission = null;
						workloadDenialReason = "invalid";
					}
				}
				if (
					workloadAdmission &&
					(typeof req.source !== "string" ||
						(await hashAgentWorkloadSandboxSource(req.source)) !==
							workloadAdmission.sourceSha256)
				) {
					workloadDenialReason = "source_mismatch";
					workloadDenialClaims = workloadAdmission;
					workloadAdmission = null;
				}
				if (workloadAdmission && !consumeAgentAdmission(workloadAdmission)) {
					workloadDenialReason = "replay";
					workloadDenialClaims = workloadAdmission;
					workloadAdmission = null;
				}
			}
			if (req?.mode === "agent_workload" && !workloadAdmission) {
				auditAgentAdmission(
					"denied",
					workloadDenialReason,
					workloadDenialClaims,
				);
				return jsonResponse(
					{
						ok: false,
						error: AGENT_WORKLOAD_SANDBOX_DENIAL_MESSAGE,
						logs: [],
					},
					403,
				);
			}
			if (req?.mode !== "agent_workload" && req?.mode !== "non_agent") {
				auditAgentAdmission("denied", "unknown_mode");
				return jsonResponse(
					{
						ok: false,
						error: AGENT_WORKLOAD_SANDBOX_DENIAL_MESSAGE,
						logs: [],
					},
					403,
				);
			}
			if (typeof req?.source !== "string" || !req?.capabilities) {
				return jsonResponse(
					{ ok: false, error: "missing 'source' or 'capabilities'", logs: [] },
					400,
				);
			}
			if (workloadAdmission) {
				auditAgentAdmission(
					"allowed",
					"admission_authorized",
					workloadAdmission,
				);
			}
			// runInSubprocess never throws — always a structured result.
			const result = await runInSubprocess(req, workloadAdmission);
			return jsonResponse(result);
		}

		return jsonResponse({ ok: false, error: "not found", logs: [] }, 404);
	},
);
