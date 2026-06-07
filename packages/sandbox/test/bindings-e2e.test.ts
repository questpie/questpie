/**
 * END-TO-END bindings test — the FULL untrusted path, running for real.
 *
 *   guest (real Deno subprocess)  ──framed stdio──▶  supervisor (sandbox-server.ts)
 *                                                          │  HTTP + per-run token
 *                                                          ▼
 *                                                    fake host broker
 *
 * Proves (per the task's Verify block):
 *   1. A guest `collections.<allowed>.find()` WITHIN its capabilities → brokered
 *      result returned to the guest.
 *   2. A guest call to a collection OUTSIDE its capabilities → REJECTED host-side
 *      (default-deny), surfaced to the guest as a thrown error.
 *   3. The guest CANNOT reach the broker via `fetch` (loopback rejected by the
 *      egress allowlist) — the binding path is STDIO, not the network.
 *
 * The broker here is a tiny stand-in that delegates to the REAL `SandboxBroker`
 * from `questpie` (so the actual capability enforcement runs), wired to a fake
 * in-memory data target. Requires `deno` on PATH (the sandbox engine); skipped
 * otherwise so CI without Deno stays green.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { SandboxBroker } from "questpie/executor";

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

// ── Deterministic `http.fetch` broker stub (no real network). ──
// A known HttpFetchResponse the guest shim must reconstruct into a `Response`.
const ALLOWED_URL = "https://api.allowed.example/data";
const FETCH_BODY = JSON.stringify({ hello: "world", n: 42 });
const FETCH_STATUS = 201;
const FETCH_STATUS_TEXT = "Created";
const FETCH_HEADERS = {
	"content-type": "application/json",
	"x-from-broker": "yes",
};

/**
 * Stand in for the real broker's `http.fetch`: echo a fixed HttpFetchResponse for
 * the ALLOWED host and record what the guest shim framed (so the test can assert
 * url/method/headers/body crossed the relay correctly). Any OTHER host is DENIED
 * with a structured error — mirroring the real default-deny + SSRF block, so a
 * brokered fetch to the loopback broker URL still fails (the existing invariant).
 */
let lastHttpFetchArgs: unknown;
function httpFetchBrokerResponse(args: unknown) {
	lastHttpFetchArgs = args;
	const url = (args as { url?: string } | null)?.url ?? "";
	if (url !== ALLOWED_URL) {
		return {
			ok: false,
			error: {
				code: "execution_error",
				message: `blocked target: ${url} is not in the net allowlist`,
			},
		};
	}
	return {
		ok: true,
		value: {
			status: FETCH_STATUS,
			statusText: FETCH_STATUS_TEXT,
			headers: FETCH_HEADERS,
			bodyBase64: Buffer.from(FETCH_BODY, "utf8").toString("base64"),
			truncated: false,
		},
	};
}

let brokerServer: ReturnType<typeof Bun.serve> | undefined;
let brokerUrl = "";
let denoProc: ReturnType<typeof Bun.spawn> | undefined;
let sandboxUrl = "";

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

	// Fake broker HTTP endpoint → real SandboxBroker.handleRpc.
	brokerServer = Bun.serve({
		port: 0,
		async fetch(req) {
			const token = req.headers.get(BINDINGS_TOKEN_HEADER);
			const body = (await req.json()) as { method: string; args: unknown };
			// `http.fetch` answered deterministically with a known HttpFetchResponse
				// (no real DNS/network) — proves the GUEST shim frames the rpc and
				// reconstructs a Response from the contract. The SSRF-safe host fetch is
				// covered by the broker's own tests.
				if (body.method === "http.fetch") {
					return new Response(
						JSON.stringify(httpFetchBrokerResponse(body.args)),
						{ headers: { "content-type": "application/json" } },
					);
				}
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
			SERVER_ENTRY,
		],
		{ env: { ...process.env, PORT: "0" }, stdout: "pipe", stderr: "pipe" },
	);
	const port = await waitForListen(denoProc);
	sandboxUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
	denoProc?.kill();
	await denoProc?.exited;
	brokerServer?.stop(true);
});

