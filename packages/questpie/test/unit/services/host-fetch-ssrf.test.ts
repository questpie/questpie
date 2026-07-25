/**
 * Brokered `http.fetch` — SSRF-safe HOST FETCH (the security core of the fix).
 *
 * The guest has NO direct network; ALL egress is brokered through `hostFetch`,
 * which must close the DNS-rebinding / TOCTOU window a naive `fetch(url)` leaves
 * open. Headline assertions are the DENIALS:
 *   - a private / metadata target is blocked,
 *   - a redirect to an internal host is blocked (every hop re-validated),
 *   - a multi-record host where ONE record is private is blocked wholesale,
 *   - ★ the REBIND scenario — a resolver returning a PUBLIC ip then a PRIVATE ip
 *     — is blocked: hostFetch validates the ip set it actually PINS, on every
 *     call/hop, so an earlier public answer never carries forward.
 *   - the IP-encoding bypasses (octal/hex/decimal v4, IPv6-mapped, 0.0.0.0, IPv6
 *     metadata) all classify as private.
 * Positive path: an allowed host fetched against a local origin succeeds with the
 * buffered/base64/flattened/capped contract, PINNED to the validated IP while the
 * Host header stays the hostname (proving the pin connects to the literal, not a
 * re-resolution). The body cap rejects an oversize response host-side.
 *
 * `hostFetch` NEVER throws — every failure is a structured BindingError.
 *
 * The positive/redirect/cap tests inject a TEST-ONLY `validateIp` that allows the
 * loopback origin; the SSRF-denial tests use the REAL validator (default). The
 * production broker never overrides the validator.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Buffer } from "node:buffer";
import { createServer, type Server } from "node:http";

import {
	hostFetch,
	type IpValidator,
} from "#questpie/server/modules/core/integrated/executor/bindings/host-fetch.js";
import { classifyIpLiteral } from "#questpie/server/modules/core/integrated/executor/bindings/net-validation.js";

// ── A local origin on 127.0.0.1. Tests reach it via a FAKE hostname pinned (by
//    an injected resolver) to 127.0.0.1, so we can assert the pin connected to
//    the literal while the Host header carries the hostname. ──
let server: Server;
let port = 0;
const seen: Array<{
	url: string;
	host: string | undefined;
	method: string;
	body: string;
}> = [];

beforeAll(async () => {
	server = createServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on("data", (c) => chunks.push(c as Buffer));
		req.on("end", () => {
			const body = Buffer.concat(chunks).toString("utf8");
			seen.push({
				url: req.url ?? "",
				host: req.headers.host,
				method: req.method ?? "",
				body,
			});
			switch (req.url) {
				case "/redirect-internal":
					res.writeHead(302, { location: "http://internal.evil.test/secret" });
					return res.end();
				case "/redirect-ok":
					res.writeHead(302, { location: `http://hop2.test:${port}/final` });
					return res.end();
				case "/big":
					res.writeHead(200, { "content-type": "application/octet-stream" });
					return res.end(Buffer.alloc(64 * 1024, 0x41)); // 64 KiB
				case "/echo": {
					res.writeHead(200, {
						"content-type": "application/json",
						// A multi-value header to exercise flattening (joined by ", ").
						"x-multi": ["a", "b"] as unknown as string,
					});
					return res.end(JSON.stringify({ got: body, method: req.method }));
				}
				default:
					res.writeHead(200, { "content-type": "text/plain" });
					return res.end("hello-from-origin");
			}
		});
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	port = (server.address() as { port: number }).port;
});

afterAll(() => server.close());

/** Deterministic offline resolver from a hostname → IP-list map. */
const resolverFrom =
	(map: Record<string, string[]>) =>
	async (hostname: string): Promise<string[]> => {
		if (hostname in map) return map[hostname];
		throw new Error(`NXDOMAIN: ${hostname}`);
	};

/** TEST-ONLY validator that treats 127.0.0.1 as allowed (so a loopback origin is
 *  reachable) but still rejects everything else the real policy rejects. */
const allowLoopback: IpValidator = (ip) =>
	ip === "127.0.0.1" || ip === "::1" ? { ok: true } : classifyIpLiteral(ip);

