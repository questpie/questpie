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
 * I/O — TWO modes, selected by the request envelope's `bindings` flag:
 *
 *   (A) LEGACY compute-only (no bindings): stdin carries ONE envelope; stdout
 *       carries ONE result line (prefixed by RESULT_MARKER). Unchanged from M2.
 *
 *   (B) BINDINGS path (`bindings:true` in the envelope): the guest gets a
 *       capability-scoped `globalThis.questpie` proxy. stdin/stdout become a
 *       newline-delimited FRAMED channel (prefixed by FRAME_MARKER):
 *         - the FIRST stdin line is the envelope;
 *         - subsequent stdin lines are `{type:"rpc-result", id, ...}` replies;
 *         - the guest writes `{type:"rpc", id, method, args}` to stdout for each
 *           binding call and the FINAL `{type:"result", ...}` when done.
 *       The proxy NEVER sees the per-run token or a broker URL — it only writes
 *       method+args frames; the SUPERVISOR holds the token and brokers the call
 *       over stdio (NOT the network — the broker is unreachable by guest fetch by
 *       design: the egress allowlist rejects loopback/private IPs).
 */

// @ts-nocheck — Deno runtime file; not part of the Bun/tsc typecheck graph.

import { buildGuestBindings } from "./guest-bindings.ts";

/** Marker so the supervisor can pick the result line out of guest stdout noise. */
const RESULT_MARKER = "__QP_SANDBOX_RESULT__";
/** Marker prefixing each FRAMED protocol message (bindings path). */
const FRAME_MARKER = "__QP_SANDBOX_MSG__";

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

// ── 3. STDIN READERS ──

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/**
 * A line-buffered stdin reader. Yields complete
 * `\n`-delimited lines as they arrive, keeping stdin OPEN for back-and-forth.
 */
function createLineReader() {
	// deno-lint-ignore no-explicit-any
	const stdin = (Deno as any).stdin;
	const buf = new Uint8Array(65536);
	let pending = "";
	const queue: string[] = [];
	let resolveWaiter: ((line: string | null) => void) | null = null;
	let eof = false;

	async function pump() {
		while (true) {
			const n = await stdin.read(buf);
			if (n === null) {
				eof = true;
				if (pending.length > 0) {
					queue.push(pending);
					pending = "";
				}
				if (resolveWaiter) {
					const r = resolveWaiter;
					resolveWaiter = null;
					r(queue.shift() ?? null);
				}
				return;
			}
			pending += decoder.decode(buf.subarray(0, n), { stream: true });
			let idx: number;
			while ((idx = pending.indexOf("\n")) !== -1) {
				const line = pending.slice(0, idx);
				pending = pending.slice(idx + 1);
				if (resolveWaiter) {
					const r = resolveWaiter;
					resolveWaiter = null;
					r(line);
				} else {
					queue.push(line);
				}
			}
		}
	}
	void pump();

	return {
		/** Next line, or null at EOF. */
		next(): Promise<string | null> {
			if (queue.length > 0) return Promise.resolve(queue.shift() as string);
			if (eof) return Promise.resolve(null);
			return new Promise((resolve) => {
				resolveWaiter = resolve;
			});
		},
	};
}

/** Write one framed message line to stdout. */
function writeFrame(msg: unknown) {
	let payload: string;
	try {
		payload = JSON.stringify(msg);
	} catch {
		payload = JSON.stringify({ type: "result", ok: false, error: "frame not serializable", logs });
	}
	// deno-lint-ignore no-explicit-any
	(Deno as any).stdout.writeSync(encoder.encode(FRAME_MARKER + payload + "\n"));
}

/** Emit the LEGACY single-line result (no bindings). */
function emitLegacy(result: { ok: boolean; output?: unknown; logs: string[]; error?: string }) {
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
	orig.log(RESULT_MARKER + payload);
}

// ── 4. IMPORT + INVOKE THE GUEST ──

/** Dynamic-import the guest source as a blob module and return its default fn. */
async function loadGuestEntry(source: string): Promise<(input: unknown) => unknown> {
	const guestUrl = URL.createObjectURL(
		new Blob([source], { type: "application/typescript" }),
	);
	const mod = await import(guestUrl);
	const entry = mod.default;
	if (typeof entry !== "function") {
		throw new Error("guest must 'export default' a function(input)");
	}
	return entry;
}

