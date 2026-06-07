import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import {
	classifyIpLiteral,
	parseHostEntry,
	validateEgressHosts,
	validateHostEgress,
} from "../src/net-validation.js";

// A fake resolver so tests are deterministic and offline.
const fakeResolver =
	(map: Record<string, string[]>) =>
	async (hostname: string): Promise<string[]> => {
		if (hostname in map) return map[hostname];
		throw new Error(`NXDOMAIN: ${hostname}`);
	};

describe("parseHostEntry", () => {
	it("parses host:port", () => {
		expect(parseHostEntry("esm.sh:443")).toEqual({ host: "esm.sh", port: 443 });
	});
	it("parses bare host", () => {
		expect(parseHostEntry("esm.sh")).toEqual({ host: "esm.sh" });
	});
	it("parses bracketed IPv6 with port", () => {
		expect(parseHostEntry("[::1]:443")).toEqual({ host: "::1", port: 443 });
	});
	it("parses bare IPv6 without port", () => {
		expect(parseHostEntry("fc00::1")).toEqual({ host: "fc00::1" });
	});
});

describe("classifyIpLiteral — private/link-local/loopback/metadata", () => {
	const blocked = [
		"127.0.0.1",
		"127.5.5.5",
		"10.0.0.1",
		"10.255.255.255",
		"172.16.0.1",
		"172.31.255.255",
		"192.168.1.1",
		"169.254.169.254", // AWS/GCP/Azure metadata
		"169.254.0.1",
		"100.64.0.1", // CGNAT
		"100.127.255.255",
		"0.0.0.0",
		"::1",
		"::",
		"fc00::1",
		"fd12:3456::1",
		"fe80::1",
		"::ffff:127.0.0.1", // IPv4-mapped loopback
	];
	for (const ip of blocked) {
		it(`blocks ${ip}`, () => {
			expect(classifyIpLiteral(ip).ok).toBe(false);
		});
	}

	const allowed = [
		"1.1.1.1",
		"8.8.8.8",
		"104.16.0.1",
		"172.15.0.1", // just below RFC-1918 172.16/12
		"172.32.0.1", // just above
		"100.63.255.255", // just below CGNAT 100.64/10
		"100.128.0.1", // just above
		"2606:4700::1111", // cloudflare v6
	];
	for (const ip of allowed) {
		it(`allows public ${ip}`, () => {
			expect(classifyIpLiteral(ip).ok).toBe(true);
		});
	}
});

describe("validateHostEgress", () => {
	it("rejects literal private IPs", async () => {
		expect((await validateHostEgress("127.0.0.1:8080")).ok).toBe(false);
		expect((await validateHostEgress("169.254.169.254:80")).ok).toBe(false);
		expect((await validateHostEgress("[::1]:443")).ok).toBe(false);
	});

	it("rejects localhost / mDNS names without resolving", async () => {
		expect((await validateHostEgress("localhost:80")).ok).toBe(false);
		expect((await validateHostEgress("foo.local:80")).ok).toBe(false);
	});

	it("allows a public IP literal", async () => {
		expect((await validateHostEgress("1.1.1.1:443")).ok).toBe(true);
	});

	it("DNS-REBIND: rejects a hostname resolving to a private IP", async () => {
		const r = await validateHostEgress("evil.example.com:443", {
			resolve: fakeResolver({ "evil.example.com": ["1.2.3.4", "127.0.0.1"] }),
		});
		expect(r.ok).toBe(false);
		expect(r.reason).toContain("blocked address");
	});

	it("allows a hostname resolving only to public IPs", async () => {
		const r = await validateHostEgress("good.example.com:443", {
			resolve: fakeResolver({ "good.example.com": ["93.184.216.34"] }),
		});
		expect(r.ok).toBe(true);
	});

	it("fails CLOSED when DNS resolution fails", async () => {
		const r = await validateHostEgress("nope.example.com:443", {
			resolve: fakeResolver({}),
		});
		expect(r.ok).toBe(false);
	});

	it("rejects a hostname that resolves to the AWS metadata IP", async () => {
		const r = await validateHostEgress("metadata.evil.com:80", {
			resolve: fakeResolver({ "metadata.evil.com": ["169.254.169.254"] }),
		});
		expect(r.ok).toBe(false);
	});
});

describe("validateEgressHosts", () => {
	it("returns the first rejection across net+import hosts", async () => {
		const r = await validateEgressHosts(["esm.sh:443", "127.0.0.1:80"], {
			resolve: fakeResolver({ "esm.sh": ["104.16.0.1"] }),
		});
		expect(r.ok).toBe(false);
		expect(r.reason).toContain("127.0.0.1");
	});

	it("passes when every host is public", async () => {
		const r = await validateEgressHosts(["esm.sh:443", "1.1.1.1:443"], {
			resolve: fakeResolver({ "esm.sh": ["104.16.0.1"] }),
		});
		expect(r.ok).toBe(true);
	});
});

// A resolver that hangs forever — proves the caller never blocks on the
// SUPPLIED resolver path (the default-resolver timeout is exercised separately).
const neverResolve: () => Promise<string[]> = () => new Promise<string[]>(() => {});