function adapter() {
	return httpSandboxAdapter({ url: sandboxUrl });
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

		it("REJECTS an OUT-OF-SCOPE collection (guest sees a thrown error, default-deny)", async () => {
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
				expect(r.ok).toBe(true);
				const out = r.output as { reached: boolean; message: string };
				// The guest's call was DENIED host-side — it never reached the target.
				expect(out.reached).toBe(false);
				expect(out.message).toContain("secrets");
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
				expect(r.ok).toBe(true);
				expect((r.output as { reached: boolean }).reached).toBe(false);
			} finally {
				revoke();
			}
		}, 20_000);

		it("the guest CANNOT fetch the broker directly (loopback rejected; path is stdio)", async () => {
			const { token, revoke } = mint();
			try {
				// The guest attempts to bypass the proxy and call the broker by URL.
				// `fetch` is now the brokered shim (the guest has net=[], so there is no
				// native socket); the relayed `http.fetch` to a LOOPBACK URL is denied
				// host-side (default-deny + SSRF block), so the call still fails and the
				// guest never reaches the broker. The raw-socket denial is proven
				// separately by the `Deno.connect` test below.
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
						return { fetched: false, message: String(e && e.name || e) };
					}
				}`,
					isolation: "sandboxed",
					capabilities: { net: [], import: [], timeoutMs: 8000, memoryMb: 128 },
					sandboxBindings: { url: brokerUrl, token },
				} as never);
				expect(r.ok).toBe(true);
				// fetch must FAIL — the brokered relay denies the loopback target.
				expect((r.output as { fetched: boolean }).fetched).toBe(false);
			} finally {
				revoke();
			}
		}, 20_000);

		it("brokers a guest `fetch(<allowed>)` and reconstructs the Response (shim)", async () => {
			const { token, revoke } = mint();
			lastHttpFetchArgs = undefined;
			try {
				const r = await adapter().run({
					source: `export default async () => {
					const res = await fetch(${JSON.stringify(ALLOWED_URL)}, {
						method: "POST",
						headers: { "x-app": "demo", "content-type": "text/plain" },
						body: "ping",
					});
					const text = await res.text();
					return {
						status: res.status,
						statusText: res.statusText,
						ok: res.ok,
						contentType: res.headers.get("content-type"),
						fromBroker: res.headers.get("x-from-broker"),
						text,
						parsed: JSON.parse(text),
					};
				}`,
					isolation: "sandboxed",
					capabilities: { net: [], import: [], timeoutMs: 8000, memoryMb: 128 },
					sandboxBindings: { url: brokerUrl, token },
				} as never);
				expect(r.ok).toBe(true);
				const out = r.output as {
					status: number;
					statusText: string;
					ok: boolean;
					contentType: string;
					fromBroker: string;
					text: string;
					parsed: unknown;
				};
				// Response reconstructed from the relayed HttpFetchResponse contract.
				expect(out.status).toBe(FETCH_STATUS);
				expect(out.statusText).toBe(FETCH_STATUS_TEXT);
				expect(out.ok).toBe(true); // 201 is in the 2xx ok range
				expect(out.contentType).toBe("application/json");
				expect(out.fromBroker).toBe("yes");
				expect(out.text).toBe(FETCH_BODY);
				expect(out.parsed).toEqual({ hello: "world", n: 42 });

				// The shim framed the request faithfully: url, method, headers, body.
				const sent = lastHttpFetchArgs as {
					url: string;
					method: string;
					headers: Record<string, string>;
					bodyBase64?: string;
				};
				expect(sent.url).toBe(ALLOWED_URL);
				expect(sent.method).toBe("POST");
				expect(sent.headers["x-app"]).toBe("demo");
				expect(sent.headers["content-type"]).toBe("text/plain");
				expect(sent.bodyBase64).toBe(
					Buffer.from("ping", "utf8").toString("base64"),
				);
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
					SERVER_ENTRY,
				],
				{
					env: {
						...process.env,
						PORT: "0",
						SANDBOX_BROKER_URL: brokerUrl, // the ONLY broker URL it will relay to
					},
					stdout: "pipe",
					stderr: "pipe",
				},
			);
			try {
				const port = await waitForListen(pinnedProc);
				const pinned = httpSandboxAdapter({ url: `http://127.0.0.1:${port}` });

				// (a) a MATCHING bindings.url is relayed normally.
				const okRun = mint();
				try {
					const r = await pinned.run({
						source: `export default async () => {
							const res = await globalThis.questpie.collections.orders.find({});
							return res.docs.map((d) => d.id);
						}`,
						isolation: "sandboxed",
						capabilities: { net: [], import: [], timeoutMs: 8000, memoryMb: 128 },
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
						capabilities: { net: [], import: [], timeoutMs: 8000, memoryMb: 128 },
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
			expect(r.ok).toBe(true);
			const out = r.output as { reached: boolean; message: string };
			expect(out.reached).toBe(false);
			expect(out.message).toMatch(/token|unauthorized|expired/i);
		}, 20_000);
	},
);
