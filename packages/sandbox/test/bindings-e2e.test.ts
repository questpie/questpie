/**
 * END-TO-END bindings test — the FULL untrusted path, running for real.
 *
 *   guest (real Deno subprocess)  ──framed stdio──▶  supervisor (sandbox-server.ts)
 *                                                          │  HTTP + per-run token
 *                                                          ▼
 *                                              REAL SandboxBroker (questpie)
 *                                                          │  capability check + …
 *                                                          ▼
 *                                              REAL hostFetch (SSRF-safe egress)
 *
 * Proves (per the task's Verify block):
 *   1. A guest `collections.<allowed>.find()` WITHIN its capabilities → brokered
 *      result returned to the guest.
 *   2. A guest call to a collection OUTSIDE its capabilities → REJECTED host-side
 *      (default-deny), surfaced to the guest as a thrown error.
 *   3. The guest CANNOT reach the broker via `fetch` (loopback rejected by the
 *      egress allowlist) — the binding path is STDIO, not the network.
 *
 * ★ THE REBIND ACCEPTANCE (`http-egress` describe): the broker's `http.fetch` is
 * NOT a stub — it runs the REAL `hostFetch` from `questpie` (resolve → validate
 * ALL ips → PIN → re-validate every redirect). A run is minted with a `net`
 * allowlist (so the host PASSES the capability check) AND an injected DNS
 * resolver. When that resolver returns a PRIVATE/metadata ip for the allowlisted
 * host, a real Deno guest `fetch("https://<allowlisted>")` → stdio relay → real
 * `hostFetch` MUST be DENIED end-to-end: the guest's `fetch` rejects and the
 * internal target is never reached. This proves the full guest→relay→broker path
 * closes the DNS-rebind / TOCTOU window — not just the host-fetch unit. A control
 * proves an allowlisted host resolving to a real (test-local) origin succeeds
 * 200 + body through the SAME path.
 *
 * The broker is a tiny stand-in that delegates to the REAL `SandboxBroker` from
 * `questpie` (so the actual capability enforcement + SSRF host fetch run), wired
 * to a fake in-memory data target. Requires `deno` on PATH (the sandbox engine);
 * skipped otherwise so CI without Deno stays green.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Buffer } from "node:buffer";
import { createServer, type Server } from "node:http";

import {
	type BindingTarget,
	classifyIpLiteral,
	type ExecutorCapabilities,
	type IpValidationResult,
	SandboxBroker,
} from "questpie/executor";

/** Per-IP egress validator (mirrors `hostFetch`'s injectable `validateIp`). */
type IpValidator = (ip: string) => IpValidationResult;

import { httpSandboxAdapter } from "../src/adapter-http.js";
import { BINDINGS_TOKEN_HEADER } from "../src/types.js";

const denoPath = Bun.which("deno");
const SERVER_ENTRY = new URL("../src/sandbox-server.ts", import.meta.url)
	.pathname;

// ── A real SandboxBroker over a fake data target (orders: read-only). ──
const broker = new SandboxBroker();
const SCOPE = {
	data: { collections: { orders: ["read"] as Array<"read"> } },
	files: { read: ["company/data/**"] },
};
const target = {
	files: {
		read: async (args: unknown) => ({
			path: (args as { path: string }).path,
			body: "secret-note",
		}),
	},
	collections: {
		orders: {
			find: async (args: unknown) => ({ docs: [{ id: "o1", arg: args }] }),
			findOne: async () => ({ id: "o1" }),
		},
	},
};

// ──────────────────────────────────────────────────────────────────────────
// `http.fetch` is brokered through the REAL `hostFetch` (NOT a stub). A LOCAL
// HTTP origin on 127.0.0.1 stands in for the "public" target; the per-run target
// injects a DNS resolver that maps the allowlisted hostname → this origin (so the
// SSRF pin connects to the literal while the Host header stays the hostname). The
// adversarial tests flip the SAME hostname's resolution to a private/metadata ip
// after the allowlist check — and assert the brokered fetch is DENIED end-to-end.
// ──────────────────────────────────────────────────────────────────────────
const ALLOWED_HOST = "api.allowed.example";
const FETCH_BODY = JSON.stringify({ hello: "world", n: 42 });
const FETCH_STATUS = 201;
const FETCH_STATUS_TEXT = "Created";

