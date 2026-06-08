/**
 * SSRF / DNS-rebind IP classification — the TRUSTED-HOST half of the brokered
 * `http.fetch` egress defense (`host-fetch.ts`).
 *
 * This is the SAME private/link-local/loopback/metadata/CGNAT range policy as
 * the sandbox's manifest-time `packages/sandbox/src/net-validation.ts`
 * (`classifyIpLiteral` + `parseHostEntry`), kept here because the broker lives in
 * `questpie` and CANNOT import the sandbox package without inverting the
 * `@questpie/sandbox → questpie` dependency edge (it would be circular). The two
 * are unified into one module by the `v2-ws-1b-consolidate-executor-into-sandbox`
 * task; until then this is the canonical copy for the trusted-host connect-pin
 * path and MUST stay range-for-range identical to the sandbox copy.
 *
 * The manifest-time validator (sandbox) rejects hosts that RESOLVE to a private
 * IP at request time. That is necessary but NOT sufficient: DNS can rebind
 * between validation and connect. The broker closes that window by resolving,
 * classifying EVERY resolved IP with {@link classifyIpLiteral} here, and PINNING
 * the socket to a validated IP literal — so this module is the IP-classification
 * primitive the pin relies on.
 *
 * Runtime-agnostic: no IO, no DNS. Pure string → classification.
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

/**
 * Normalize a DNS-resolved or guest-supplied IPv4 string to canonical
 * dotted-decimal, REJECTING the non-decimal encodings an attacker uses to slip a
 * private address past a naive string check: octal (`0177.0.0.1`), hex
 * (`0x7f.0.0.1` / `0x7f000001`), and bare decimal (`2130706433`). Anything that
 * is not an unambiguous, in-range dotted-decimal quad → `null` (caller treats a
 * `null` as "not a plain IPv4 literal" and, for a resolved address, fails closed).
 *
 * NOTE: production DNS resolvers return canonical dotted-decimal already, so this
 * mainly hardens the case where a caller hands us a raw/guest-influenced literal.
 */
function canonicalizeIpv4(s: string): string | null {
	const trimmed = s.trim();

	// Bare 32-bit decimal/hex (no dots), e.g. 2130706433 or 0x7f000001.
	if (!trimmed.includes(".")) {
		let n: number | null = null;
		if (/^0x[0-9a-fA-F]+$/.test(trimmed)) {
			n = Number.parseInt(trimmed.slice(2), 16);
		} else if (/^\d+$/.test(trimmed)) {
			// Reject octal-looking leading zero ambiguity by parsing base-10 only.
			n = Number.parseInt(trimmed, 10);
		}
		if (n === null || !Number.isInteger(n) || n < 0 || n > 0xffffffff) {
			return null;
		}
		return [
			(n >>> 24) & 0xff,
			(n >>> 16) & 0xff,
			(n >>> 8) & 0xff,
			n & 0xff,
		].join(".");
	}

	const parts = trimmed.split(".");
	if (parts.length !== 4) return null;
	const out: number[] = [];
	for (const p of parts) {
		let n: number;
		if (/^0x[0-9a-fA-F]+$/.test(p)) {
			n = Number.parseInt(p.slice(2), 16); // hex octet
		} else if (/^0[0-7]+$/.test(p)) {
			n = Number.parseInt(p, 8); // octal octet
		} else if (/^\d+$/.test(p)) {
			n = Number.parseInt(p, 10); // decimal octet
		} else {
			return null;
		}
		if (!Number.isInteger(n) || n < 0 || n > 255) return null;
		out.push(n);
	}
	return out.join(".");
}

/** True if `s` is a syntactically-valid (any-base) IPv4 literal. */
function isIpv4Literal(s: string): boolean {
	return canonicalizeIpv4(s) !== null;
}

/** True if `s` looks like an IPv6 literal (contains a colon, hex/`:`/`.` only). */
function isIpv6Literal(s: string): boolean {
	if (!s.includes(":")) return false;
	// Allow hex digits, colons, and an embedded IPv4 tail (e.g. ::ffff:127.0.0.1).
	return /^[0-9a-fA-F:.]+$/.test(s);
}

