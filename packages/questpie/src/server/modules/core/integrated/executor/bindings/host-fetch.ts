/**
 * SSRF-safe brokered HTTP fetch — the TRUSTED-HOST side of `http.fetch`.
 *
 * The untrusted guest has NO direct network (`--allow-net=[]`); it relays an
 * `http.fetch` RPC to the broker, which calls THIS. Because the guest can't
 * connect to anything, the only SSRF surface is here — and here we close the
 * DNS-rebinding / TOCTOU window that a naive `fetch(url)` leaves open.
 *
 * THE PIN (why a plain `fetch` is NOT enough): the capability check already
 * verified the URL's host is in the run's `net` allowlist, but an allowlisted
 * hostname can resolve to a PUBLIC ip when validated and then re-resolve to
 * `127.0.0.1` / `169.254.169.254` at connect time. A `fetch(url)` (or any client
 * that re-resolves DNS internally) would connect to whatever DNS returns at
 * connect — still rebind-vulnerable. So we:
 *   1. RESOLVE the host ourselves (ALL A + AAAA records).
 *   2. VALIDATE every resolved IP with {@link classifyIpLiteral} — reject if ANY
 *      is private/link-local/loopback/metadata/CGNAT (a multi-record host with
 *      one bad IP is rejected wholesale).
 *   3. PIN the socket to a validated IP LITERAL (`options.host = ip`) while
 *      keeping the original hostname for TLS SNI (`servername`) and the `Host`
 *      header — so no DNS resolution happens at connect (the target is already an
 *      IP), and certificate validation still works (the bare-IP-SNI problem that
 *      blocks pinning IN the guest does not exist on the trusted host).
 *   4. RE-VALIDATE EVERY REDIRECT HOP: auto-follow is disabled; a 3xx `Location`
 *      is re-parsed, re-resolved, re-validated, and re-pinned. A redirect to an
 *      internal target is therefore blocked even mid-chain.
 *
 * Bodies are BUFFERED (the relay is line-framed JSON), base64-encoded, and capped
 * HOST-SIDE with a running byte counter (the `Content-Length` header is NOT
 * trusted). NEVER throws — every failure is a structured {@link BindingError}.
 */

import { Buffer } from "node:buffer";
import { request as httpRequest } from "node:http";
import type { IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";

import {
	classifyIpLiteral,
	type IpValidationResult,
} from "./net-validation.js";
import type { BindingError } from "./protocol.js";
import {
	HTTP_FETCH_BODY_CAP_BYTES,
	type HttpFetchRequest,
	type HttpFetchResponse,
} from "./protocol.js";

/** Async DNS resolver shape (subset of `node:dns/promises`). Injectable for tests. */
export type DnsResolver = (hostname: string) => Promise<string[]>;

/**
 * Per-IP egress validator. DEFAULTS to {@link classifyIpLiteral} (the real
 * private/metadata/loopback/CGNAT policy). Injectable ONLY so tests can drive the
 * positive/redirect/body-cap paths against a loopback origin — production NEVER
 * overrides it (the broker passes no validator, so the real policy always runs).
 */
export type IpValidator = (ip: string) => IpValidationResult;

/** Outcome of a host fetch: the buffered response value, or a structured error. */
export type HostFetchResult =
	| { ok: true; value: HttpFetchResponse }
	| { ok: false; error: BindingError };

/** Tuning + injection points for {@link hostFetch}. */
export interface HostFetchOptions {
	/**
	 * DNS resolver returning ALL A/AAAA records for a hostname. Injectable so the
	 * rebind/multi-record tests can drive resolution deterministically. Defaults to
	 * `node:dns/promises` (resolve4 + resolve6, both settled).
	 */
	resolve?: DnsResolver;
	/**
	 * Per-IP validator. Defaults to {@link classifyIpLiteral}. TEST-ONLY override
	 * (to allow a loopback origin); production leaves it unset so the real SSRF
	 * policy validates every resolved/pinned IP.
	 */
	validateIp?: IpValidator;
	/** Max redirect hops to follow (each re-validated). Default 5. */
	maxRedirects?: number;
	/**
	 * Overall deadline (ms) for the WHOLE exchange incl. all redirects + the
	 * buffered body read. Must stay under the broker-call budget (10s). Default 9s.
	 */
	timeoutMs?: number;
	/** Decoded body cap (bytes). Default {@link HTTP_FETCH_BODY_CAP_BYTES}. */
	maxBodyBytes?: number;
}

function err(code: BindingError["code"], message: string): HostFetchResult {
	return { ok: false, error: { code, message } };
}

const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT_MS = 9_000;
const DNS_TIMEOUT_MS = 3_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
	return Promise.race([
		p,
		new Promise<T>((_, reject) =>
			setTimeout(() => reject(new Error(`${label} timed out (${ms}ms)`)), ms),
		),
	]);
}

