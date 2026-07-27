/**
 * Defense-in-depth egress firewall (LINUX-ONLY, cloud workers) — milestone S6 of
 * spec `sandbox-brokered-http-egress`.
 *
 * ── What this is ────────────────────────────────────────────────────────────
 * A *belt-and-suspenders* kernel-level egress drop for the guest `deno run`
 * subprocess. The BASELINE SSRF defense is the brokered `http.fetch` path: the
 * guest runs with `--allow-net=[]` and cannot open sockets at all, so it has no
 * network reach to lose. This layer adds a SECOND, independent boundary at the
 * KERNEL: even if a future change granted the guest raw `--allow-net`, or a
 * low-level escape (e.g. a Deno/V8 bug, a smuggled `--allow-import` host that
 * rebinds) opened a socket, the kernel DROPS every packet to a
 * private/link-local/loopback/metadata address. Only the resolved per-run
 * allowlist (plus the host broker) is permitted. This is what Deno Subhosting
 * does for its isolates.
 *
 * ── Platform honesty ────────────────────────────────────────────────────────
 * Network namespaces + nftables are a LINUX KERNEL feature. There is NO
 * equivalent on macOS or Windows, and the kernel-drop behavior CANNOT be
 * functionally verified off Linux. Therefore this module is designed to be
 * GRACEFULLY ABSENT: {@link planEgressFirewall} returns a structured plan that
 * the supervisor consults. On non-Linux — or on Linux when the required tools
 * (`unshare`, `nft`, `ip`) or the `CAP_NET_ADMIN`/`CAP_SYS_ADMIN` capabilities
 * are absent — the plan is `{ applied:false, reason }` and the supervisor spawns
 * the guest EXACTLY as before. The local Mac/Windows workers are unaffected; the
 * baseline stays safe via the brokered fetch.
 *
 * ── This file is PURE + testable ────────────────────────────────────────────
 * Like `server-internals.ts`, this module holds NO Deno globals and NO top-level
 * side effects, so it lands inside the package `tsconfig` `include` and is
 * unit-tested under `bun:test`. The tests assert the LOGIC — the exact nftables
 * ruleset text and the exact wrapped argv — which is what carries the security
 * guarantee. They do NOT (and on macOS cannot) assert the kernel actually drops
 * the packet; that is verified manually on a Linux worker (see the spec/task
 * `## Verify` and the module-level Linux repro note below).
 *
 * The Deno-only wiring (platform/tool/cap probing + the real spawn wrap) lives
 * in `sandbox-server.ts`, which is `@ts-nocheck` and excluded from the typecheck.
 *
 * ── LINUX MANUAL VERIFICATION (documented-only; needs a Linux worker) ────────
 *   1. Run the sandbox-server on a Linux host (root or with CAP_NET_ADMIN +
 *      CAP_SYS_ADMIN; `unshare`, `nft`, `ip` on PATH).
 *   2. POST /run a guest that is (for the test) granted `--allow-net` and tries
 *      `await fetch("http://169.254.169.254/latest/meta-data/")`.
 *   3. Even though the broker is bypassed, the connect() is DROPPED at the
 *      kernel by the nft `output` chain → the guest's fetch fails with a network
 *      error; the metadata service is never reached.
 *   4. A guest fetch to an allowlisted PUBLIC IP succeeds (it is in the per-run
 *      `accept` set). A fetch to any other public IP is also dropped (default
 *      policy is DROP; only the allowlist + broker are accepted).
 *   On macOS/Windows: {@link planEgressFirewall} returns `applied:false` and the
 *   guest spawns unchanged — the kernel drop is NOT exercised here.
 */

/**
 * Private / link-local / loopback / metadata ranges the firewall DROPS.
 *
 * These MUST stay in lock-step with the classifier in `net-validation.ts`
 * (`isPrivateIpv4` / `isPrivateIpv6`) — the request-time allowlist check and the
 * kernel drop must cover the SAME address space, or the two layers disagree.
 * CIDR form (what `nft` consumes) of the exact same set.
 */
