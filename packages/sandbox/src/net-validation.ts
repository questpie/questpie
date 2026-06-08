/**
 * Network egress validation — SSRF / DNS-rebind defense for sandboxed guests.
 *
 * The sandbox grants each guest a per-request `net`/`import` allowlist of
 * `host[:port]` entries (driving Deno's `--allow-net` / `--allow-import`).
 * Deno's allowlist is a hostname-STRING match with NO IP validation, so an
 * allowlisted domain that resolves to a private/link-local/loopback/metadata
 * address (e.g. `169.254.169.254`, `127.0.0.1`, RFC-1918) would still connect.
 * This module rejects those at MANIFEST-VALIDATION time.
 *
 * Runtime-agnostic: the DNS resolver is injectable so this same code runs under
 * Bun/Node (manifest validation in the adapter) and Deno (the sandbox server).
 * It defaults to `node:dns/promises`, which both Bun and Deno implement.
 *
 * SCOPE (M2): manifest-time rejection of private-IP hosts is implemented and
 * enforced here. Full connect-time DNS-rebind PINNING (re-resolving and
 * re-checking the exact IP the socket connects to, including across redirects)
 * is NOT yet implemented — see `TODO(security)` in `sandbox-server.ts`.
 */

/** A single parsed `host[:port]` allowlist entry. */
export interface ParsedHost {
	/** Bare hostname or IP literal (IPv6 without brackets). */
	host: string;
	/** Port if specified, else undefined. */
	port?: number;
}

export interface IpValidationResult {
	ok: boolean;
	/** Reason the host was rejected (only set when `ok` is false). */
	reason?: string;
}

/** Async DNS resolver shape (subset of `node:dns/promises`). */
export type DnsResolver = (hostname: string) => Promise<string[]>;

/**
 * Parse a `host[:port]` allowlist entry (Deno `--allow-net` syntax).
 * Bracketed IPv6 (`[::1]:443`) and bare IPv6 (`::1`) are both handled.
 */
export function parseHostEntry(entry: string): ParsedHost {
	const trimmed = entry.trim();

	// Bracketed IPv6 form: [::1] or [::1]:443
	if (trimmed.startsWith("[")) {
		const close = trimmed.indexOf("]");
		if (close === -1) return { host: trimmed };
		const host = trimmed.slice(1, close);
		const rest = trimmed.slice(close + 1);
		if (rest.startsWith(":")) {
			const port = Number(rest.slice(1));
			return Number.isInteger(port) ? { host, port } : { host };
		}
		return { host };
	}

	// Bare IPv6 (contains multiple colons, no brackets) → no port parsing.
	if ((trimmed.match(/:/g)?.length ?? 0) > 1) {
		return { host: trimmed };
	}

	// IPv4 or hostname, optionally host:port.
	const lastColon = trimmed.lastIndexOf(":");
	if (lastColon !== -1) {
		const maybePort = Number(trimmed.slice(lastColon + 1));
		if (Number.isInteger(maybePort)) {
			return { host: trimmed.slice(0, lastColon), port: maybePort };
		}
	}
	return { host: trimmed };
}

/** True if `s` is a syntactically-valid dotted-quad IPv4 literal. */
function isIpv4Literal(s: string): boolean {
	const parts = s.split(".");
	if (parts.length !== 4) return false;
	return parts.every((p) => {
		if (!/^\d{1,3}$/.test(p)) return false;
		const n = Number(p);
		return n >= 0 && n <= 255;
	});
}

/** True if `s` looks like an IPv6 literal (contains a colon, hex/`:`/`.` only). */
function isIpv6Literal(s: string): boolean {
	if (!s.includes(":")) return false;
	// Allow hex digits, colons, and an embedded IPv4 tail (e.g. ::ffff:127.0.0.1).
	return /^[0-9a-fA-F:.]+$/.test(s);
}

/**
 * Classify an IPv4 literal as private/link-local/loopback/metadata/CGNAT.
 * Ranges (all per the task + cloud-metadata convention):
 *   0.0.0.0/8 (this-host), 127/8 (loopback), 10/8, 172.16/12, 192.168/16 (RFC-1918),
 *   169.254/16 (link-local, incl. 169.254.169.254 metadata), 100.64/10 (CGNAT/RFC-6598).
 */
function isPrivateIpv4(ip: string): boolean {
	const [a, b] = ip.split(".").map(Number);
	if (a === 0) return true; // 0.0.0.0/8 "this host"
	if (a === 127) return true; // loopback
	if (a === 10) return true; // RFC-1918
	if (a === 172 && b >= 16 && b <= 31) return true; // RFC-1918
	if (a === 192 && b === 168) return true; // RFC-1918
	if (a === 169 && b === 254) return true; // link-local + AWS/GCP/Azure metadata
	if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT (RFC-6598)
	return false;
}