// ──────────────────────────────────────────────────────────────────────────
// classifyIpLiteral — the encoding-bypass coverage the spec lists.
// ──────────────────────────────────────────────────────────────────────────
describe("classifyIpLiteral — SSRF bypass encodings", () => {
	it("blocks loopback / RFC-1918 / link-local / metadata / CGNAT / 0.0.0.0", () => {
		for (const ip of [
			"127.0.0.1",
			"10.0.0.5",
			"172.16.0.1",
			"192.168.1.1",
			"169.254.169.254",
			"100.64.0.1",
			"0.0.0.0",
		]) {
			expect(classifyIpLiteral(ip).ok).toBe(false);
		}
	});

	it("blocks non-decimal IPv4 encodings of 127.0.0.1 (octal/hex/decimal)", () => {
		for (const ip of ["0177.0.0.1", "0x7f.0.0.1", "0x7f000001", "2130706433"]) {
			expect(classifyIpLiteral(ip).ok).toBe(false);
		}
	});

	it("blocks IPv6 loopback, IPv4-mapped loopback/metadata, IPv6 metadata, link-local", () => {
		for (const ip of [
			"::1",
			"::ffff:127.0.0.1",
			"::ffff:169.254.169.254",
			// Bun's `URL.hostname` HEX-compresses IPv4-mapped literals
			// (::ffff:127.0.0.1 → ::ffff:7f00:1); the classifier must still catch them.
			"::ffff:7f00:1",
			"::ffff:a9fe:a9fe",
			"fd00:ec2::254",
			"fe80::1",
		]) {
			expect(classifyIpLiteral(ip).ok).toBe(false);
		}
	});

	it("allows a normal public IPv4/IPv6 literal", () => {
		expect(classifyIpLiteral("93.184.216.34").ok).toBe(true);
		expect(classifyIpLiteral("2606:2800:220:1:248:1893:25c8:1946").ok).toBe(
			true,
		);
	});
});

// ──────────────────────────────────────────────────────────────────────────
// hostFetch — positive path (allowed host, pinned, buffered contract).
// ──────────────────────────────────────────────────────────────────────────
describe("hostFetch — allowed host OK, pinned to validated IP", () => {
	it("fetches a 200 and returns the buffered/base64/flattened contract; Host stays the hostname", async () => {
		seen.length = 0;
		const res = await hostFetch(
			{
				url: `http://api.public.test:${port}/echo`,
				method: "POST",
				bodyBase64: Buffer.from("ping").toString("base64"),
			},
			{
				resolve: resolverFrom({ "api.public.test": ["127.0.0.1"] }),
				validateIp: allowLoopback,
			},
		);
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		expect(res.value.status).toBe(200);
		expect(res.value.statusText).toBe("OK");
		// Flattened, lowercased headers.
		expect(res.value.headers["content-type"]).toBe("application/json");
		expect(res.value.headers["x-multi"]).toBe("a, b"); // multi-value joined
		expect(res.value.truncated).toBe(false);
		const decoded = JSON.parse(
			Buffer.from(res.value.bodyBase64, "base64").toString("utf8"),
		);
		expect(decoded).toEqual({ got: "ping", method: "POST" });
		// The PIN connected to 127.0.0.1 but the origin saw the HOSTNAME as Host.
		expect(seen[0]?.host).toBe(`api.public.test:${port}`);
		expect(seen[0]?.body).toBe("ping");
	});

	it("follows an allowed redirect, re-validating + re-pinning the next hop", async () => {
		seen.length = 0;
		const res = await hostFetch(
			{ url: `http://hop1.test:${port}/redirect-ok` },
			{
				resolve: resolverFrom({
					"hop1.test": ["127.0.0.1"],
					"hop2.test": ["127.0.0.1"],
				}),
				validateIp: allowLoopback,
			},
		);
		expect(res.ok).toBe(true);
		if (res.ok)
			expect(Buffer.from(res.value.bodyBase64, "base64").toString()).toBe(
				"hello-from-origin",
			);
		// Two hops hit the origin: the redirect, then /final.
		expect(seen.map((s) => s.url)).toEqual(["/redirect-ok", "/final"]);
		expect(seen[1]?.host).toBe(`hop2.test:${port}`);
	});

	it("BLOCKS a redirect to a host OUTSIDE the net allowlist (open-redirect egress)", async () => {
		seen.length = 0;
		const res = await hostFetch(
			{ url: `http://hop1.test:${port}/redirect-ok` }, // 302 → hop2.test/final
			{
				resolve: resolverFrom({
					"hop1.test": ["127.0.0.1"],
					"hop2.test": ["127.0.0.1"],
				}),
				validateIp: allowLoopback,
				// hop2.test resolves to a reachable ip but is NOT in the allowlist — an
				// open redirect on hop1.test must not turn into egress to it.
				isHostAllowed: (host) => host === "hop1.test",
			},
		);
		expect(res.ok).toBe(false);
		if (!res.ok)
			expect(res.error.message).toContain("not in the net allowlist");
		// Only the first hop reached the origin; hop2 was blocked pre-connect.
		expect(seen.map((s) => s.url)).toEqual(["/redirect-ok"]);
	});

	it("FOLLOWS a cross-host redirect when BOTH hops are allowlisted", async () => {
		seen.length = 0;
		const res = await hostFetch(
			{ url: `http://hop1.test:${port}/redirect-ok` },
			{
				resolve: resolverFrom({
					"hop1.test": ["127.0.0.1"],
					"hop2.test": ["127.0.0.1"],
				}),
				validateIp: allowLoopback,
				isHostAllowed: (host) => host === "hop1.test" || host === "hop2.test",
			},
		);
		expect(res.ok).toBe(true);
		expect(seen.map((s) => s.url)).toEqual(["/redirect-ok", "/final"]);
	});

	it("REJECTS a response that exceeds the body cap (host-side byte counter, not Content-Length)", async () => {
		const res = await hostFetch(
			{ url: `http://api.public.test:${port}/big` },
			{
				resolve: resolverFrom({ "api.public.test": ["127.0.0.1"] }),
				validateIp: allowLoopback,
				maxBodyBytes: 1024,
			},
		);
		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.error.code).toBe("execution_error");
			expect(res.error.message).toContain("cap");
		}
	});

	it("REJECTS an oversize REQUEST body before fetching", async () => {
		const res = await hostFetch(
			{
				url: `http://api.public.test:${port}/echo`,
				method: "POST",
				bodyBase64: Buffer.alloc(2048, 0x41).toString("base64"),
			},
			{
				resolve: resolverFrom({ "api.public.test": ["127.0.0.1"] }),
				validateIp: allowLoopback,
				maxBodyBytes: 1024,
			},
		);
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.error.code).toBe("bad_args");
	});
});