export const BLOCKED_IPV4_CIDRS: readonly string[] = [
	"0.0.0.0/8", // "this host" / unspecified
	"10.0.0.0/8", // RFC-1918 private
	"100.64.0.0/10", // RFC-6598 CGNAT
	"127.0.0.0/8", // loopback
	"169.254.0.0/16", // link-local (incl. 169.254.169.254 cloud metadata)
	"172.16.0.0/12", // RFC-1918 private
	"192.168.0.0/16", // RFC-1918 private
];

/**
 * IPv6 counterparts. `::ffff:0:0/96` (IPv4-mapped) is dropped wholesale so a
 * mapped private literal cannot sneak through; allowlisted public targets are
 * accepted by their NATIVE v4/v6 address, not a mapped form.
 */
export const BLOCKED_IPV6_CIDRS: readonly string[] = [
	"::1/128", // loopback
	"::/128", // unspecified
	"::ffff:0:0/96", // IPv4-mapped (covers ::ffff:127.0.0.1, ::ffff:169.254.169.254, …)
	"fc00::/7", // unique-local (incl. fd00:ec2::254 cloud metadata)
	"fe80::/10", // link-local
];

/** Name of the nft table the firewall installs (per-run, torn down with the netns). */
export const NFT_TABLE = "questpie_sandbox_egress";

/**
 * A single resolved allowlist endpoint the guest is permitted to reach. The
 * supervisor resolves each per-run allowlist host to its validated public IP(s)
 * (reusing `net-validation.ts`) and pins them here, so the kernel `accept` rules
 * reference IPs — never hostnames (nft cannot match DNS, and pinning the IP is
 * itself part of the anti-rebind guarantee).
 */
export interface AllowedEndpoint {
	/** Validated public IP literal (v4 or v6) the guest may egress to. */
	ip: string;
	/** Optional destination port to scope the accept to (e.g. 443). Omit = any port. */
	port?: number;
}

export interface EgressFirewallPlanInput {
	/** `globalThis.Deno.build.os` (or `process.platform`-mapped) — the only OS gate. */
	os: string;
	/**
	 * Per-run resolved allowlist + broker IP(s), already validated as PUBLIC by
	 * `net-validation.ts`. These become the kernel `accept` rules. Empty = the
	 * guest may reach nothing (default-deny), which is the correct posture for the
	 * brokered path (`--allow-net=[]`): nothing to allow, everything dropped.
	 */
	allow: readonly AllowedEndpoint[];
	/**
	 * Which required tools were found on PATH (probed by the supervisor with
	 * `Deno.Command(...).spawn` / `which`). All must be present to apply the
	 * firewall; a missing tool → graceful no-op with a logged notice.
	 */
	tools: { unshare: boolean; nft: boolean; ip: boolean };
	/**
	 * Whether the supervisor holds the namespace/firewall capabilities
	 * (root, or CAP_NET_ADMIN + CAP_SYS_ADMIN). Probed by the supervisor; when
	 * false the firewall is a graceful no-op (the netns/nft syscalls would EPERM).
	 */
	hasCaps: boolean;
}

/** The skip outcome: the guest spawns unchanged; the supervisor logs `reason`. */
export interface EgressFirewallSkip {
	applied: false;
	/** Human-readable why-skipped, logged once by the supervisor as a notice. */
	reason: string;
}

/** The apply outcome: the supervisor wraps the guest argv with {@link wrapWithNetns}. */
export interface EgressFirewallApply {
	applied: true;
	/** The nftables ruleset to load inside the guest's netns (an `nft -f -` script). */
	nftRuleset: string;
	/** Count of accept rules emitted (diagnostic; 0 = pure default-deny). */
	allowCount: number;
}

export type EgressFirewallPlan = EgressFirewallSkip | EgressFirewallApply;

/** True only for Linux. macOS (`darwin`) / Windows (`windows`) → false. */
export function isLinux(os: string): boolean {
	return os === "linux";
}

/**
 * `process.platform` → `Deno.build.os` vocabulary, so the supervisor and any
 * Bun/Node probe agree on one OS string. Deno uses `darwin` / `windows` / `linux`.
 */