/** Lazily load `node:dns/promises` resolve4+resolve6 (works on Bun + Node). */
let cachedResolver: DnsResolver | undefined;
async function defaultResolver(hostname: string): Promise<string[]> {
	if (!cachedResolver) {
		const dns = await import("node:dns/promises");
		cachedResolver = async (h: string) => {
			const [v4, v6] = await Promise.allSettled([
				withTimeout(dns.resolve4(h), DNS_TIMEOUT_MS, "DNS A lookup"),
				withTimeout(dns.resolve6(h), DNS_TIMEOUT_MS, "DNS AAAA lookup"),
			]);
			const out: string[] = [];
			if (v4.status === "fulfilled") out.push(...v4.value);
			if (v6.status === "fulfilled") out.push(...v6.value);
			// Both failed → throw so the caller fails CLOSED (rejects the host) rather
			// than treating "no addresses" as "no private addresses found" → allowed.
			if (
				out.length === 0 &&
				v4.status === "rejected" &&
				v6.status === "rejected"
			) {
				throw new Error("DNS resolution failed (no A/AAAA records)");
			}
			return out;
		};
	}
	return cachedResolver(hostname);
}

/**
 * Resolve `host` and return a SINGLE validated IP to pin to — or a rejection if
 * the host is an IP literal that is private, OR resolves to ZERO addresses, OR
 * resolves to ANY private/blocked address (whole-host reject on one bad record).
 * The pinned IP is the FIRST resolved address (all are validated regardless).
 */
async function resolveAndValidate(
	host: string,
	resolve: DnsResolver,
	validateIp: IpValidator,
): Promise<{ ip: string; family: 4 | 6 } | { error: BindingError }> {
	// Direct IP literal → classify without DNS (covers octal/hex/decimal v4,
	// IPv4-mapped v6, etc. via the validator).
	const literal = validateIp(host);
	if (!literal.ok) {
		return {
			error: {
				code: "execution_error",
				message: `blocked target: ${literal.reason}`,
			},
		};
	}
	if (isIpLiteralShape(host)) {
		return { ip: stripBrackets(host), family: host.includes(":") ? 6 : 4 };
	}

	let addrs: string[];
	try {
		addrs = await resolve(host);
	} catch (e) {
		return {
			error: {
				code: "execution_error",
				message: `DNS resolution failed for ${host}: ${e instanceof Error ? e.message : String(e)}`,
			},
		};
	}
	if (!Array.isArray(addrs) || addrs.length === 0) {
		return {
			error: {
				code: "execution_error",
				message: `DNS returned no addresses for ${host}`,
			},
		};
	}
	// Validate EVERY resolved address — one private record rejects the whole host
	// (this is the multi-record rebind defense).
	for (const addr of addrs) {
		const c = validateIp(addr);
		if (!c.ok) {
			return {
				error: {
					code: "execution_error",
					message: `${host} resolves to a blocked address (${c.reason})`,
				},
			};
		}
	}
	const ip = stripBrackets(addrs[0]);
	return { ip, family: ip.includes(":") ? 6 : 4 };
}

/** True if `s` is shaped like an IP literal (so it needs no DNS resolution). */
function isIpLiteralShape(s: string): boolean {
	const bare = stripBrackets(s);
	if (bare.includes(":")) return /^[0-9a-fA-F:.]+$/.test(bare); // IPv6
	// IPv4 dotted (any base) — a single label of digits/dots/0x.
	return /^[0-9.xXa-fA-F]+$/.test(bare) && bare.includes(".");
}

function stripBrackets(s: string): string {
	return s.startsWith("[") && s.endsWith("]") ? s.slice(1, -1) : s;
}

/**
 * Perform ONE pinned request hop. Resolves the host, validates all IPs, pins the
 * socket to a validated IP (SNI/Host preserved), sends the request body, and
 * buffers the response with the byte cap. Returns either the buffered response,
 * a redirect instruction, or a structured error. NEVER throws.
 */
async function fetchHop(
	url: URL,
	method: string,
	headers: Record<string, string>,
	body: Buffer | undefined,
	resolve: DnsResolver,
	validateIp: IpValidator,
	deadline: number,
	maxBodyBytes: number,
	signal: AbortSignal,
): Promise<
	| { kind: "response"; value: HttpFetchResponse }
	| { kind: "redirect"; location: string; status: number }
	| { kind: "error"; error: BindingError }