/** Normalize an IPv6 literal to lowercase, stripping a `%zone` suffix. */
function normalizeIpv6(ip: string): string {
	const pct = ip.indexOf("%");
	return (pct === -1 ? ip : ip.slice(0, pct)).toLowerCase();
}

/**
 * Classify an IPv6 literal as private/link-local/loopback/metadata.
 * Covers: ::1 (loopback), :: (unspecified), fc00::/7 (unique-local),
 * fe80::/10 (link-local), and IPv4-mapped/translated forms (::ffff:a.b.c.d,
 * ::a.b.c.d) by delegating their embedded IPv4 to `isPrivateIpv4`.
 */
function isPrivateIpv6(raw: string): boolean {
	const ip = normalizeIpv6(raw);
	if (ip === "::1") return true; // loopback
	if (ip === "::" || ip === "") return true; // unspecified

	// IPv4-mapped / -compatible: pull out the trailing dotted-quad and reuse v4 logic.
	const v4Tail = ip.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
	if (v4Tail && isIpv4Literal(v4Tail[1])) {
		// Bare "::a.b.c.d" / "::ffff:a.b.c.d" wrap a v4 address — classify by it.
		if (ip.startsWith("::")) return isPrivateIpv4(v4Tail[1]);
	}

	// fc00::/7 unique-local (fc.. and fd..).
	if (/^f[cd][0-9a-f]{0,2}:/.test(ip) || ip.startsWith("fc") || ip.startsWith("fd")) {
		const first = ip.split(":")[0];
		if (first.length > 0) {
			const hi = Number.parseInt(first.padStart(4, "0").slice(0, 2), 16);
			if ((hi & 0xfe) === 0xfc) return true; // 1111 110x
		}
	}

	// fe80::/10 link-local.
	if (ip.startsWith("fe8") || ip.startsWith("fe9") || ip.startsWith("fea") || ip.startsWith("feb")) {
		return true;
	}

	return false;
}

/**
 * Classify a bare IP literal (v4 or v6) as a blocked egress target.
 * Returns `{ ok:false, reason }` when the IP is private/link-local/loopback/metadata.
 */
export function classifyIpLiteral(ip: string): IpValidationResult {
	if (isIpv4Literal(ip)) {
		return isPrivateIpv4(ip)
			? { ok: false, reason: `private/link-local/loopback IPv4: ${ip}` }
			: { ok: true };
	}
	if (isIpv6Literal(ip)) {
		return isPrivateIpv6(ip)
			? { ok: false, reason: `private/link-local/loopback IPv6: ${ip}` }
			: { ok: true };
	}
	// Not an IP literal — caller must DNS-resolve and re-check.
	return { ok: true };
}

/** Bound each DNS lookup so a slow/hanging resolver can't stall validation. */
const DNS_TIMEOUT_MS = 3_000;

function withDnsTimeout<T>(p: Promise<T>): Promise<T> {
	return Promise.race([
		p,
		new Promise<T>((_, reject) =>
			setTimeout(() => reject(new Error(`DNS lookup timed out (${DNS_TIMEOUT_MS}ms)`)), DNS_TIMEOUT_MS),
		),
	]);
}

/** Lazily load `node:dns/promises` `resolve` (works on both Bun and Deno). */
let cachedResolver: DnsResolver | undefined;
async function defaultResolver(hostname: string): Promise<string[]> {
	if (!cachedResolver) {
		// Dynamic import so the module loads in environments without node:dns at parse time.
		const dns = await import("node:dns/promises");
		cachedResolver = async (h: string) => {
			const [v4, v6] = await Promise.allSettled([
				withDnsTimeout(dns.resolve4(h)),
				withDnsTimeout(dns.resolve6(h)),
			]);
			const out: string[] = [];
			if (v4.status === "fulfilled") out.push(...v4.value);
			if (v6.status === "fulfilled") out.push(...v6.value);
			// If BOTH lookups failed (incl. timeout), surface an error so the caller
			// fails CLOSED (rejects the host) rather than treating it as "no private
			// addresses found" → allowed.
			if (out.length === 0 && v4.status === "rejected" && v6.status === "rejected") {
				throw new Error(
					`DNS resolution failed (v4: ${reasonOf(v4)}, v6: ${reasonOf(v6)})`,
				);
			}
			return out;
		};
	}
	return cachedResolver(hostname);
}

function reasonOf(settled: PromiseRejectedResult): string {
	const r = settled.reason;
	return r instanceof Error ? r.message : String(r);
}