export function normalizeOs(platform: string): string {
	if (platform === "win32") return "windows";
	return platform; // darwin, linux already match Deno's vocabulary
}

/** Basic IPv4-literal test (mirrors net-validation, kept local to stay pure). */
function looksIpv4(ip: string): boolean {
	const parts = ip.split(".");
	return (
		parts.length === 4 &&
		parts.every(
			(p) => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255,
		)
	);
}

/**
 * Build the nftables ruleset (an `nft -f -` script) for ONE run.
 *
 * Shape (an `inet` table → one `output` hook chain, default policy DROP):
 *   - ACCEPT established/related + loopback `lo` (DNS/own-process plumbing).
 *   - DROP every {@link BLOCKED_IPV4_CIDRS} / {@link BLOCKED_IPV6_CIDRS} dest.
 *     (Listed BEFORE the allowlist so a misclassified allow can never re-open a
 *     private range — drop wins.)
 *   - ACCEPT each resolved {@link AllowedEndpoint} (the per-run allowlist +
 *     broker), pinned to its validated public IP (and port, if given).
 *   - Final implicit DROP via the chain's `policy drop`.
 *
 * Deterministic: same input → byte-identical output, so it is unit-testable.
 */
export function buildNftRuleset(allow: readonly AllowedEndpoint[]): string {
	const lines: string[] = [];
	lines.push(`# QUESTPIE sandbox egress firewall (defense-in-depth, per-run).`);
	lines.push(
		`# Default-deny: only the resolved allowlist + broker may egress.`,
	);
	lines.push(`table inet ${NFT_TABLE} {`);
	lines.push(`\tchain output {`);
	lines.push(`\t\ttype filter hook output priority 0; policy drop;`);
	// Keep own-process plumbing + reply traffic working.
	lines.push(`\t\tct state established,related accept`);
	lines.push(`\t\toif "lo" accept`);

	// DROP the private/metadata space FIRST — drop must win over any allow.
	for (const cidr of BLOCKED_IPV4_CIDRS) {
		lines.push(`\t\tip daddr ${cidr} drop`);
	}
	for (const cidr of BLOCKED_IPV6_CIDRS) {
		lines.push(`\t\tip6 daddr ${cidr} drop`);
	}

	// ACCEPT the resolved per-run allowlist (public IPs only — already validated).
	for (const ep of allow) {
		const fam = looksIpv4(ep.ip) ? "ip" : "ip6";
		const portClause =
			typeof ep.port === "number" && Number.isInteger(ep.port)
				? ` tcp dport ${ep.port}`
				: "";
		lines.push(`\t\t${fam} daddr ${ep.ip}${portClause} accept`);
	}

	lines.push(`\t}`);
	lines.push(`}`);
	return lines.join("\n") + "\n";
}

/**
 * Decide whether to apply the firewall for this run, and build its artifacts.
 *
 * Returns `{ applied:false, reason }` (graceful no-op) when:
 *   - the OS is not Linux (macOS / Windows local workers), OR
 *   - a required tool (`unshare`/`nft`/`ip`) is missing, OR
 *   - the supervisor lacks the netns/firewall capabilities.
 *
 * Otherwise returns `{ applied:true, nftRuleset, allowCount }`; the supervisor
 * then wraps the guest argv with {@link wrapWithNetns}.
 *
 * NOTE: an empty `allow` is VALID and still applies on Linux — it yields a pure
 * default-deny netns, the correct posture for the brokered (`--allow-net=[]`)
 * path. The guest has nothing to reach over raw sockets; the kernel enforces it.
 */