let origin: Server;
let originPort = 0;
/** Records what the local origin saw — to assert the pin connected to the literal. */
const originSeen: Array<{
	url: string;
	host: string | undefined;
	method: string;
	body: string;
}> = [];

/** TEST-ONLY validator: allow the loopback origin, real policy for everything else. */
const allowLoopback: IpValidator = (ip) =>
	ip === "127.0.0.1" || ip === "::1" ? { ok: true } : classifyIpLiteral(ip);

/** Deterministic offline resolver from a `hostname → ip[]` map. */
const resolverFrom =
	(map: Record<string, string[]>) =>
	async (hostname: string): Promise<string[]> => {
		if (hostname in map) return map[hostname];
		throw new Error(`NXDOMAIN: ${hostname}`);
	};

/**
 * Mint a run scoped for HTTP egress: a `net` allowlist (the capability check the
 * host PASSES) + an injected `hostFetch` resolver/validator (the connect-time SSRF
 * policy the host ENFORCES). The allowlist and the resolution are deliberately
 * DECOUPLED — that gap is exactly the rebind window this suite proves is closed.
 */
function mintHttp(opts: {
	net: string[];
	resolve: (hostname: string) => Promise<string[]>;
	validateIp?: IpValidator;
}) {
	const capabilities: ExecutorCapabilities = { net: opts.net };
	const targetHttp: BindingTarget = {
		http: {
			fetchOptions: { resolve: opts.resolve, validateIp: opts.validateIp },
		},
	};
	return broker.mint({ capabilities, target: targetHttp });
}

let brokerServer: ReturnType<typeof Bun.serve> | undefined;
let brokerUrl = "";
let denoProc: ReturnType<typeof Bun.spawn> | undefined;
let sandboxUrl = "";
const HOST_SECRET = "questpie-sandbox-host-service-key-32-bytes-minimum";

async function waitForListen(
	proc: ReturnType<typeof Bun.spawn>,
): Promise<number> {
	const reader = proc.stdout.getReader();
	const decoder = new TextDecoder();
	const deadline = Date.now() + 15_000;
	let buf = "";
	while (Date.now() < deadline) {
		const { value, done } = await reader.read();
		if (done) break;
		buf += decoder.decode(value, { stream: true });
		const m = buf.match(/listening on :(\d+)/);
		if (m) {
			reader.releaseLock();
			return Number(m[1]);
		}
	}
	reader.releaseLock();
	throw new Error(`sandbox-server did not start; output:\n${buf}`);
}

beforeAll(async () => {
	if (!denoPath) return;

	// Local HTTP origin standing in for a "public" target the SSRF pin connects to.
	origin = createServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on("data", (c) => chunks.push(c as Buffer));
		req.on("end", () => {
			originSeen.push({
				url: req.url ?? "",
				host: req.headers.host,
				method: req.method ?? "",
				body: Buffer.concat(chunks).toString("utf8"),
			});
			if (req.url === "/redirect-internal") {
				// 302 to a host that resolves PRIVATE — re-validated at the redirect hop.
				res.writeHead(302, { location: "http://internal.evil.example/secret" });
				return res.end();
			}
			// The default route returns the known 201 contract the shim reconstructs.
			res.writeHead(FETCH_STATUS, {
				"content-type": "application/json",
				"x-from-broker": "yes",
			});
			res.end(FETCH_BODY);
		});
	});
	await new Promise<void>((r) => origin.listen(0, "127.0.0.1", r));
	originPort = (origin.address() as { port: number }).port;

	// Fake broker HTTP endpoint → real SandboxBroker.handleRpc. `http.fetch` is NOT
	// special-cased: it flows through `handleRpc` → capability check → the REAL
	// SSRF-safe `hostFetch` (the per-run target injects the resolver/validator), so
	// the guest's brokered fetch exercises the actual rebind/SSRF defense.
	brokerServer = Bun.serve({
		port: 0,
		async fetch(req) {
			const token = req.headers.get(BINDINGS_TOKEN_HEADER);
			const body = (await req.json()) as { method: string; args: unknown };
			const result = await broker.handleRpc(token, body.method, body.args);
			return new Response(JSON.stringify(result), {
				headers: { "content-type": "application/json" },
			});
		},
	});
	brokerUrl = `http://127.0.0.1:${brokerServer.port}/rpc`;

	// Real Deno sandbox supervisor on an ephemeral port.
	denoProc = Bun.spawn(
		[
			denoPath as string,
			"run",
			"--allow-net",
			"--allow-env",
			"--allow-run",
			"--allow-read",
			"--allow-write",
			SERVER_ENTRY,
		],
		{
			env: {
				...process.env,
				PORT: "0",
				SANDBOX_HOST_ADMISSION_SECRET: HOST_SECRET,
				SANDBOX_BROKER_URL: brokerUrl,
			},
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const port = await waitForListen(denoProc);
	sandboxUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
	denoProc?.kill();
	await denoProc?.exited;
	brokerServer?.stop(true);
	origin?.close();
});

