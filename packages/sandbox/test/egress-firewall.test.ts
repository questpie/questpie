/**
 * Unit tests for the defense-in-depth egress firewall PLANNER + ruleset/argv
 * builders (`egress-firewall.ts`).
 *
 * ── Honesty boundary ────────────────────────────────────────────────────────
 * These tests run on ANY platform (incl. this macOS dev machine) and assert the
 * pure LOGIC: the platform gate, the exact nftables ruleset text, and the exact
 * `unshare` argv wrap. They DELIBERATELY do NOT assert that the kernel drops a
 * packet — that is a Linux-kernel behavior that cannot be exercised off Linux.
 * The kernel-drop guarantee is verified manually on a Linux worker (see the
 * module-level "LINUX MANUAL VERIFICATION" note in `egress-firewall.ts`).
 *
 * What these tests DO guarantee on every platform:
 *   - On non-Linux the planner returns `applied:false` (the Mac/Windows no-op
 *     that keeps local workers running on the baseline brokered-fetch defense).
 *   - When applied, the ruleset DROPS the full private/metadata set and only
 *     ACCEPTs the resolved allowlist, with DROP rules ordered before ACCEPTs.
 */
import { describe, expect, it } from "bun:test";

import {
	BLOCKED_IPV4_CIDRS,
	BLOCKED_IPV6_CIDRS,
	NFT_TABLE,
	buildNftRuleset,
	isLinux,
	normalizeOs,
	planEgressFirewall,
	wrapWithNetns,
} from "../src/egress-firewall.js";

const ALL_TOOLS = { unshare: true, nft: true, ip: true };

describe("isLinux / normalizeOs", () => {
	it("isLinux is true only for 'linux'", () => {
		expect(isLinux("linux")).toBe(true);
		expect(isLinux("darwin")).toBe(false);
		expect(isLinux("windows")).toBe(false);
	});
	it("normalizeOs maps win32 → windows, leaves deno names intact", () => {
		expect(normalizeOs("win32")).toBe("windows");
		expect(normalizeOs("darwin")).toBe("darwin");
		expect(normalizeOs("linux")).toBe("linux");
	});
});

describe("planEgressFirewall — graceful absence (the non-Linux / no-cap no-op)", () => {
	it("skips on macOS (darwin) with a reason mentioning the baseline", () => {
		const plan = planEgressFirewall({
			os: "darwin",
			allow: [],
			tools: ALL_TOOLS,
			hasCaps: true,
		});
		expect(plan.applied).toBe(false);
		if (!plan.applied) {
			expect(plan.reason).toContain("non-Linux");
			expect(plan.reason).toContain("brokered fetch");
		}
	});

	it("skips on Windows", () => {
		const plan = planEgressFirewall({
			os: "windows",
			allow: [],
			tools: ALL_TOOLS,
			hasCaps: true,
		});
		expect(plan.applied).toBe(false);
	});

	it("skips on Linux when a required tool is missing (and names it)", () => {
		const plan = planEgressFirewall({
			os: "linux",
			allow: [],
			tools: { unshare: true, nft: false, ip: true },
			hasCaps: true,
		});
		expect(plan.applied).toBe(false);
		if (!plan.applied) {
			expect(plan.reason).toContain("nft");
			expect(plan.reason).not.toContain("unshare");
		}
	});

	it("skips on Linux when the supervisor lacks capabilities", () => {
		const plan = planEgressFirewall({
			os: "linux",
			allow: [],
			tools: ALL_TOOLS,
			hasCaps: false,
		});
		expect(plan.applied).toBe(false);
		if (!plan.applied) {
			expect(plan.reason).toContain("CAP_NET_ADMIN");
		}
	});
});

describe("planEgressFirewall — applies on Linux with tools + caps", () => {
	it("applies with an empty allowlist (pure default-deny — the brokered posture)", () => {
		const plan = planEgressFirewall({
			os: "linux",
			allow: [],
			tools: ALL_TOOLS,
			hasCaps: true,
		});
		expect(plan.applied).toBe(true);
		if (plan.applied) {
			expect(plan.allowCount).toBe(0);
			expect(plan.nftRuleset).toContain("policy drop;");
		}
	});

	it("applies and pins the resolved allowlist IPs", () => {
		const plan = planEgressFirewall({
			os: "linux",
			allow: [{ ip: "93.184.216.34", port: 443 }],
			tools: ALL_TOOLS,
			hasCaps: true,
		});
		expect(plan.applied).toBe(true);
		if (plan.applied) {
			expect(plan.allowCount).toBe(1);
			expect(plan.nftRuleset).toContain("ip daddr 93.184.216.34 tcp dport 443 accept");
		}
	});
});

