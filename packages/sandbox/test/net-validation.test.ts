import { describe, expect, it } from "bun:test";

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