describe("IPv6 zone-id (scope) handling — fe80::1%eth0 must not slip through", () => {
	// `%zone` makes the literal fail the IPv6-literal shape check (`%` is not in the
	// allowed charset), so `classifyIpLiteral` returns ok:true ("not an IP literal").
	// The link-local CLASSIFICATION therefore only runs once the zone suffix is gone.
	it("classifyIpLiteral treats a zone-suffixed literal as a non-literal (ok:true)", () => {
		expect(classifyIpLiteral("fe80::1%eth0").ok).toBe(true);
	});

	// The bare (zone-stripped) form IS recognised and blocked as link-local — this is
	// the normalize/strip path that connect-time / DNS-rebind results flow through.
	it("classifyIpLiteral blocks the bare link-local form fe80::1", () => {
		const c = classifyIpLiteral("fe80::1");
		expect(c.ok).toBe(false);
		expect(c.reason).toContain("fe80::1");
	});

	// End-to-end, the zone-suffixed host is STILL rejected: not matched as a literal,
	// it falls through to DNS and fails CLOSED. Inject an NXDOMAIN resolver so this is
	// deterministic + offline (no real lookup), and assert a deny rather than a hang.
	it("validateHostEgress rejects fe80::1%eth0 (fails closed via DNS)", async () => {
		const nx = fakeResolver({});
		expect((await validateHostEgress("fe80::1%eth0", { resolve: nx })).ok).toBe(false);
		// Bracketed `[fe80::1%eth0]:443` parses to the same host → same rejection.
		expect((await validateHostEgress("[fe80::1%eth0]:443", { resolve: nx })).ok).toBe(false);
	});

	// DNS-REBIND through a zone-suffixed name: if it resolves to the bare link-local
	// address, the zone-stripping classifier catches it explicitly.
	it("rejects a zone-suffixed host that resolves to a link-local address", async () => {
		const r = await validateHostEgress("fe80::1%eth0", {
			resolve: fakeResolver({ "fe80::1%eth0": ["fe80::1"] }),
		});
		expect(r.ok).toBe(false);
		expect(r.reason).toContain("blocked address");
	});
});

describe("malformed IPv4 — '999.0.0.1' / '1.2.3' are not treated as IP literals", () => {
	// Out-of-range octet (999 > 255) and too-few octets (1.2.3) both FAIL the IPv4
	// literal shape, so `classifyIpLiteral` returns ok:true (= "resolve it as a host").
	it("classifyIpLiteral returns ok:true (non-literal) for 999.0.0.1 and 1.2.3", () => {
		expect(classifyIpLiteral("999.0.0.1").ok).toBe(true);
		expect(classifyIpLiteral("1.2.3").ok).toBe(true);
	});

	// Because they are treated as HOSTNAMES, validateHostEgress resolves them and
	// fails CLOSED when resolution fails (injected NXDOMAIN → deterministic/offline).
	it("validateHostEgress treats them as hostnames and fails closed on NXDOMAIN", async () => {
		const nx = fakeResolver({});
		expect((await validateHostEgress("999.0.0.1:80", { resolve: nx })).ok).toBe(false);
		expect((await validateHostEgress("1.2.3:80", { resolve: nx })).ok).toBe(false);
	});

	// ...and if such a name happened to resolve to a PUBLIC address, it is allowed —
	// confirming the "treated as hostname" branch (not silently passed as a literal).
	it("a malformed-IPv4 host resolving to a public address is allowed", async () => {
		const r = await validateHostEgress("1.2.3:80", {
			resolve: fakeResolver({ "1.2.3": ["8.8.8.8"] }),
		});
		expect(r.ok).toBe(true);
	});

	// A malformed-IPv4 host resolving to a PRIVATE address is rejected (DNS-rebind).
	it("a malformed-IPv4 host resolving to a private address is rejected", async () => {
		const r = await validateHostEgress("999.0.0.1:80", {
			resolve: fakeResolver({ "999.0.0.1": ["127.0.0.1"] }),
		});
		expect(r.ok).toBe(false);
		expect(r.reason).toContain("blocked address");
	});
});

describe("withDnsTimeout — a hanging resolver yields a deny, never a hang", () => {
	// The internal `withDnsTimeout` only wraps the DEFAULT (node:dns) resolver. We
	// drive that path by pointing node:dns at a blackholed DNS server (RFC-5737
	// TEST-NET-1, non-routable → resolve4/resolve6 hang), so the 3s timeout fires and
	// the host is DENIED. No injected resolver: the production timeout is what's tested.
	// State is restored in afterAll so other suites/files are unaffected.
	let originalServers: string[] = [];

	beforeAll(async () => {
		const dns = await import("node:dns/promises");
		originalServers = dns.getServers();
		dns.setServers(["192.0.2.1"]); // blackholed, guaranteed-non-routable
	});

	afterAll(async () => {
		const dns = await import("node:dns/promises");
		dns.setServers(originalServers);
	});

	it(
		"denies (fails closed) when the default resolver hangs, within the timeout",
		async () => {
			const start = Date.now();
			const r = await validateHostEgress("dns-timeout-probe.example.com:443");
			const elapsed = Date.now() - start;

			expect(r.ok).toBe(false);
			expect(r.reason).toContain("timed out");
			// The 3s internal timeout bounds it — a true hang would blow the test timeout.
			expect(elapsed).toBeLessThan(8_000);
		},
		15_000,
	);

	// An INJECTED resolver is not wrapped by withDnsTimeout — guard the never-resolving
	// case with an explicit race so a behavioural regression surfaces as a fast failure
	// instead of stalling the suite.
	it("never blocks the suite on a supplied resolver (explicit race guard)", async () => {
		const sentinel = Symbol("still-pending");
		const guard = new Promise<typeof sentinel>((resolve) =>
			setTimeout(() => resolve(sentinel), 1_000),
		);
		const call = validateHostEgress("supplied-hang.example.com:443", {
			resolve: neverResolve,
		});
		const winner = await Promise.race([call, guard]);
		// Today the supplied resolver is awaited directly (no internal timeout), so the
		// guard wins. This documents that the timeout guarantee is DEFAULT-resolver only.
		expect(winner).toBe(sentinel);
	});
});