describe("buildNftRuleset — drops the full private/metadata set", () => {
	const ruleset = buildNftRuleset([]);

	it("declares the inet table + default-drop output chain", () => {
		expect(ruleset).toContain(`table inet ${NFT_TABLE} {`);
		expect(ruleset).toContain("type filter hook output priority 0; policy drop;");
	});

	it("accepts established/related + loopback so own-process plumbing works", () => {
		expect(ruleset).toContain("ct state established,related accept");
		expect(ruleset).toContain('oif "lo" accept');
	});

	it("DROPs every blocked IPv4 CIDR (incl. metadata + CGNAT)", () => {
		for (const cidr of BLOCKED_IPV4_CIDRS) {
			expect(ruleset).toContain(`ip daddr ${cidr} drop`);
		}
		// Spot-check the security-critical ones are present in the constant set.
		expect(BLOCKED_IPV4_CIDRS).toContain("169.254.0.0/16"); // metadata
		expect(BLOCKED_IPV4_CIDRS).toContain("127.0.0.0/8"); // loopback
		expect(BLOCKED_IPV4_CIDRS).toContain("10.0.0.0/8"); // RFC-1918
		expect(BLOCKED_IPV4_CIDRS).toContain("100.64.0.0/10"); // CGNAT
	});

	it("DROPs every blocked IPv6 CIDR (incl. ULA/metadata + mapped + link-local)", () => {
		for (const cidr of BLOCKED_IPV6_CIDRS) {
			expect(ruleset).toContain(`ip6 daddr ${cidr} drop`);
		}
		expect(BLOCKED_IPV6_CIDRS).toContain("fc00::/7"); // ULA incl. fd00:ec2::254
		expect(BLOCKED_IPV6_CIDRS).toContain("fe80::/10"); // link-local
		expect(BLOCKED_IPV6_CIDRS).toContain("::ffff:0:0/96"); // IPv4-mapped
		expect(BLOCKED_IPV6_CIDRS).toContain("::1/128"); // loopback
	});

	it("orders DROP rules BEFORE any ACCEPT (drop wins over a mis-allow)", () => {
		const rs = buildNftRuleset([{ ip: "8.8.8.8" }]);
		const firstDrop = rs.indexOf("daddr 10.0.0.0/8 drop");
		const accept = rs.indexOf("daddr 8.8.8.8 accept");
		expect(firstDrop).toBeGreaterThan(-1);
		expect(accept).toBeGreaterThan(-1);
		expect(firstDrop).toBeLessThan(accept);
	});

	it("emits an IPv6 accept with the ip6 family + omits the port clause when unset", () => {
		const rs = buildNftRuleset([{ ip: "2606:4700:4700::1111" }]);
		expect(rs).toContain("ip6 daddr 2606:4700:4700::1111 accept");
		expect(rs).not.toContain("dport");
	});

	it("is deterministic (same input → byte-identical output)", () => {
		const a = buildNftRuleset([{ ip: "1.1.1.1", port: 443 }]);
		const b = buildNftRuleset([{ ip: "1.1.1.1", port: 443 }]);
		expect(a).toBe(b);
	});
});

describe("wrapWithNetns — pure argv transform", () => {
	const guestArgv = ["/usr/bin/deno", "run", "--no-prompt", "--allow-net=", "/x/guest-entry.ts"];

	it("prefixes unshare --net --map-root-user and exec's the guest as \"$@\"", () => {
		const { cmd, args } = wrapWithNetns(guestArgv, "/run/q.nft");
		expect(cmd).toBe("unshare");
		expect(args.slice(0, 3)).toEqual(["--net", "--map-root-user", "--"]);
		expect(args).toContain("/bin/sh");
		expect(args).toContain("-c");
		// The guest argv is appended verbatim AFTER the bootstrap + $0, becoming "$@".
		expect(args.slice(-guestArgv.length)).toEqual(guestArgv);
	});

	it("loads the ruleset (fail-closed: set -e) and brings up lo before exec", () => {
		const { args } = wrapWithNetns(guestArgv, "/run/q.nft");
		const bootstrap = args.find((a) => a.includes("exec")) as string;
		expect(bootstrap).toContain("set -e");
		expect(bootstrap).toContain("ip link set lo up");
		expect(bootstrap).toContain("nft -f '/run/q.nft'");
		// exec the guest LAST.
		expect(bootstrap.indexOf("nft -f")).toBeLessThan(bootstrap.indexOf('exec "$@"'));
	});

	it("pins a deterministic PATH so nft/ip resolve under the cleared child env", () => {
		const { args } = wrapWithNetns(guestArgv, "/run/q.nft");
		const bootstrap = args.find((a) => a.includes("exec")) as string;
		expect(bootstrap).toContain("PATH=/usr/sbin:/usr/bin:/sbin:/bin");
		// PATH is set before nft/ip run.
		expect(bootstrap.indexOf("PATH=")).toBeLessThan(bootstrap.indexOf("nft -f"));
	});

	it("single-quotes the ruleset path (defends against odd path chars)", () => {
		const { args } = wrapWithNetns(guestArgv, "/run/it's.nft");
		const bootstrap = args.find((a) => a.includes("exec")) as string;
		expect(bootstrap).toContain(`nft -f '/run/it'\\''s.nft'`);
	});
});