/**
 * Classify a CANONICAL dotted-decimal IPv4 as private/link-local/loopback/
 * metadata/CGNAT. Ranges:
 *   0.0.0.0/8 (this-host), 127/8 (loopback), 10/8, 172.16/12, 192.168/16 (RFC-1918),
 *   169.254/16 (link-local, incl. 169.254.169.254 metadata), 100.64/10 (CGNAT/RFC-6598).
 */
function isPrivateIpv4Canonical(ip: string): boolean {
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
 * Covers: ::1 (loopback), :: (unspecified), fc00::/7 (unique-local, incl. the
 * `fd00:ec2::254` GCP/AWS-style metadata convention), fe80::/10 (link-local),
 * and IPv4-mapped/translated forms (::ffff:a.b.c.d, ::a.b.c.d) by delegating
 * their embedded IPv4 to the v4 classifier.
 */
function isPrivateIpv6(raw: string): boolean {
	const ip = normalizeIpv6(raw);
	if (ip === "::1") return true; // loopback
	if (ip === "::" || ip === "") return true; // unspecified

	// IPv4-mapped / -compatible: pull out the trailing dotted-quad and reuse v4 logic.
	const v4Tail = ip.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
	if (v4Tail) {
		const canon = canonicalizeIpv4(v4Tail[1]);
		// Bare "::a.b.c.d" / "::ffff:a.b.c.d" wrap a v4 address — classify by it.
		if (canon && ip.startsWith("::")) return isPrivateIpv4Canonical(canon);
	}

	// IPv4-mapped with a HEX-COMPRESSED tail. Bun's `URL.hostname` normalizes
	// `::ffff:127.0.0.1` → `::ffff:7f00:1` (and `::ffff:169.254.169.254` →
	// `::ffff:a9fe:a9fe`), so the dotted match above misses loopback/metadata
	// smuggled as a mapped literal. Rebuild the 32-bit v4 from the two embedded
	// hextets and classify it (each derived octet is already in 0-255).
	const mapped = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
	if (mapped) {
		const hi = Number.parseInt(mapped[1], 16) & 0xffff;
		const lo = Number.parseInt(mapped[2], 16) & 0xffff;
		return isPrivateIpv4Canonical(
			`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`,
		);
	}

	// fc00::/7 unique-local (fc.. and fd..).
	if (
		/^f[cd][0-9a-f]{0,2}:/.test(ip) ||
		ip.startsWith("fc") ||
		ip.startsWith("fd")
	) {
		const first = ip.split(":")[0];
		if (first.length > 0) {
			const hi = Number.parseInt(first.padStart(4, "0").slice(0, 2), 16);
			if ((hi & 0xfe) === 0xfc) return true; // 1111 110x
		}
	}

	// fe80::/10 link-local.
	if (
		ip.startsWith("fe8") ||
		ip.startsWith("fe9") ||
		ip.startsWith("fea") ||
		ip.startsWith("feb")
	) {
		return true;
	}

	return false;
}

/**
 * Classify a bare IP literal (v4 or v6) as a blocked egress target.
 * Returns `{ ok:false, reason }` when the IP is private/link-local/loopback/
 * metadata/CGNAT, including the non-decimal IPv4 encodings (octal/hex/decimal)
 * and IPv4-mapped IPv6. A value that is not an IP literal at all → `{ ok:true }`
 * (the caller must DNS-resolve and re-check); a MALFORMED-but-IP-shaped value
 * fails closed.
 */
export function classifyIpLiteral(ip: string): IpValidationResult {
	if (isIpv4Literal(ip)) {
		const canon = canonicalizeIpv4(ip);
		if (canon === null) {
			return { ok: false, reason: `unparseable IPv4 literal: ${ip}` };
		}
		return isPrivateIpv4Canonical(canon)
			? {
					ok: false,
					reason: `private/link-local/loopback IPv4: ${ip} (${canon})`,
				}
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