function adapter() {
	return httpSandboxAdapter({
		url: sandboxUrl,
		hostAdmissionSecret: HOST_SECRET,
	});
}

/** Mint a fresh per-run token bound to SCOPE + the fake target. */
function mint() {
	return broker.mint({ capabilities: SCOPE, target });
}

describe.if(!!denoPath)(
	"bindings e2e — capability-scoped app proxy over stdio",
	() => {
		it("brokers an IN-SCOPE collections.find() back to the guest", async () => {
			const { token, revoke } = mint();
			try {
				const r = await adapter().run({
					source: `export default async () => {
					const res = await globalThis.questpie.collections.orders.find({ where: { open: true } });
					return { ids: res.docs.map((d) => d.id) };
				}`,
					isolation: "sandboxed",
					capabilities: { net: [], import: [], timeoutMs: 8000, memoryMb: 128 },
					sandboxBindings: { url: brokerUrl, token },
				} as never);
				expect(r.ok).toBe(true);
				expect(r.output).toEqual({ ids: ["o1"] });
			} finally {
				revoke();
			}
		}, 20_000);

		it("brokers an IN-SCOPE knowledge.read() back to the guest", async () => {
			const { token, revoke } = mint();
			try {
				const r = await adapter().run({
					source: `export default async () => {
					const note = await globalThis.questpie.files.read({ path: "company/data/a.md" });
					return note.body;
				}`,
					isolation: "sandboxed",
					capabilities: { net: [], import: [], timeoutMs: 8000, memoryMb: 128 },
					sandboxBindings: { url: brokerUrl, token },
				} as never);
				expect(r.ok).toBe(true);
				expect(r.output).toBe("secret-note");
			} finally {
				revoke();
			}
		}, 20_000);

		it("REJECTS an OUT-OF-SCOPE collection as a terminal run failure", async () => {
			const { token, revoke } = mint();
			try {
				const r = await adapter().run({
					source: `export default async () => {
					try {
						await globalThis.questpie.collections.secrets.find({});
						return { reached: true };
					} catch (e) {
						return { reached: false, message: String(e && e.message || e) };
					}
				}`,
					isolation: "sandboxed",
					capabilities: { net: [], import: [], timeoutMs: 8000, memoryMb: 128 },
					sandboxBindings: { url: brokerUrl, token },
				} as never);
				expect(r.ok).toBe(false);
				expect(r.output).toBeUndefined();
				expect(r.error).toBe("sandbox binding operation forbidden");
			} finally {
				revoke();
			}
		}, 20_000);

		it("REJECTS an OUT-OF-SCOPE knowledge path (default-deny)", async () => {
			const { token, revoke } = mint();
			try {
				const r = await adapter().run({
					source: `export default async () => {
					try {
						await globalThis.questpie.files.read({ path: "company/SECRETS/keys.md" });
						return { reached: true };
					} catch (e) {
						return { reached: false, message: String(e && e.message || e) };
					}
				}`,
					isolation: "sandboxed",
					capabilities: { net: [], import: [], timeoutMs: 8000, memoryMb: 128 },
					sandboxBindings: { url: brokerUrl, token },
				} as never);
				expect(r.ok).toBe(false);
				expect(r.output).toBeUndefined();
				expect(r.error).toBe("sandbox binding operation forbidden");
			} finally {
				revoke();
			}
		}, 20_000);

		it("the guest CANNOT fetch the broker directly (loopback IP blocked by the SSRF host fetch even when allowlisted)", async () => {
			// Strongest form: the broker's OWN loopback host:port is ADDED to the run's
			// net allowlist AND the REAL ip validator is used. So the capability check
			// PASSES — yet the real `hostFetch` still DENIES it, because 127.0.0.1 is a
			// loopback ip (the connect-time SSRF block, not merely a missing grant). The
			// guest's `fetch` therefore rejects and never reaches the broker over the
			// network; the privileged channel is stdio only. (Raw-socket denial is proven
			// by the `Deno.connect` test below.)
			const { token, revoke } = mintHttp({
				net: [`127.0.0.1:${brokerServer?.port}`],
				resolve: resolverFrom({}), // 127.0.0.1 is a literal — no DNS needed
				// REAL validator (no loopback override) → 127.0.0.1 is blocked.
			});
			try {
				const r = await adapter().run({
					source: `export default async () => {
					try {
						const res = await fetch(${JSON.stringify(brokerUrl)}, {
							method: "POST",
							headers: { "content-type": "application/json" },
							body: JSON.stringify({ method: "collections.secrets.find", args: {} }),
						});
						return { fetched: true, status: res.status };
					} catch (e) {
						return { fetched: false, message: String(e && e.message || e) };
					}
				}`,
					isolation: "sandboxed",
					capabilities: { net: [], import: [], timeoutMs: 8000, memoryMb: 128 },
					sandboxBindings: { url: brokerUrl, token },
				} as never);
				expect(r.ok).toBe(false);
				expect(r.output).toBeUndefined();
				expect(r.error).toBe("sandbox binding operation failed");
			} finally {
				revoke();
			}
		}, 20_000);

		it("the guest has NO direct network — a raw Deno.connect() fails (net=[])", async () => {
			const { token, revoke } = mint();
			try {
				// Deno.connect is a RAW TCP socket, untouched by the fetch shim — it is
				// gated purely by --allow-net. With net=[], the guest's ONLY way out is
				// the brokered relay; a direct connect (even to a public host:port) must
				// be denied by the Deno permission sandbox.
				const r = await adapter().run({
					source: `export default async () => {
					try {
						const conn = await Deno.connect({ hostname: "example.com", port: 80 });
						conn.close();
						return { connected: true };
					} catch (e) {
						return { connected: false, name: String(e && e.name || e) };
					}
				}`,
					isolation: "sandboxed",
					capabilities: { net: [], import: [], timeoutMs: 8000, memoryMb: 128 },
					sandboxBindings: { url: brokerUrl, token },
				} as never);
				expect(r.ok).toBe(true);
				const out = r.output as { connected: boolean; name?: string };
				expect(out.connected).toBe(false);
				// Deno surfaces a permission denial as PermissionDenied / NotCapable.
				expect(out.name ?? "").toMatch(/Permission|NotCapable|denied/i);
			} finally {
				revoke();
			}
		}, 20_000);

		it("DEFENSE-IN-DEPTH: supervisor with SANDBOX_BROKER_URL rejects a stray bindings.url", async () => {
			// Spawn a SECOND supervisor pinned (via env) to the trusted broker URL.
			// A bindings run whose `bindings.url` does NOT match must be rejected
			// BEFORE any relay — so the per-run token is never mailed to a stray host.
			const pinnedProc = Bun.spawn(
				[
					denoPath as string,
					"run",
					"--allow-net",
					"--allow-env",
					"--allow-run",
					"--allow-read",
					"--allow-write",
					SERVER_ENTRY,
				],
				{
					env: {
						...process.env,
						PORT: "0",
						SANDBOX_BROKER_URL: brokerUrl, // the ONLY broker URL it will relay to
						SANDBOX_HOST_ADMISSION_SECRET: HOST_SECRET,
					},
					stdout: "pipe",
					stderr: "pipe",
				},
			);
			try {
				const port = await waitForListen(pinnedProc);
				const pinned = httpSandboxAdapter({
					url: `http://127.0.0.1:${port}`,
					hostAdmissionSecret: HOST_SECRET,
				});

				// (a) a MATCHING bindings.url is relayed normally.
				const okRun = mint();
				try {
					const r = await pinned.run({
						source: `export default async () => {
							const res = await globalThis.questpie.collections.orders.find({});
							return res.docs.map((d) => d.id);
						}`,
						isolation: "sandboxed",
						capabilities: {
							net: [],
							import: [],
							timeoutMs: 8000,
							memoryMb: 128,
						},
						sandboxBindings: { url: brokerUrl, token: okRun.token },
					} as never);
					expect(r.ok).toBe(true);
					expect(r.output).toEqual(["o1"]);
				} finally {
					okRun.revoke();
				}

				// (b) a SPOOFED bindings.url (attacker host) is REJECTED before relay.
				const evilRun = mint();
				try {
					const r = await pinned.run({
						source: `export default async () => "should-not-run"`,
						isolation: "sandboxed",
						capabilities: {
							net: [],
							import: [],
							timeoutMs: 8000,
							memoryMb: 128,
						},
						sandboxBindings: {
							url: "http://evil.example/rpc",
							token: evilRun.token,
						},
					} as never);
					expect(r.ok).toBe(false);
					expect(String(r.error)).toContain("bindings rejected");
				} finally {
					evilRun.revoke();
				}
			} finally {
				pinnedProc.kill();
				await pinnedProc.exited;
			}
		}, 30_000);

		it("rejects an expired/revoked token even on the wire (supervisor relays, broker denies)", async () => {
			const { token, revoke } = mint();
			revoke(); // token no longer valid before the run
			const r = await adapter().run({
				source: `export default async () => {
				try {
					await globalThis.questpie.collections.orders.find({});
					return { reached: true };
				} catch (e) {
					return { reached: false, message: String(e && e.message || e) };
				}
			}`,
				isolation: "sandboxed",
				capabilities: { net: [], import: [], timeoutMs: 8000, memoryMb: 128 },
				sandboxBindings: { url: brokerUrl, token },
			} as never);
			expect(r.ok).toBe(false);
			expect(r.output).toBeUndefined();
			expect(r.error).toBe("sandbox binding authorization failed");
		}, 20_000);
	},
);