type Envelope = {
	source: string;
	input: unknown;
	secrets?: Record<string, string>;
	/** When true, run the FRAMED bindings protocol and inject `globalThis.questpie`. */
	bindings?: boolean;
};

// ── 4b. BROKERED `fetch` SHIM ──
//
// The guest has NO direct network (`--allow-net=[]`), so the native `fetch`
// can't open a socket. We REPLACE `globalThis.fetch` with a shim that relays an
// `http.fetch` RPC over the SAME framed stdio channel as the `questpie.*` proxy
// (one `rpc` frame out, one `rpc-result` frame back — no new frame types). The
// trusted host broker does the SSRF-safe resolve→validate→pin→redirect fetch and
// returns a buffered, base64, capped `HttpFetchResponse`; we reconstruct a real
// `Response` from it. A structured broker error rejects as a `TypeError` (so
// guest code can `try/catch` a brokered fetch just like a native one).

/** Encode raw bytes to base64 (works for arbitrary binary; no Buffer in Deno). */
function bytesToBase64(bytes: Uint8Array): string {
	let binary = "";
	const chunk = 0x8000; // chunk to avoid arg-count limits on String.fromCharCode
	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
	}
	return btoa(binary);
}

/** Decode base64 to raw bytes (inverse of {@link bytesToBase64}). */
function base64ToBytes(b64: string): Uint8Array {
	const binary = atob(b64);
	const out = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
	return out;
}

/**
 * Install a `globalThis.fetch` that relays through `hostCall("http.fetch", …)`.
 * Accepts the standard `(input, init)` signature; normalizes via the web
 * `Request` constructor so url/method/headers/body are parsed exactly like a real
 * fetch (any body shape → bytes), then frames the {@link HttpFetchRequest} and
 * rebuilds a `Response` from the {@link HttpFetchResponse}.
 */
function installFetchShim(hostCall: (method: string, args: unknown) => Promise<unknown>) {
	const brokeredFetch = async (
		input: unknown,
		init?: unknown,
	): Promise<Response> => {
		// Normalize the (input, init) pair into a concrete request via the web
		// Request API (handles string/URL/Request input + every body encoding).
		let req: Request;
		try {
			req = new Request(input as never, init as never);
		} catch (e) {
			throw new TypeError(
				`Failed to construct fetch request: ${e instanceof Error ? e.message : String(e)}`,
			);
		}

		const headers: Record<string, string> = {};
		req.headers.forEach((value: string, key: string) => {
			headers[key] = value;
		});

		// Read the (already-buffered) request body as bytes → base64. GET/HEAD have
		// no body; `arrayBuffer()` yields an empty buffer which we omit.
		let bodyBase64: string | undefined;
		const buf = await req.arrayBuffer();
		if (buf.byteLength > 0) bodyBase64 = bytesToBase64(new Uint8Array(buf));

		const request: HttpFetchRequest = {
			url: req.url,
			method: req.method,
			headers,
			...(bodyBase64 !== undefined ? { bodyBase64 } : {}),
		};

		// Relay over the existing stdio RPC channel. A structured broker error
		// (network failure / blocked target / oversize) arrives as a rejected
		// hostCall — surface it as a fetch-like TypeError, NOT a fake 5xx Response.
		let value: HttpFetchResponse;
		try {
			value = (await hostCall("http.fetch", request)) as HttpFetchResponse;
		} catch (e) {
			throw new TypeError(e instanceof Error ? e.message : String(e));
		}

		const status = typeof value?.status === "number" ? value.status : 0;
		const body = value?.bodyBase64 ? base64ToBytes(value.bodyBase64) : undefined;
		// `Response` forbids a body for 101/204/205/304 and for null-body statuses;
		// guard so reconstruction never throws on those.
		const nullBody = status === 204 || status === 205 || status === 304 || status < 200;
		return new Response(nullBody ? null : (body ?? null), {
			status,
			statusText: typeof value?.statusText === "string" ? value.statusText : "",
			headers: value?.headers ?? {},
		});
	};

	// deno-lint-ignore no-explicit-any
	(globalThis as any).fetch = brokeredFetch;
}