// ──────────────────────────────────────────────────────────────────────────
// hostFetch — SSRF denials (REAL validator; never throws).
// ──────────────────────────────────────────────────────────────────────────
describe("hostFetch — SSRF denials (structured error, never throws)", () => {
	it("DENIES a host that resolves to a private/loopback IP", async () => {
		const res = await hostFetch(
			{ url: "http://db.internal.test/" },
			{ resolve: resolverFrom({ "db.internal.test": ["10.1.2.3"] }) },
		);
		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.error.code).toBe("execution_error");
			expect(res.error.message.toLowerCase()).toContain("blocked");
		}
	});

	it("DENIES a host that resolves to cloud metadata 169.254.169.254", async () => {
		const res = await hostFetch(
			{ url: "http://metadata.test/latest/meta-data/" },
			{ resolve: resolverFrom({ "metadata.test": ["169.254.169.254"] }) },
		);
		expect(res.ok).toBe(false);
	});

	it("DENIES a host that RESOLVES to an IPv6 metadata / IPv4-mapped / 0.0.0.0 / non-decimal address (resolution path, not just literal)", async () => {
		// Each of these reaches the validator via the RESOLVER (not a URL literal),
		// proving `resolveAndValidate` classifies every resolved record — the IPv6
		// metadata convention (fd00:ec2::254), an IPv4-mapped loopback
		// (::ffff:127.0.0.1), this-host (0.0.0.0), and a non-canonical IPv4 literal a
		// resolver might hand back (decimal 2130706433 = 127.0.0.1).
		for (const resolved of [
			"fd00:ec2::254",
			"::ffff:127.0.0.1",
			"0.0.0.0",
			"2130706433",
		]) {
			const res = await hostFetch(
				{ url: "http://allowed.test/" },
				{ resolve: resolverFrom({ "allowed.test": [resolved] }) },
			);
			expect(res.ok).toBe(false);
			if (!res.ok) expect(res.error.message.toLowerCase()).toContain("blocked");
		}
	});

	it("DENIES a direct private IP literal in the URL with a POLICY block (no DNS, no connect)", async () => {
		for (const target of [
			"http://127.0.0.1/",
			"http://169.254.169.254/",
			"http://[::1]/",
			// Bracketed IPv6 + IPv4-mapped (Bun normalizes to [::ffff:7f00:1]) — the
			// bracket-order + hex-mapped bypasses must BOTH classify, not get pinned.
			"http://[::ffff:127.0.0.1]/",
			"http://2130706433/",
		]) {
			const res = await hostFetch(
				{ url: target },
				{ resolve: resolverFrom({}) },
			);
			expect(res.ok).toBe(false);
			// Must be the POLICY block, NOT a connection failure: the pre-fix `[::1]`
			// only "passed" because nothing was listening (ECONNREFUSED). A `blocked
			// target` message proves resolveAndValidate rejected it BEFORE connecting.
			if (!res.ok) expect(res.error.message.toLowerCase()).toContain("blocked");
		}
	});

	it("BLOCKS a bracketed IPv6 loopback pre-connect even with a real listener on [::1]", async () => {
		// A REAL listener on [::1] proves the policy rejects BEFORE connecting — not
		// that the socket merely failed (the cause the old [::1] assertion relied on).
		let hits = 0;
		const v6 = createServer((_req, res) => {
			hits++;
			res.writeHead(200).end("loopback-reached");
		});
		await new Promise<void>((resolve, reject) => {
			v6.once("error", reject);
			v6.listen(0, "::1", resolve);
		});
		const v6Port = (v6.address() as { port: number }).port;
		try {
			// REAL validator (no override) — must reject `[::1]` before any connect.
			const res = await hostFetch({ url: `http://[::1]:${v6Port}/` });
			expect(res.ok).toBe(false);
			if (!res.ok) {
				expect(res.error.message.toLowerCase()).toContain("blocked");
				expect(res.error.message).toContain("::1");
			}
			expect(hits).toBe(0); // policy blocked it — nothing reached the listener
		} finally {
			v6.close();
		}
	});

	it("DENIES a multi-record host where ONE record is private (whole-host reject)", async () => {
		const res = await hostFetch(
			{ url: "http://mixed.test/" },
			{
				resolve: resolverFrom({
					"mixed.test": ["93.184.216.34", "192.168.0.10"],
				}),
			},
		);
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.error.message.toLowerCase()).toContain("blocked");
	});

	it("★ DENIES the DNS-REBIND scenario — same host flips ALLOWED then PRIVATE; the pinned set is validated every call", async () => {
		// THE core rebind test, fully offline. A resolver for one hostname flips its
		// answer between calls: call #1 returns the (allowed) loopback origin and
		// SUCCEEDS; call #2 — a re-resolution, as DNS rebinding would do — returns a
		// metadata ip. hostFetch validates the ip set it actually PINS on EVERY call,
		// so the rebound (private) answer is DENIED. The earlier allowed answer is
		// never cached/reused: rebind-safe.
		seen.length = 0;
		let call = 0;
		const flipping = async (h: string): Promise<string[]> => {
			if (h !== "rebind.test") throw new Error("NXDOMAIN");
			call++;
			return call === 1 ? ["127.0.0.1"] : ["169.254.169.254"]; // allowed → metadata
		};
		const first = await hostFetch(
			{ url: `http://rebind.test:${port}/` },
			{ resolve: flipping, validateIp: allowLoopback },
		);
		const second = await hostFetch(
			{ url: `http://rebind.test:${port}/` },
			{ resolve: flipping, validateIp: allowLoopback },
		);
		// Call #1 connected to the validated loopback origin and got a 200.
		expect(first.ok).toBe(true);
		// Call #2 re-resolved to metadata → BLOCKED before any connect (not reused).
		expect(second.ok).toBe(false);
		if (!second.ok)
			expect(second.error.message.toLowerCase()).toContain("blocked");
		// The origin was hit EXACTLY once (only the first, allowed call).
		expect(seen.length).toBe(1);
	});

	it("★ rebind at a REDIRECT hop: the redirect target re-resolves to a private IP and is blocked", async () => {
		// hop1 is allowed (loopback origin via allowLoopback) and 302s to a host that
		// resolves PRIVATE. Auto-follow is off; hostFetch re-resolves + re-validates
		// the Location → blocked at the redirect hop (not at hop 1).
		const res = await hostFetch(
			{ url: `http://hop1.test:${port}/redirect-internal` },
			{
				resolve: resolverFrom({
					"hop1.test": ["127.0.0.1"],
					"internal.evil.test": ["10.0.0.9"],
				}),
				// Allow loopback (hop1) but use REAL classification for everything else,
				// so internal.evil.test → 10.0.0.9 is rejected at the redirect hop.
				validateIp: allowLoopback,
			},
		);
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.error.message.toLowerCase()).toContain("blocked");
	});

	it("DENIES a non-http(s) scheme and a malformed URL (bad_args, no throw)", async () => {
		const ftp = await hostFetch(
			{ url: "ftp://example.com/x" },
			{ resolve: resolverFrom({}) },
		);
		expect(ftp.ok).toBe(false);
		const bad = await hostFetch(
			{ url: "not a url" },
			{ resolve: resolverFrom({}) },
		);
		expect(bad.ok).toBe(false);
		if (!bad.ok) expect(bad.error.code).toBe("bad_args");
	});
});