export function planEgressFirewall(
	input: EgressFirewallPlanInput,
): EgressFirewallPlan {
	if (!isLinux(input.os)) {
		return {
			applied: false,
			reason: `non-Linux platform (${input.os}); netns+nftables egress firewall unavailable — baseline stays safe via brokered fetch`,
		};
	}
	const missing: string[] = [];
	if (!input.tools.unshare) missing.push("unshare");
	if (!input.tools.nft) missing.push("nft");
	if (!input.tools.ip) missing.push("ip");
	if (missing.length > 0) {
		return {
			applied: false,
			reason: `required tool(s) not found on PATH: ${missing.join(", ")} — skipping kernel egress firewall (brokered fetch still enforces SSRF policy)`,
		};
	}
	if (!input.hasCaps) {
		return {
			applied: false,
			reason: `supervisor lacks CAP_NET_ADMIN/CAP_SYS_ADMIN (not root / no caps) — netns+nftables cannot be created; skipping (brokered fetch still enforces SSRF policy)`,
		};
	}
	return {
		applied: true,
		nftRuleset: buildNftRuleset(input.allow),
		allowCount: input.allow.length,
	};
}

/**
 * Wrap a guest `deno run …` argv so it executes inside a fresh NETWORK
 * NAMESPACE with the egress firewall loaded, via a small bootstrap run under
 * `unshare`.
 *
 * The produced argv is:
 *
 *   unshare --net --map-root-user -- /bin/sh -c '<bootstrap> && exec "$@"' -- <guest argv…>
 *
 * where `<bootstrap>` brings up loopback (`ip link set lo up`), loads the
 * per-run ruleset (`nft -f <rulesetPath>`), then `exec`s the unchanged guest
 * command. Running the guest as PID-in-its-own-netns means killing the
 * supervisor's child still reaps it (the existing SIGTERM/SIGKILL path is
 * unchanged — this only prefixes the command).
 *
 * `--map-root-user` lets an UNPRIVILEGED supervisor create the netns via a user
 * namespace where it is root *inside* (modern kernels with unprivileged userns).
 * On hosts where that is disabled, the supervisor's cap probe returns false and
 * we never get here — the firewall no-ops instead (see {@link planEgressFirewall}).
 *
 * IMPORTANT: this is a PURE argv transform (no syscalls), so it is unit-testable
 * off Linux. The actual namespace/firewall effect is exercised only on Linux.
 *
 * @param guestArgv  the original `[DENO_BIN, "run", …flags, entry]` the
 *                   supervisor would have spawned.
 * @param rulesetPath absolute path to the ruleset file the supervisor wrote
 *                   (from {@link EgressFirewallApply.nftRuleset}).
 * @returns `{ cmd, args }` for `new Deno.Command(cmd, { args, … })`.
 */
export function wrapWithNetns(
	guestArgv: readonly string[],
	rulesetPath: string,
): { cmd: string; args: string[] } {
	// Bootstrap that runs INSIDE the new netns before the guest:
	//   0. set a deterministic PATH so `nft`/`ip` resolve. The supervisor spawns
	//      `unshare` with `clearEnv:true`, so the inner shell would otherwise get
	//      execvp's default PATH (no `/sbin` or `/usr/sbin`, where nft/ip usually
	//      live) → "command not found". Pinning PATH here is robust + deterministic.
	//   1. bring loopback up (so the guest's own intra-process plumbing works),
	//   2. load the egress ruleset,
	//   3. exec the guest argv (passed as positional "$@").
	// `set -e` so a failed nft load aborts BEFORE the guest runs (fail-closed:
	// we never run the guest in a netns whose firewall did not load).
	const bootstrap = [
		"set -e",
		"PATH=/usr/sbin:/usr/bin:/sbin:/bin:$PATH",
		"ip link set lo up",
		`nft -f ${shQuote(rulesetPath)}`,
		'exec "$@"',
	].join("; ");

	return {
		cmd: "unshare",
		args: [
			"--net", // fresh network namespace (no interfaces but lo)
			"--map-root-user", // root-inside via userns for unprivileged hosts
			"--",
			"/bin/sh",
			"-c",
			bootstrap,
			"sh", // $0 for the inner shell
			...guestArgv, // become "$@" → exec'd as the guest
		],
	};
}

/** Minimal POSIX single-quote escaping for embedding a path in the `sh -c` bootstrap. */
function shQuote(s: string): string {
	return `'${s.replace(/'/g, `'\\''`)}'`;
}