// ──────────────────────────────────────────────────────────────────────────
// ★ THE REBIND ACCEPTANCE + the SSRF bypass matrix, END-TO-END.
//
// Each test runs a REAL Deno guest whose brokered `fetch` relays an `http.fetch`
// RPC → supervisor → REAL `SandboxBroker.handleRpc` → REAL `hostFetch`. The host
// is ALWAYS in the run's `net` allowlist (so it PASSES the capability check); the
// only thing that varies is what the injected DNS resolver RETURNS. When that
// resolution is private/metadata (the rebind), the guest's `fetch` MUST REJECT —
// proving the full guest→relay→broker path closes the TOCTOU window, not just the
// host-fetch unit (`packages/questpie/test/unit/services/host-fetch-ssrf.test.ts`).
// ──────────────────────────────────────────────────────────────────────────

/**
 * Run a guest that does `fetch(url, init)` and reports the OUTCOME: whether the
 * fetch resolved (`fetched`), its status/body/headers when it did, or the thrown
 * message when it rejected. The guest itself runs with `net=[]` (no native
 * socket) — every byte goes through the brokered shim.
 */
function guestFetchSource(url: string, init?: string): string {
	return `export default async () => {
		try {
			const res = await fetch(${JSON.stringify(url)}${init ? `, ${init}` : ""});
			const text = await res.text();
			return {
				fetched: true,
				status: res.status,
				statusText: res.statusText,
				ok: res.ok,
				contentType: res.headers.get("content-type"),
				fromBroker: res.headers.get("x-from-broker"),
				text,
			};
		} catch (e) {
			return { fetched: false, message: String(e && e.message || e) };
		}
	}`;
}