> {
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		return {
			kind: "error",
			error: {
				code: "execution_error",
				message: `unsupported scheme ${url.protocol}`,
			},
		};
	}

	const pinned = await resolveAndValidate(url.hostname, resolve, validateIp);
	if ("error" in pinned) return { kind: "error", error: pinned.error };

	const isHttps = url.protocol === "https:";
	const requestFn = isHttps ? httpsRequest : httpRequest;
	const port = url.port ? Number(url.port) : isHttps ? 443 : 80;

	// Build per-hop headers: force a correct Host (vhost) and drop hop-by-hop /
	// guest-supplied Host so the guest can't desync the routed host from the
	// validated one.
	const outHeaders: Record<string, string> = {};
	for (const [k, v] of Object.entries(headers)) {
		if (k.toLowerCase() === "host") continue;
		outHeaders[k] = v;
	}
	outHeaders.host = url.host; // hostname[:port]
	if (body) outHeaders["content-length"] = String(body.length);

	const timeLeft = deadline - Date.now();
	if (timeLeft <= 0) {
		return {
			kind: "error",
			error: {
				code: "execution_error",
				message: "http.fetch deadline exceeded",
			},
		};
	}

	return new Promise((resolveHop) => {
		let settled = false;
		const done = (
			r:
				| { kind: "response"; value: HttpFetchResponse }
				| { kind: "redirect"; location: string; status: number }
				| { kind: "error"; error: BindingError },
		) => {
			if (settled) return;
			settled = true;
			resolveHop(r);
		};

		const req = requestFn(
			{
				host: pinned.ip, // PINNED validated IP literal — no connect-time DNS.
				port,
				method,
				path: `${url.pathname}${url.search}`,
				headers: outHeaders,
				// SNI = real hostname (fixes bare-IP TLS); only meaningful for https.
				servername: isHttps ? url.hostname : undefined,
				// Belt-and-suspenders: if any layer re-derives an address from this
				// hostname, hand back ONLY the already-validated pinned IP.
				lookup: ((_hostname: string, _opts: unknown, cb: LookupCallback) => {
					// Both callback shapes (Bun wants the array form; Node the 3-arg form).
					try {
						(
							cb as (
								e: null,
								addr: Array<{ address: string; family: number }>,
							) => void
						)(null, [{ address: pinned.ip, family: pinned.family }]);
					} catch {
						(cb as (e: null, addr: string, fam: number) => void)(
							null,
							pinned.ip,
							pinned.family,
						);
					}
				}) as never,
				signal,
			},
			(res: IncomingMessage) => {
				const status = res.statusCode ?? 0;

				// Redirect: do NOT auto-follow — surface the Location to the caller for
				// re-validation. Drain+destroy the body we won't read.
				if (status >= 300 && status < 400 && res.headers.location) {
					res.resume();
					done({
						kind: "redirect",
						location: String(res.headers.location),
						status,
					});
					return;
				}

				const chunks: Buffer[] = [];
				let received = 0;
				let truncated = false;
				res.on("data", (chunk: Buffer) => {
					if (truncated) return;
					received += chunk.length;
					if (received > maxBodyBytes) {
						// Overflow — reject (a truncated body silently corrupts the guest's
						// Response). Abort the upstream read.
						truncated = true;
						res.destroy();
						done({
							kind: "error",
							error: {
								code: "execution_error",
								message: `response body exceeds ${maxBodyBytes}-byte cap`,
							},
						});
						return;
					}
					chunks.push(chunk);
				});
				res.on("end", () => {
					if (truncated) return;
					done({
						kind: "response",
						value: {
							status,
							statusText: res.statusMessage ?? "",
							headers: flattenHeaders(res.headers),
							bodyBase64: Buffer.concat(chunks).toString("base64"),
							truncated: false,
						},
					});
				});
				res.on("error", (e: Error) => {
					done({
						kind: "error",
						error: {
							code: "execution_error",
							message: `response stream error: ${e.message}`,
						},
					});
				});
			},
		);

		req.on("error", (e: Error) => {
			done({
				kind: "error",
				error: {
					code: "execution_error",
					message: `request error: ${e.message}`,
				},
			});
		});
		// Per-hop socket timeout bounded by the overall deadline.
		req.setTimeout(Math.max(1, deadline - Date.now()), () => {
			req.destroy(new Error("socket timeout"));
		});

		if (body) req.write(body);
		req.end();
	});
}

/** Node's `lookup` callback (either the 3-arg or the array form). */
type LookupCallback = (...args: unknown[]) => void;

