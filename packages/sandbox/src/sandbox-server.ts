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
	normalizeBrokerUrl,
	parseBrokerResponse,
	parseSandboxRunResult,
	type RunOutcome,
} from "./server-internals.ts";
import {
	BINDINGS_TOKEN_HEADER,
	FRAME_MARKER,
	HOST_ADMISSION_HEADER,
	WORKLOAD_ADMISSION_HEADER,
} from "./types.ts";
import type {
	SandboxCapabilities,
	SandboxRunRequest,
	SandboxRunResult,
} from "./types.ts";
import {
	SandboxWorkloadReplayCache,
	assertSandboxWorkloadAdmissionKey,
	verifySandboxWorkloadAdmission,
	type SandboxWorkloadAdmissionClaims,
	type SandboxWorkloadAdmissionDenialReason,
} from "./workload-admission.ts";
import {
	SANDBOX_WORKLOAD_DENIAL_MESSAGE,
	parseSandboxRunRequest,
} from "./workload.ts";

/** Bound on a single binding RPC round-trip to the host broker. */
const BROKER_FETCH_TIMEOUT_MS = 10_000;
const MAX_BROKER_RESPONSE_BYTES = 1_048_576;

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 30_000;
const DEFAULT_MEMORY_MB = 128;
const MIN_MEMORY_MB = 16;
const MAX_MEMORY_MB = 1024;
const MAX_REQUEST_BODY_BYTES = 2 * 1024 * 1024;
const MAX_CONSUMED_WORKLOAD_ADMISSIONS = 10_000;
const MAX_FRAME_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_OUTPUT_BYTES = 3 * 1024 * 1024;
const MAX_STDERR_BYTES = 256 * 1024;
const MAX_RPC_COUNT = 256;
const MAX_INFLIGHT_RPCS = 16;
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
 * relay. Bindings fail closed when this canonical URL is missing or malformed.
 */
const EXPECTED_BROKER_URL = Deno.env.get("SANDBOX_BROKER_URL")?.trim();
const WORKLOAD_ADMISSION_SECRET = Deno.env
	.get("SANDBOX_WORKLOAD_ADMISSION_SECRET")
	?.trim();
const WORKLOAD_ADMISSION_KEY_ID =
	Deno.env.get("SANDBOX_WORKLOAD_ADMISSION_KEY_ID")?.trim() ??
	"sandbox-workload-v1";
const SANDBOX_INSTANCE_ID = Deno.env.get("SANDBOX_INSTANCE_ID")?.trim() ?? "";
const HOST_ADMISSION_SECRET = Deno.env
	.get("SANDBOX_HOST_ADMISSION_SECRET")
	?.trim();
if (WORKLOAD_ADMISSION_SECRET) {
	assertSandboxWorkloadAdmissionKey({
		keyId: WORKLOAD_ADMISSION_KEY_ID,
		secret: new TextEncoder().encode(WORKLOAD_ADMISSION_SECRET),
		instanceId: SANDBOX_INSTANCE_ID,
	});
}
const consumedWorkloadAdmissions = new SandboxWorkloadReplayCache(
	MAX_CONSUMED_WORKLOAD_ADMISSIONS,
);

interface SandboxChildProcess {
	readonly stdin: WritableStream<Uint8Array>;
	readonly stdout: ReadableStream<Uint8Array>;
	readonly stderr: ReadableStream<Uint8Array>;
	readonly exited: Promise<void>;
	kill(signal: "SIGKILL" | "SIGTERM"): void;
}

class SandboxOutputLimitError extends Error {}

interface OutputBudget {
	total: number;
}

async function readStream(
	stream: ReadableStream<Uint8Array>,
	budget: OutputBudget,
	maximumBytes: number,
	onLimit: () => void,
): Promise<Uint8Array> {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let streamTotal = 0;
	while (true) {
		const { value, done } = await reader.read();
		if (done) break;
		streamTotal += value.byteLength;
		budget.total += value.byteLength;
		if (streamTotal > maximumBytes || budget.total > MAX_TOTAL_OUTPUT_BYTES) {
			onLimit();
			await reader.cancel();
			throw new SandboxOutputLimitError();
		}
		chunks.push(value);
	}
	const output = new Uint8Array(streamTotal);
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return output;
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
		stderr: Readable.toWeb(child.stderr),
		exited,
		kill: (signal) => {
			child.kill(signal);
		},
	};
}