/** Wire types for the brokered `http.fetch` RPC (mirrors host `protocol.ts`). */
interface HttpFetchRequest {
	url: string;
	method?: string;
	headers?: Record<string, string>;
	bodyBase64?: string;
}
interface HttpFetchResponse {
	status: number;
	statusText: string;
	headers: Record<string, string>;
	bodyBase64: string;
	truncated: boolean;
}

/** BINDINGS run — framed channel + `globalThis.questpie` proxy. */
async function runWithBindings(envelope: Envelope, reader: { next(): Promise<string | null> }) {
	// Pending host calls keyed by correlation id.
	const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
	let nextId = 1;

	// The injected transport: write an `rpc` frame, await its `rpc-result`.
	const hostCall = (method: string, args: unknown): Promise<unknown> => {
		const id = nextId++;
		return new Promise<unknown>((resolve, reject) => {
			pending.set(id, { resolve, reject });
			writeFrame({ type: "rpc", id, method, args });
		});
	};

	// Background loop: consume `rpc-result` frames and settle pending calls. It
	// runs until stdin EOF (the supervisor closes it after the run ends).
	const drain = (async () => {
		while (true) {
			const line = await reader.next();
			if (line === null) break;
			if (line.length === 0) continue;
			const json = line.startsWith(FRAME_MARKER) ? line.slice(FRAME_MARKER.length) : line;
			let msg: { type?: string; id?: number; ok?: boolean; value?: unknown; error?: { message?: string } };
			try {
				msg = JSON.parse(json);
			} catch {
				continue;
			}
			if (msg?.type === "rpc-result" && typeof msg.id === "number") {
				const p = pending.get(msg.id);
				if (!p) continue;
				pending.delete(msg.id);
				if (msg.ok) {
					p.resolve(msg.value);
				} else {
					const m = msg.error?.message ?? "binding call rejected";
					p.reject(new Error(m));
				}
			}
		}
		// Stdin closed: reject any still-pending calls so the guest can't hang.
		for (const [, p] of pending) p.reject(new Error("host channel closed"));
		pending.clear();
	})();

	try {
		// deno-lint-ignore no-explicit-any
		(globalThis as any).__secrets = envelope.secrets ?? {};
		// deno-lint-ignore no-explicit-any
		(globalThis as any).questpie = buildGuestBindings(hostCall);
		// Replace native fetch with the brokered shim (guest has no direct net).
		installFetchShim(hostCall);
	} catch {
		/* noop */
	}

	try {
		const entry = await loadGuestEntry(envelope.source);
		const output = await entry(envelope.input);
		writeFrame({ type: "result", ok: true, output, logs });
	} catch (err) {
		writeFrame({
			type: "result",
			ok: false,
			error: err instanceof Error ? err.message : String(err),
			logs,
		});
	}
	// Surface unexpected drain failures (best effort; the result is already out).
	void drain.catch(() => {});
}

async function main() {
	// Peek the envelope to choose the protocol. For the bindings path we need a
	// line reader (stdin stays open); for legacy we read all of stdin. We always
	// read the FIRST line via the line reader, then branch.
	const reader = createLineReader();
	const firstLine = await reader.next();
	if (firstLine === null) {
		emitLegacy({ ok: false, error: "empty request envelope", logs });
		return;
	}
	let envelope: Envelope;
	try {
		const json = firstLine.startsWith(FRAME_MARKER)
			? firstLine.slice(FRAME_MARKER.length)
			: firstLine;
		envelope = JSON.parse(json);
	} catch {
		emitLegacy({ ok: false, error: "failed to read/parse request envelope", logs });
		return;
	}

	if (envelope.bindings) {
		await runWithBindings(envelope, reader);
	} else {
		// Legacy path: the envelope was the whole stdin (single line). Run it.
		try {
			// deno-lint-ignore no-explicit-any
			(globalThis as any).__secrets = envelope.secrets ?? {};
		} catch {
			/* noop */
		}
		try {
			const entry = await loadGuestEntry(envelope.source);
			const output = await entry(envelope.input);
			emitLegacy({ ok: true, output, logs });
		} catch (err) {
			emitLegacy({ ok: false, error: err instanceof Error ? err.message : String(err), logs });
		}
	}
}

await main();
// Ensure the process exits promptly even if the guest left timers/handles open.
// deno-lint-ignore no-explicit-any
(Deno as any).exit(0);