interface GuestFetchOut {
	fetched: boolean;
	status?: number;
	statusText?: string;
	ok?: boolean;
	contentType?: string | null;
	fromBroker?: string | null;
	text?: string;
	message?: string;
}

async function runGuestFetch(
	mintArgs: Parameters<typeof mintHttp>[0],
	url: string,
	init?: string,
): Promise<GuestFetchOut> {
	const { token, revoke } = mintHttp(mintArgs);
	try {
		const r = await adapter().run({
			source: guestFetchSource(url, init),
			isolation: "sandboxed",
			capabilities: { net: [], import: [], timeoutMs: 8000, memoryMb: 128 },
			sandboxBindings: { url: brokerUrl, token },
		} as never);
		return r.ok
			? (r.output as GuestFetchOut)
			: { fetched: false, message: r.error };
	} finally {
		revoke();
	}
}

describe.if(!!denoPath)(
	"bindings e2e — brokered http.fetch: rebind acceptance + SSRF matrix (REAL hostFetch)",
	() => {
		// ── CONTROL: an allowlisted host resolving to a real (test-local) origin
		//    succeeds 200 + body end-to-end through guest→relay→broker→hostFetch. ──
		it("CONTROL: allowlisted host → PUBLIC (test-local) origin succeeds end-to-end (201 + body, pinned)", async () => {
			originSeen.length = 0;
			const out = await runGuestFetch(
				{
					net: [`${ALLOWED_HOST}:${originPort}`],
					resolve: resolverFrom({ [ALLOWED_HOST]: ["127.0.0.1"] }),
					validateIp: allowLoopback,
				},
				`http://${ALLOWED_HOST}:${originPort}/data`,
				`{ method: "POST", headers: { "x-app": "demo", "content-type": "text/plain" }, body: "ping" }`,
			);
			expect(out.fetched).toBe(true);
			// Response reconstructed from the REAL origin's HttpFetchResponse contract.
			expect(out.status).toBe(FETCH_STATUS);
			expect(out.statusText).toBe(FETCH_STATUS_TEXT);
			expect(out.ok).toBe(true); // 201 is in the 2xx ok range
			expect(out.contentType).toBe("application/json");
			expect(out.fromBroker).toBe("yes");
			expect(out.text).toBe(FETCH_BODY);
			// The pin connected to 127.0.0.1 while the origin saw the HOSTNAME as Host,
			// and the shim framed method + body faithfully across the relay.
			expect(originSeen.length).toBe(1);
			expect(originSeen[0]?.host).toBe(`${ALLOWED_HOST}:${originPort}`);
			expect(originSeen[0]?.method).toBe("POST");
			expect(originSeen[0]?.body).toBe("ping");
		}, 20_000);

		// ── ★ THE REBIND ACCEPTANCE — the headline regression. ──
		it("★ REBIND: allowlisted host that DNS-flips to cloud metadata is DENIED end-to-end (origin never reached)", async () => {
			originSeen.length = 0;
			// The host PASSES the allowlist; DNS now points at the AWS/GCP/Azure
			// metadata ip (169.254.169.254). The REAL validator (no loopback override)
			// blocks it inside hostFetch, BEFORE any connect — so the guest's fetch
			// rejects and the internal target is never reached.
			const out = await runGuestFetch(
				{
					net: [ALLOWED_HOST],
					resolve: resolverFrom({ [ALLOWED_HOST]: ["169.254.169.254"] }),
				},
				`https://${ALLOWED_HOST}/latest/meta-data/iam/security-credentials/`,
			);
			expect(out.fetched).toBe(false); // ← the guest's fetch REJECTED
			expect(out.message).toBe("sandbox binding operation failed");
			expect(originSeen.length).toBe(0); // the (real) origin was never hit
		}, 20_000);

		it("★ REBIND: the loopback flip (allowlisted host → 127.0.0.1) is DENIED end-to-end", async () => {
			// The other half of the rebind: instead of metadata, the host flips to
			// loopback — the broker itself / any localhost service. REAL validator → blocked.
			const out = await runGuestFetch(
				{
					net: [ALLOWED_HOST],
					resolve: resolverFrom({ [ALLOWED_HOST]: ["127.0.0.1"] }),
				},
				`https://${ALLOWED_HOST}/`,
			);
			expect(out.fetched).toBe(false);
			expect(out.message).toBe("sandbox binding operation failed");
		}, 20_000);

		// ── The SSRF bypass matrix, end-to-end (allowlisted host, resolution varies). ──
		it("DENIES an allowlisted host resolving to RFC-1918 (10/8) end-to-end", async () => {
			const out = await runGuestFetch(
				{
					net: [ALLOWED_HOST],
					resolve: resolverFrom({ [ALLOWED_HOST]: ["10.1.2.3"] }),
				},
				`https://${ALLOWED_HOST}/`,
			);
			expect(out.fetched).toBe(false);
			expect(out.message).toBe("sandbox binding operation failed");
		}, 20_000);

		it("DENIES IPv6 metadata (fd00:ec2::254) end-to-end", async () => {
			const out = await runGuestFetch(
				{
					net: [ALLOWED_HOST],
					resolve: resolverFrom({ [ALLOWED_HOST]: ["fd00:ec2::254"] }),
				},
				`https://${ALLOWED_HOST}/`,
			);
			expect(out.fetched).toBe(false);
			expect(out.message).toBe("sandbox binding operation failed");
		}, 20_000);

		it("DENIES an IPv4-mapped IPv6 loopback (::ffff:127.0.0.1) end-to-end", async () => {
			const out = await runGuestFetch(
				{
					net: [ALLOWED_HOST],
					resolve: resolverFrom({ [ALLOWED_HOST]: ["::ffff:127.0.0.1"] }),
				},
				`https://${ALLOWED_HOST}/`,
			);
			expect(out.fetched).toBe(false);
			expect(out.message).toBe("sandbox binding operation failed");
		}, 20_000);

		it("DENIES 0.0.0.0 (this-host) end-to-end", async () => {
			const out = await runGuestFetch(
				{
					net: [ALLOWED_HOST],
					resolve: resolverFrom({ [ALLOWED_HOST]: ["0.0.0.0"] }),
				},
				`https://${ALLOWED_HOST}/`,
			);
			expect(out.fetched).toBe(false);
			expect(out.message).toBe("sandbox binding operation failed");
		}, 20_000);

		it("DENIES non-decimal IPv4 encodings (decimal/octal/hex of 127.0.0.1) when resolved", async () => {
			// A resolver that hands back a non-canonical literal — hostFetch canonicalizes
			// + classifies it as loopback. (Production resolvers return canonical decimal;
			// this hardens the path that a literal ever reaches the validator.)
			for (const encoded of ["2130706433", "0177.0.0.1", "0x7f000001"]) {
				const out = await runGuestFetch(
					{
						net: [ALLOWED_HOST],
						resolve: resolverFrom({ [ALLOWED_HOST]: [encoded] }),
					},
					`https://${ALLOWED_HOST}/`,
				);
				expect(out.fetched).toBe(false);
				expect(out.message).toBe("sandbox binding operation failed");
			}
		}, 30_000);

		it("DENIES a MULTI-RECORD host where ONE record is private (whole-host reject) end-to-end", async () => {
			// First record is a real public ip; the second is RFC-1918 → the whole host
			// is rejected (the multi-record rebind defense), so the guest fetch rejects.
			const out = await runGuestFetch(
				{
					net: [ALLOWED_HOST],
					resolve: resolverFrom({
						[ALLOWED_HOST]: ["93.184.216.34", "192.168.0.10"],
					}),
				},
				`https://${ALLOWED_HOST}/`,
			);
			expect(out.fetched).toBe(false);
			expect(out.message).toBe("sandbox binding operation failed");
		}, 20_000);

		it("★ REDIRECT-to-internal: an allowed hop 302s to a host resolving PRIVATE → blocked at the redirect hop, end-to-end", async () => {
			originSeen.length = 0;
			// hop1 is allowlisted + resolves to the loopback origin (allowed via the test
			// validator) and 302s to internal.evil.example, which resolves PRIVATE under
			// the REAL classification. hostFetch re-resolves + re-validates the Location →
			// blocked at the redirect hop (NOT at hop 1). The guest's fetch rejects.
			const out = await runGuestFetch(
				{
					// Only hop1 needs to be allowlisted (the capability check runs once on
					// the initial URL); the redirect hop is gated by hostFetch's re-resolve
					// + re-validate, NOT the allowlist — which is exactly the point.
					net: [`${ALLOWED_HOST}:${originPort}`],
					resolve: resolverFrom({
						[ALLOWED_HOST]: ["127.0.0.1"],
						"internal.evil.example": ["10.0.0.9"],
					}),
					// Allow loopback for hop1; REAL classification rejects 10.0.0.9 at the hop.
					validateIp: allowLoopback,
				},
				`http://${ALLOWED_HOST}:${originPort}/redirect-internal`,
			);
			expect(out.fetched).toBe(false);
			expect(out.message).toBe("sandbox binding operation failed");
			// hop1 WAS reached (it served the 302); the internal target never was.
			expect(originSeen.map((s) => s.url)).toEqual(["/redirect-internal"]);
		}, 20_000);
	},
);