function authenticatesHost(value: string | null): boolean {
	if (
		!value ||
		!HOST_ADMISSION_SECRET ||
		new TextEncoder().encode(HOST_ADMISSION_SECRET).byteLength < 32
	) {
		return false;
	}
	const expected = new TextEncoder().encode(HOST_ADMISSION_SECRET);
	const actual = new TextEncoder().encode(value);
	if (actual.byteLength !== expected.byteLength) return false;
	let difference = 0;
	for (let index = 0; index < expected.byteLength; index += 1) {
		difference |= expected[index] ^ actual[index];
	}
	return difference === 0;
}

type WorkloadAdmissionReason =
	| SandboxWorkloadAdmissionDenialReason
	| "authorized"
	| "host_unauthorized"
	| "missing"
	| "replay"
	| "unknown_mode";

function auditWorkloadAdmission(
	decision: "allowed" | "denied",
	reason: WorkloadAdmissionReason,
	claims?: SandboxWorkloadAdmissionClaims,
): void {
	console.log(
		JSON.stringify(
			Object.freeze({
				event: "questpie.sandbox.workload_admission",
				boundary: "sandbox.runtime_admission",
				decision,
				reason,
				...(claims
					? { supervisorInstanceId: claims.supervisorInstanceId }
					: {}),
			}),
		),
	);
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

async function runProbe(
	command: string,
	args: string[],
	signal?: AbortSignal,
): Promise<boolean> {
	if (signal?.aborted) return false;
	let child;
	try {
		child = new Deno.Command(command, {
			args,
			stdin: "null",
			stdout: "null",
			stderr: "null",
		}).spawn();
		const onAbort = () => {
			try {
				child.kill("SIGKILL");
			} catch {
				/* already exited */
			}
		};
		signal?.addEventListener("abort", onAbort, { once: true });
		if (signal?.aborted) onAbort();
		try {
			return (await child.output()).success && !signal?.aborted;
		} finally {
			signal?.removeEventListener("abort", onAbort);
		}
	} catch {
		return false;
	}
}

/** Probe PATH for a tool by exec'ing `<tool> --version` (no shell). Never throws. */
function hasTool(
	tool: string,
	versionArg = "--version",
	signal?: AbortSignal,
): Promise<boolean> {
	return runProbe(tool, [versionArg], signal);
}

/**
 * Probe whether the supervisor can actually CREATE a filtered netns. We don't
 * parse capability bitmasks — we just attempt the real operation cheaply:
 * `unshare --net --map-root-user true`. If it exits 0 the host supports an
 * (unprivileged-userns or root) network namespace; if it EPERMs, we no-op.
 * This is the most honest probe: it tests the exact syscall path we'll use.
 */
function canCreateNetns(signal?: AbortSignal): Promise<boolean> {
	return runProbe("unshare", ["--net", "--map-root-user", "true"], signal);
}

/** GNU env can set argv[0] for the Deno process inside the netns wrapper. */
function supportsVirtualArgv0Env(signal?: AbortSignal): Promise<boolean> {
	return runProbe("env", ["--argv0=/runtime/deno", "true"], signal);
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
	signal?: AbortSignal,
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
		hasTool("unshare", "--version", signal),
		hasTool("nft", "--version", signal),
		hasTool("ip", "-V", signal),
	]);
	const hasCaps = unshare ? await canCreateNetns(signal) : false;
	// Resolve the allowlist to public IPs (best-effort; never throws). For the
	// brokered path netHosts is [] → pure default-deny netns.
	const allow = await resolveAllowedEndpoints([...netHosts, ...importHosts], {
		signal,
	});
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
	signal?: AbortSignal,
): Promise<{
	cmd: string;
	args: string[];
	cleanup: () => Promise<void>;
} | null> {
	let rulesetPath: string;
	try {
		if (signal?.aborted) return null;
		rulesetPath = await Deno.makeTempFile({
			prefix: "qp-sandbox-egress-",
			suffix: ".nft",
		});
		if (signal?.aborted) {
			await Deno.remove(rulesetPath);
			return null;
		}
		await Deno.writeTextFile(rulesetPath, ruleset);
		if (signal?.aborted) {
			await Deno.remove(rulesetPath);
			return null;
		}
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
	parentSignal?: AbortSignal,
): Promise<{
	ok: boolean;
	value?: unknown;
	error?: { code: string; message: string };
}> {
	const controller = new AbortController();
	const onAbort = () => controller.abort();
	if (parentSignal?.aborted) controller.abort();
	else parentSignal?.addEventListener("abort", onAbort, { once: true });
	const t = setTimeout(() => controller.abort(), BROKER_FETCH_TIMEOUT_MS);
	try {
		const res = await fetch(bindings.url, {
			method: "POST",
			redirect: "error",
			headers: {
				"content-type": "application/json",
				[BINDINGS_TOKEN_HEADER]: bindings.token,
			},
			body: JSON.stringify({ method, args }),
			signal: controller.signal,
		});
		const reader = res.body?.getReader();
		const chunks: Uint8Array[] = [];
		let total = 0;
		if (reader) {
			while (true) {
				const { value, done } = await reader.read();
				if (done) break;
				total += value.byteLength;
				if (total > MAX_BROKER_RESPONSE_BYTES) {
					await reader.cancel();
					return {
						ok: false,
						error: {
							code: "execution_error",
							message: "sandbox broker returned an invalid response",
						},
					};
				}
				chunks.push(value);
			}
		}
		const bytes = new Uint8Array(total);
		let offset = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, offset);
			offset += chunk.byteLength;
		}
		const text = new TextDecoder().decode(bytes);
		try {
			const parsed = parseBrokerResponse(JSON.parse(text));
			if (!res.ok) {
				return parsed && !parsed.ok
					? parsed
					: {
							ok: false,
							error: {
								code: "execution_error",
								message: "sandbox binding operation failed",
							},
						};
			}
			return (
				parsed ?? {
					ok: false,
					error: {
						code: "execution_error",
						message: "sandbox broker returned an invalid response",
					},
				}
			);
		} catch {
			return {
				ok: false,
				error: {
					code: "execution_error",
					message: "sandbox broker returned an invalid response",
				},
			};
		}
	} catch {
		return {
			ok: false,
			error: {
				code: "execution_error",
				message: "sandbox broker request failed",
			},
		};
	} finally {
		clearTimeout(t);
		parentSignal?.removeEventListener("abort", onAbort);
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
	stderrPromise: Promise<Uint8Array>,
	outputBudget: OutputBudget,
	onLimit: () => void,
	onTerminal: () => void,
	signal?: AbortSignal,
): Promise<RunOutcome> {
	const requestedBindings = req.bindings as { url: string; token: string };
	const bindings = {
		...requestedBindings,
		url: normalizeBrokerUrl(requestedBindings.url)!,
	};
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
	let terminalFailure: string | null = null;
	let pending = "";
	let rpcCount = 0;
	const inflight = new Set<Promise<void>>();

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
			rpcCount += 1;
			if (rpcCount > MAX_RPC_COUNT) {
				onLimit();
				throw new SandboxOutputLimitError();
			}
			while (inflight.size >= MAX_INFLIGHT_RPCS) {
				await Promise.race(inflight);
			}
			const id = msg.id;
			const p = (async () => {
				const r = await brokerCall(
					bindings,
					msg.method as string,
					msg.args,
					signal,
				);
				if (!r.ok) {
					if (!terminalFailure && !outcome) {
						terminalFailure = r.error.message;
						onTerminal();
					}
					return;
				}
				if (signal?.aborted || terminalFailure || outcome) return;
				await writeLine({
					type: "rpc-result",
					id,
					ok: !!r.ok,
					value: r.value,
					error: r.error,
				});
			})();
			inflight.add(p);
			void p.finally(() => inflight.delete(p));
		} else if (msg.type === "result") {
			const keys = Object.keys(msg);
			if (
				keys.every((key) =>
					["type", "ok", "output", "error", "logs"].includes(key),
				)
			) {
				const parsed = parseSandboxRunResult({
					ok: msg.ok,
					...(Object.hasOwn(msg, "output") ? { output: msg.output } : {}),
					...(Object.hasOwn(msg, "error") ? { error: msg.error } : {}),
					logs: msg.logs,
				});
				if (!parsed) {
					terminalFailure = "sandbox guest returned an invalid result";
					onTerminal();
				} else if (inflight.size > 0) {
					terminalFailure = "sandbox result raced binding calls";
					onTerminal();
				} else {
					outcome = parsed;
					onTerminal();
				}
			} else {
				terminalFailure = "sandbox guest returned an invalid result";
				onTerminal();
			}
		}
	};

	try {
		const reader = child.stdout.getReader();
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			outputBudget.total += value.byteLength;
			if (outputBudget.total > MAX_TOTAL_OUTPUT_BYTES) {
				onLimit();
				throw new SandboxOutputLimitError();
			}
			pending += decoder.decode(value, { stream: true });
			if (
				!pending.includes("\n") &&
				encoder.encode(pending).byteLength > MAX_FRAME_BYTES
			) {
				onLimit();
				throw new SandboxOutputLimitError();
			}
			let idx: number;
			while ((idx = pending.indexOf("\n")) !== -1) {
				const line = pending.slice(0, idx);
				pending = pending.slice(idx + 1);
				if (encoder.encode(line).byteLength > MAX_FRAME_BYTES) {
					onLimit();
					throw new SandboxOutputLimitError();
				}
				await handleLine(line);
				if (outcome || terminalFailure) break;
			}
			if (outcome || terminalFailure) break;
			if (timedOut()) break;
		}
		// Flush a trailing line without newline (the final result frame may not
		// be newline-terminated before exit).
		if (!outcome && !terminalFailure && pending.length > 0) {
			await handleLine(pending.trim());
		}
	} catch (error) {
		if (error instanceof SandboxOutputLimitError) throw error;
		/* stdout closed abruptly — fall through to the no-result handling */
	}

	// Settle outstanding broker relays, then close the guest's stdin so its drain
	// loop ends and the process can exit.
	await Promise.allSettled(inflight);
	await closeStdin();

	// Drain remaining stdout + collect stderr for diagnostics, then reap.
	let stderrText = "";
	try {
		const stderr = await stderrPromise;
		await child.exited;
		stderrText = decoder.decode(stderr).trim();
	} catch {
		/* already consumed/killed */
	}

	if (terminalFailure) {
		return { ok: false, error: terminalFailure, logs: [] };
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
	signal?: AbortSignal,
): Promise<SandboxRunResult> {
	const started = performance.now();
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
	let deadlineTimedOut = false;
	let parentCancelled = signal?.aborted ?? false;
	const executionController = new AbortController();
	const onParentAbort = () => {
		parentCancelled = true;
		executionController.abort();
	};
	if (signal?.aborted) executionController.abort();
	else signal?.addEventListener("abort", onParentAbort, { once: true });
	const absoluteTimer = setTimeout(() => {
		deadlineTimedOut = true;
		executionController.abort();
	}, timeoutMs);
	const executionSignal = executionController.signal;
	// Best-effort teardown for per-run resources (work root, firewall ruleset).
	const cleanup: Array<() => void> = [
		() => clearTimeout(absoluteTimer),
		() => signal?.removeEventListener("abort", onParentAbort),
	];
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
	const interrupted = (): SandboxRunResult =>
		finish(
			deadlineTimedOut
				? {
						ok: false,
						timedOut: true,
						error: `wall-time exceeded (${timeoutMs}ms)`,
						logs: [],
					}
				: {
						ok: false,
						error: "sandbox request cancelled",
						logs: [],
					},
		);
	if (executionSignal.aborted) {
		return interrupted();
	}

	const memoryMb = clampInt(
		caps.memoryMb,
		DEFAULT_MEMORY_MB,
		MIN_MEMORY_MB,
		MAX_MEMORY_MB,
	);
	const netHosts = Array.isArray(caps.net) ? caps.net : [];
	const importHosts = Array.isArray(caps.import) ? caps.import : [];

	// ── EGRESS VALIDATION (SSRF / private-IP rejection) — before spawn. ──
	const egress = await validateEgressHosts([...netHosts, ...importHosts], {
		signal: executionSignal,
		timeoutMs,
		concurrency: 4,
	});
	if (executionSignal.aborted) {
		return interrupted();
	}
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
		if (executionSignal.aborted) return interrupted();
		guestWorkRoot = await Deno.makeTempDir({ prefix: "qp-sandbox-work-" });
		cleanup.push(() => Deno.removeSync(guestWorkRoot, { recursive: true }));
		if (executionSignal.aborted) return interrupted();
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
		const plan = await buildEgressFirewallPlan(
			netHosts,
			importHosts,
			executionSignal,
		);
		if (plan.applied) {
			const canVirtualizeArgv0 = await supportsVirtualArgv0Env(executionSignal);
			const wrapped = canVirtualizeArgv0
				? await applyEgressFirewall(
						["env", "--argv0=/runtime/deno", DENO_BIN, ...args],
						plan.nftRuleset,
						executionSignal,
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
	if (executionSignal.aborted) {
		return interrupted();
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

	let outputLimitExceeded = false;
	let cancelGraceTimer: number | undefined;
	const relayController = new AbortController();
	let terminationStarted = false;
	const terminateChild = () => {
		if (terminationStarted) return;
		terminationStarted = true;
		try {
			child.kill("SIGTERM");
		} catch {
			/* already gone */
		}
		cancelGraceTimer = setTimeout(() => {
			try {
				child.kill("SIGKILL");
			} catch {
				/* already gone */
			}
		}, KILL_GRACE_MS);
	};
	const onExecutionAbort = () => {
		relayController.abort();
		terminateChild();
	};
	const onOutputLimit = () => {
		if (outputLimitExceeded) return;
		outputLimitExceeded = true;
		relayController.abort();
		terminateChild();
	};
	if (executionSignal.aborted) onExecutionAbort();
	else
		executionSignal.addEventListener("abort", onExecutionAbort, { once: true });
	const outputBudget: OutputBudget = { total: 0 };
	const stderrPromise = readStream(
		child.stderr,
		outputBudget,
		MAX_STDERR_BYTES,
		onOutputLimit,
	);
	void stderrPromise.catch(() => {});

	try {
		// ── BINDINGS PATH: framed stdio relay to the host broker. ──
		if (req.bindings) {
			const outcome = await relayBindingsRun(
				child,
				req,
				() => deadlineTimedOut,
				stderrPromise,
				outputBudget,
				onOutputLimit,
				() => {
					relayController.abort();
					terminateChild();
				},
				relayController.signal,
			);
			if (cancelGraceTimer !== undefined) clearTimeout(cancelGraceTimer);
			executionSignal.removeEventListener("abort", onExecutionAbort);
			if (parentCancelled) {
				return finish({
					ok: false,
					error: "sandbox request cancelled",
					logs: outcome?.logs ?? [],
				});
			}
			if (outputLimitExceeded) {
				return finish({
					ok: false,
					error: "sandbox output limit exceeded",
					logs: [],
				});
			}
			if (deadlineTimedOut) {
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
			readStream(
				child.stdout,
				outputBudget,
				MAX_TOTAL_OUTPUT_BYTES,
				onOutputLimit,
			),
			stderrPromise,
			child.exited,
		]);
		if (cancelGraceTimer !== undefined) clearTimeout(cancelGraceTimer);
		executionSignal.removeEventListener("abort", onExecutionAbort);

		if (parentCancelled) {
			return finish({
				ok: false,
				error: "sandbox request cancelled",
				logs: [],
			});
		}
		if (outputLimitExceeded) {
			return finish({
				ok: false,
				error: "sandbox output limit exceeded",
				logs: [],
			});
		}
		if (deadlineTimedOut) {
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
		if (cancelGraceTimer !== undefined) clearTimeout(cancelGraceTimer);
		executionSignal.removeEventListener("abort", onExecutionAbort);
		try {
			child.kill("SIGKILL");
		} catch {
			/* noop */
		}
		if (parentCancelled || deadlineTimedOut) return interrupted();
		return finish({
			ok: false,
			error:
				outputLimitExceeded || err instanceof SandboxOutputLimitError
					? "sandbox output limit exceeded"
					: `sandbox IO error: ${err instanceof Error ? err.message : String(err)}`,
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

class RequestBodyTooLargeError extends Error {}

async function readBoundedRequestBody(request: Request): Promise<string> {
	const declared = request.headers.get("content-length");
	if (
		declared !== null &&
		Number.isFinite(Number(declared)) &&
		Number(declared) > MAX_REQUEST_BODY_BYTES
	) {
		throw new RequestBodyTooLargeError();
	}
	if (!request.body) return "";
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	while (true) {
		const { value, done } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > MAX_REQUEST_BODY_BYTES) {
			await reader.cancel();
			throw new RequestBodyTooLargeError();
		}
		chunks.push(value);
	}
	const body = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(body);
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
				requestBody = await readBoundedRequestBody(request);
				req = JSON.parse(requestBody) as SandboxRunRequest;
			} catch (error) {
				if (error instanceof RequestBodyTooLargeError) {
					return jsonResponse(
						{ ok: false, error: "request body too large", logs: [] },
						413,
					);
				}
				return jsonResponse(
					{ ok: false, error: "invalid JSON body", logs: [] },
					400,
				);
			}
			let workloadAdmission: SandboxWorkloadAdmissionClaims | null = null;
			let workloadDenialReason: WorkloadAdmissionReason = "missing";
			let workloadDenialClaims: SandboxWorkloadAdmissionClaims | undefined;
			if (
				req?.mode === "host" &&
				!authenticatesHost(request.headers.get(HOST_ADMISSION_HEADER))
			) {
				auditWorkloadAdmission("denied", "host_unauthorized");
				return jsonResponse(
					{
						ok: false,
						error: SANDBOX_WORKLOAD_DENIAL_MESSAGE,
						logs: [],
					},
					403,
				);
			}
			if (req?.mode === "workload") {
				const envelope = request.headers.get(WORKLOAD_ADMISSION_HEADER);
				if (envelope && WORKLOAD_ADMISSION_SECRET) {
					try {
						const verification = await verifySandboxWorkloadAdmission(
							{
								keyId: WORKLOAD_ADMISSION_KEY_ID,
								secret: new TextEncoder().encode(WORKLOAD_ADMISSION_SECRET),
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
			}
			if (req?.mode === "workload" && !workloadAdmission) {
				auditWorkloadAdmission(
					"denied",
					workloadDenialReason,
					workloadDenialClaims,
				);
				return jsonResponse(
					{
						ok: false,
						error: SANDBOX_WORKLOAD_DENIAL_MESSAGE,
						logs: [],
					},
					403,
				);
			}
			if (req?.mode !== "workload" && req?.mode !== "host") {
				auditWorkloadAdmission("denied", "unknown_mode");
				return jsonResponse(
					{
						ok: false,
						error: SANDBOX_WORKLOAD_DENIAL_MESSAGE,
						logs: [],
					},
					403,
				);
			}
			const validatedRequest = parseSandboxRunRequest(req);
			if (!validatedRequest) {
				return jsonResponse(
					{ ok: false, error: "invalid sandbox request", logs: [] },
					400,
				);
			}
			req = validatedRequest;
			if (
				workloadAdmission &&
				!consumedWorkloadAdmissions.consume(workloadAdmission)
			) {
				auditWorkloadAdmission("denied", "replay", workloadAdmission);
				return jsonResponse(
					{
						ok: false,
						error: SANDBOX_WORKLOAD_DENIAL_MESSAGE,
						logs: [],
					},
					403,
				);
			}
			if (workloadAdmission) {
				auditWorkloadAdmission("allowed", "authorized", workloadAdmission);
			}
			// runInSubprocess never throws — always a structured result.
			const result = await runInSubprocess(req, request.signal);
			if (
				req.mode === "workload" &&
				!result.ok &&
				!result.timedOut &&
				result.error !== "sandbox request cancelled"
			) {
				return jsonResponse({
					...result,
					error: "sandbox execution failed",
				});
			}
			return jsonResponse(result);
		}

		return jsonResponse({ ok: false, error: "not found", logs: [] }, 404);
	},
);