/**
 * Validate a single `host[:port]` allowlist entry against the private-IP policy.
 *
 * - IP literals are classified directly (no DNS).
 * - Hostnames are DNS-resolved; if ANY resolved address is private/link-local/
 *   loopback/metadata, the host is REJECTED (DNS-rebind defense at manifest time).
 * - `localhost` and the `.local` mDNS suffix are rejected up-front.
 *
 * `resolve` is injectable for tests / Deno; defaults to `node:dns/promises`.
 */
export async function validateHostEgress(
	entry: string,
	opts: { resolve?: DnsResolver } = {},
): Promise<IpValidationResult> {
	const { host } = parseHostEntry(entry);
	const lower = host.toLowerCase();

	if (lower.length === 0) {
		return { ok: false, reason: "empty host" };
	}
	// Obvious loopback / mDNS names — never resolve these out.
	if (lower === "localhost" || lower.endsWith(".localhost") || lower.endsWith(".local")) {
		return { ok: false, reason: `loopback/mDNS hostname not allowed: ${host}` };
	}

	// Direct IP literal → classify without DNS.
	const literal = classifyIpLiteral(host);
	if (!literal.ok) return literal;
	if (isIpv4Literal(host) || isIpv6Literal(host)) {
		return { ok: true }; // a public IP literal is fine
	}

	// Hostname → resolve and reject if any address is private.
	const resolver = opts.resolve ?? defaultResolver;
	let addrs: string[];
	try {
		addrs = await resolver(host);
	} catch (err) {
		return {
			ok: false,
			reason: `DNS resolution failed for ${host}: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
	if (addrs.length === 0) {
		return { ok: false, reason: `DNS resolution returned no addresses for ${host}` };
	}
	for (const addr of addrs) {
		const c = classifyIpLiteral(addr);
		if (!c.ok) {
			return {
				ok: false,
				reason: `${host} resolves to a blocked address (${c.reason})`,
			};
		}
	}
	return { ok: true };
}

/**
 * Validate ALL `net` + `import` hosts in a capability set.
 * Returns the first rejection found, or `{ ok:true }` if every host passes.
 */
export async function validateEgressHosts(
	hosts: readonly string[],
	opts: { resolve?: DnsResolver } = {},
): Promise<IpValidationResult> {
	for (const entry of hosts) {
		const r = await validateHostEgress(entry, opts);
		if (!r.ok) return { ok: false, reason: `host "${entry}": ${r.reason}` };
	}
	return { ok: true };
}

/** A resolved, validated PUBLIC egress endpoint (IP + optional port). */
export interface ResolvedEndpoint {
	/** Public IP literal (v4 or v6) the host resolved to / is. */
	ip: string;
	/** Port from the `host[:port]` entry, if any. */
	port?: number;
}

/**
 * Resolve a `host[:port]` allowlist to the concrete PUBLIC IPs it points at, for
 * the defense-in-depth kernel firewall (`egress-firewall.ts`) which can only
 * match IPs — never hostnames. This is the resolution half of `validateHostEgress`:
 * IP literals pass through; hostnames are DNS-resolved; any PRIVATE/metadata
 * address is SKIPPED (the request-time validator has already rejected such hosts,
 * so a private result here is a rebind/inconsistency and must NOT become an
 * `accept` rule). The drop rules cover the private space regardless.
 *
 * Best-effort + fail-OPEN-on-resolution-error by design: a host that fails to
 * resolve simply yields no `accept` rule (the guest can't reach it → still safe);
 * this never throws so it cannot break the spawn path. The SECURITY guarantee is
 * carried by the DROP rules + the default-deny policy, not by this function.
 */
export async function resolveAllowedEndpoints(
	hosts: readonly string[],
	opts: { resolve?: DnsResolver } = {},
): Promise<ResolvedEndpoint[]> {
	const out: ResolvedEndpoint[] = [];
	const seen = new Set<string>();
	const push = (ip: string, port?: number) => {
		const key = `${ip}|${port ?? ""}`;
		if (seen.has(key)) return;
		seen.add(key);
		out.push(port === undefined ? { ip } : { ip, port });
	};
	const resolver = opts.resolve ?? defaultResolver;

	for (const entry of hosts) {
		const { host, port } = parseHostEntry(entry);
		const lower = host.toLowerCase();
		if (lower.length === 0 || lower === "localhost" || lower.endsWith(".localhost") || lower.endsWith(".local")) {
			continue;
		}
		// IP literal → accept only if it classifies as PUBLIC.
		if (isIpv4Literal(host) || isIpv6Literal(host)) {
			if (classifyIpLiteral(host).ok) push(host, port);
			continue;
		}
		// Hostname → resolve; pin each PUBLIC address.
		let addrs: string[];
		try {
			addrs = await resolver(host);
		} catch {
			continue; // unresolvable → no accept rule (guest can't reach it anyway)
		}
		for (const addr of addrs) {
			if (classifyIpLiteral(addr).ok) push(addr, port);
		}
	}
	return out;
}
