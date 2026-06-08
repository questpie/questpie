/**
 * Brokered `http.fetch` — PARSER + CAPABILITY + BROKER DISPATCH wiring.
 *
 * Complements `host-fetch-ssrf.test.ts` (which exercises the SSRF host fetch in
 * isolation). Here we prove the END-TO-END broker path the guest's `http.fetch`
 * RPC travels:
 *   1. `parseBindingMethod("http.fetch")` classifies as `{ kind:"http", op:"fetch" }`.
 *   2. `checkBindingCapability` enforces the per-app `net` allowlist FIRST,
 *      default-deny (the URL host must be allowlisted; wildcard + port rules).
 *   3. `SandboxBroker.handleRpc` runs the SSRF-safe host fetch for an in-scope
 *      call and surfaces a structured error for a blocked target — never throws.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Buffer } from "node:buffer";
import { createServer, type Server } from "node:http";

import type { ExecutorCapabilities } from "#questpie/server/modules/core/integrated/executor/adapter.js";
import {
	type BindingTarget,
	SandboxBroker,
} from "#questpie/server/modules/core/integrated/executor/bindings/broker.js";
import { checkBindingCapability } from "#questpie/server/modules/core/integrated/executor/bindings/capability-check.js";
import { classifyIpLiteral } from "#questpie/server/modules/core/integrated/executor/bindings/net-validation.js";
import { parseBindingMethod } from "#questpie/server/modules/core/integrated/executor/bindings/protocol.js";

let server: Server;
let port = 0;
beforeAll(async () => {
	server = createServer((_req, res) => {
		res.writeHead(200, { "content-type": "text/plain" });
		res.end("brokered-ok");
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	port = (server.address() as { port: number }).port;
});
afterAll(() => server.close());

const resolverFrom =
	(map: Record<string, string[]>) =>
	async (h: string): Promise<string[]> => {
		if (h in map) return map[h];
		throw new Error(`NXDOMAIN: ${h}`);
	};

// ──────────────────────────────────────────────────────────────────────────
// parseBindingMethod — http.fetch classification.
// ──────────────────────────────────────────────────────────────────────────
describe("parseBindingMethod — http.fetch", () => {
	it("classifies http.fetch and rejects other http ops/shapes", () => {
		expect(parseBindingMethod("http.fetch")).toEqual({
			kind: "http",
			op: "fetch",
		});
		for (const m of [
			"http",
			"http.get",
			"http.fetch.extra",
			"http.",
			"https.fetch",
		]) {
			expect(parseBindingMethod(m)).toBeNull();
		}
	});
});

// ──────────────────────────────────────────────────────────────────────────
// checkBindingCapability — the per-app `net` allowlist (default-deny).
// ──────────────────────────────────────────────────────────────────────────
describe("checkBindingCapability — http.fetch net allowlist", () => {
	it("DENIES when no net allowlist is granted (default-deny)", () => {
		for (const caps of [undefined, {}, { net: [] }] as Array<
			ExecutorCapabilities | undefined
		>) {
			const d = checkBindingCapability(
				"http.fetch",
				{ url: "https://api.example.com/x" },
				caps,
			);
			expect(d.allowed).toBe(false);
		}
	});

	it("ALLOWS an exact-host match; DENIES a non-listed host", () => {
		const caps: ExecutorCapabilities = { net: ["api.example.com"] };
		expect(
			checkBindingCapability(
				"http.fetch",
				{ url: "https://api.example.com/v1/x" },
				caps,
			).allowed,
		).toBe(true);
		const d = checkBindingCapability(
			"http.fetch",
			{ url: "https://evil.com/x" },
			caps,
		);
		expect(d.allowed).toBe(false);
		expect(d.reason).toContain("not in the net allowlist");
	});

	it("supports a *. wildcard (subdomains, not the apex), and is anchored", () => {
		const caps: ExecutorCapabilities = { net: ["*.example.com"] };
		expect(
			checkBindingCapability(
				"http.fetch",
				{ url: "https://api.example.com/" },
				caps,
			).allowed,
		).toBe(true);
		expect(
			checkBindingCapability(
				"http.fetch",
				{ url: "https://a.b.example.com/" },
				caps,
			).allowed,
		).toBe(true);
		// Apex is NOT matched by *.example.com.
		expect(
			checkBindingCapability(
				"http.fetch",
				{ url: "https://example.com/" },
				caps,
			).allowed,
		).toBe(false);
		// Suffix-confusion: evilexample.com must NOT match *.example.com or example.com.
		expect(
			checkBindingCapability(
				"http.fetch",
				{ url: "https://evilexample.com/" },
				caps,
			).allowed,
		).toBe(false);
	});

	it("enforces a pinned port; a portless entry allows any port", () => {
		const pinned: ExecutorCapabilities = { net: ["api.example.com:8443"] };
		expect(
			checkBindingCapability(
				"http.fetch",
				{ url: "https://api.example.com:8443/" },
				pinned,
			).allowed,
		).toBe(true);
		expect(
			checkBindingCapability(
				"http.fetch",
				{ url: "https://api.example.com/" },
				pinned,
			).allowed,
		).toBe(false); // 443 != 8443
		const any: ExecutorCapabilities = { net: ["api.example.com"] };
		expect(
			checkBindingCapability(
				"http.fetch",
				{ url: "https://api.example.com:9999/" },
				any,
			).allowed,
		).toBe(true);
	});

	it("DENIES a non-http(s) scheme, a userinfo URL, and a malformed URL", () => {
		const caps: ExecutorCapabilities = { net: ["api.example.com"] };
		expect(
			checkBindingCapability(
				"http.fetch",
				{ url: "ftp://api.example.com/" },
				caps,
			).allowed,
		).toBe(false);
		expect(
			checkBindingCapability(
				"http.fetch",
				{ url: "https://user:pass@api.example.com/" },
				caps,
			).allowed,
		).toBe(false);
		expect(
			checkBindingCapability("http.fetch", { url: "::not a url" }, caps)
				.allowed,
		).toBe(false);
		expect(checkBindingCapability("http.fetch", {}, caps).allowed).toBe(false); // no url
	});
});

// ──────────────────────────────────────────────────────────────────────────
// SandboxBroker — http.fetch dispatch (auth → allowlist → SSRF host fetch).
// ──────────────────────────────────────────────────────────────────────────
describe("SandboxBroker — http.fetch dispatch", () => {
	/** Allow loopback only for the dispatch OK test (so the local origin is reachable). */
	const targetAllowingLoopback = (
		map: Record<string, string[]>,
	): BindingTarget => ({
		http: {
			fetchOptions: {
				resolve: resolverFrom(map),
				validateIp: (ip) =>
					ip === "127.0.0.1" ? { ok: true } : classifyIpLiteral(ip),
			},
		},
	});

	it("DISPATCHES an in-allowlist http.fetch through the SSRF host fetch (200 OK)", async () => {
		const broker = new SandboxBroker();
		const caps: ExecutorCapabilities = { net: [`api.public.test:${port}`] };
		const { token } = broker.mint({
			capabilities: caps,
			target: targetAllowingLoopback({ "api.public.test": ["127.0.0.1"] }),
		});

		const r = await broker.handleRpc(token, "http.fetch", {
			url: `http://api.public.test:${port}/`,
		});
		expect(r.ok).toBe(true);
		if (r.ok) {
			const v = r.value as { status: number; bodyBase64: string };
			expect(v.status).toBe(200);
			expect(Buffer.from(v.bodyBase64, "base64").toString()).toBe(
				"brokered-ok",
			);
		}
	});

	it("REJECTS http.fetch to a host OUTSIDE the net allowlist as forbidden (host fetch never runs)", async () => {
		const broker = new SandboxBroker();
		const caps: ExecutorCapabilities = { net: ["api.allowed.test"] };
		// The target would resolve evil.test to a public ip, but the allowlist check
		// runs FIRST and forbids it before any fetch.
		const { token } = broker.mint({
			capabilities: caps,
			target: targetAllowingLoopback({ "evil.test": ["93.184.216.34"] }),
		});
		const r = await broker.handleRpc(token, "http.fetch", {
			url: "https://evil.test/x",
		});
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.code).toBe("forbidden");
	});

	it("REJECTS an in-allowlist host that RESOLVES to a private IP as execution_error (SSRF)", async () => {
		const broker = new SandboxBroker();
		// The host IS allowlisted, but it resolves to a private ip → the host fetch
		// blocks it. Uses the REAL validator (no loopback override) so the private ip
		// is rejected.
		const caps: ExecutorCapabilities = { net: ["api.public.test"] };
		const target: BindingTarget = {
			http: {
				fetchOptions: {
					resolve: resolverFrom({ "api.public.test": ["10.0.0.5"] }),
				},
			},
		};
		const { token } = broker.mint({ capabilities: caps, target });
		const r = await broker.handleRpc(token, "http.fetch", {
			url: "https://api.public.test/x",
		});
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.error.code).toBe("execution_error");
			expect(r.error.message.toLowerCase()).toContain("blocked");
		}
	});

	it("REJECTS http.fetch with NO net grant as forbidden (default-deny), with a valid token", async () => {
		const broker = new SandboxBroker();
		const { token } = broker.mint({
			capabilities: { data: { collections: { orders: ["read"] } } },
			target: {},
		});
		const r = await broker.handleRpc(token, "http.fetch", {
			url: "https://api.example.com/x",
		});
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.code).toBe("forbidden");
	});
});
