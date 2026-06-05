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
	knowledge: { read: ["company/data/**"] },
};
const target = {
	knowledge: {
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
					const note = await globalThis.questpie.knowledge.read({ path: "company/data/a.md" });
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
						await globalThis.questpie.knowledge.read({ path: "company/SECRETS/keys.md" });
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
				// The guest attempts to bypass the proxy and call the broker over the
				// network with the (unknown-to-it) URL. Two layers stop it:
				//   (a) it has no token and no broker URL (only the proxy);
				//   (b) even with the literal URL, net=[] means NO fetch permission, and
				//       a loopback host is egress-rejected anyway.
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
				// fetch must FAIL — the guest has no net permission to reach loopback.
				expect((r.output as { fetched: boolean }).fetched).toBe(false);
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