/** Flatten Node's header bag to `Record<string,string>`: lowercased, joined. */
function flattenHeaders(h: IncomingMessage["headers"]): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(h)) {
		if (v === undefined) continue;
		const key = k.toLowerCase();
		out[key] = Array.isArray(v) ? v.join(", ") : String(v);
	}
	return out;
}

/**
 * SSRF-safe brokered fetch. Validates + pins every hop, follows (and
 * re-validates) redirects manually, buffers the response under the byte cap, and
 * returns the {@link HttpFetchResponse} contract or a structured
 * {@link BindingError}. NEVER throws.
 */
export async function hostFetch(
	req: HttpFetchRequest,
	opts: HostFetchOptions = {},
): Promise<HostFetchResult> {
	const resolve = opts.resolve ?? defaultResolver;
	const validateIp = opts.validateIp ?? classifyIpLiteral;
	const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
	const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const maxBodyBytes = opts.maxBodyBytes ?? HTTP_FETCH_BODY_CAP_BYTES;

	// Validate request shape.
	if (!req || typeof req.url !== "string" || req.url.length === 0) {
		return err("bad_args", "http.fetch requires a string `url`");
	}
	let url: URL;
	try {
		url = new URL(req.url);
	} catch {
		return err(
			"bad_args",
			`http.fetch url is not a valid URL: ${String(req.url)}`,
		);
	}
	const method = (req.method ?? "GET").toUpperCase();

	let body: Buffer | undefined;
	if (req.bodyBase64 !== undefined && req.bodyBase64 !== "") {
		if (typeof req.bodyBase64 !== "string") {
			return err("bad_args", "http.fetch bodyBase64 must be a base64 string");
		}
		body = Buffer.from(req.bodyBase64, "base64");
		// Cap the REQUEST body too (reject oversized guest uploads before fetching).
		if (body.length > maxBodyBytes) {
			return err(
				"bad_args",
				`http.fetch request body exceeds ${maxBodyBytes}-byte cap`,
			);
		}
	}

	const headers = sanitizeRequestHeaders(req.headers);
	const controller = new AbortController();
	const deadline = Date.now() + timeoutMs;
	const wallTimer = setTimeout(() => controller.abort(), timeoutMs);

	try {
		let current = url;
		let currentMethod = method;
		let currentBody = body;
		for (let hop = 0; hop <= maxRedirects; hop++) {
			const r = await fetchHop(
				current,
				currentMethod,
				headers,
				currentBody,
				resolve,
				validateIp,
				deadline,
				maxBodyBytes,
				controller.signal,
			);
			if (r.kind === "response") return { ok: true, value: r.value };
			if (r.kind === "error") return { ok: false, error: r.error };

			// Redirect — resolve the (possibly relative) Location against the current
			// URL, then loop so the NEXT hop re-resolves + re-validates + re-pins it.
			let next: URL;
			try {
				next = new URL(r.location, current);
			} catch {
				return err(
					"execution_error",
					`invalid redirect Location: ${r.location}`,
				);
			}
			if (next.protocol !== "http:" && next.protocol !== "https:") {
				return err(
					"execution_error",
					`redirect to unsupported scheme ${next.protocol}`,
				);
			}
			// 303 → GET; 301/302 historically downgrade non-GET/HEAD to GET; keep body
			// only for 307/308. Drop the body otherwise (and re-validate the new host).
			if (
				r.status === 303 ||
				((r.status === 301 || r.status === 302) &&
					currentMethod !== "GET" &&
					currentMethod !== "HEAD")
			) {
				currentMethod = "GET";
				currentBody = undefined;
			}
			current = next;
		}
		return err("execution_error", `too many redirects (> ${maxRedirects})`);
	} catch (e) {
		// Defensive: hostFetch must never throw.
		return err("execution_error", e instanceof Error ? e.message : String(e));
	} finally {
		clearTimeout(wallTimer);
	}
}

/**
 * Drop hop-by-hop / dangerous request headers the guest must not control. `host`
 * is forced per-hop to the validated URL host; `content-length` is recomputed.
 */
function sanitizeRequestHeaders(
	headers: Record<string, string> | undefined,
): Record<string, string> {
	const out: Record<string, string> = {};
	if (!headers || typeof headers !== "object") return out;
	const banned = new Set([
		"host",
		"content-length",
		"connection",
		"transfer-encoding",
		"keep-alive",
		"upgrade",
		"proxy-authorization",
		"proxy-connection",
	]);
	for (const [k, v] of Object.entries(headers)) {
		if (typeof v !== "string") continue;
		if (banned.has(k.toLowerCase())) continue;
		out[k] = v;
	}
	return out;
}
