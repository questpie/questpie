import type {
	AnyChannelDefinition,
	ChannelDefinitions,
} from "./channel-builder.js";
import { resolveChannelName } from "./channel-builder.js";

const CHANNEL_NAME_PATTERN = /^[A-Za-z0-9_\-=@,.;]+$/;
const CHANNEL_MAX_LENGTH = 164;
export const CHANNEL_MAX_PAYLOAD_BYTES = 10_000;

export type ChannelSecurityConfig = Readonly<{
	/** Additional exact browser origins allowed to call authority-bearing routes. */
	trustedOrigins?: readonly string[];
	/** Authorization rule deadline. @default 5000 */
	authorizationTimeoutMs?: number;
	/** Refill rate for each session and principal publish bucket. @default 10 */
	publishRatePerSecond?: number;
	/** Maximum tokens in each publish bucket. @default 20 */
	publishBurst?: number;
}>;

export class ChannelSecurityError extends Error {
	constructor(
		readonly code:
			| "channel_origin_denied"
			| "channel_name_collision"
			| "channel_payload_too_large"
			| "channel_payload_invalid",
		message: string,
	) {
		super(message);
		this.name = "ChannelSecurityError";
	}
}

function exactOrigin(value: string, allowAppPath = false): string {
	if (value === "*" || value === "null") {
		throw new Error(`Invalid trusted channel origin "${value}"`);
	}
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error(`Invalid trusted channel origin "${value}"`);
	}
	if (url.username || url.password || url.origin === "null") {
		throw new Error(`Invalid trusted channel origin "${value}"`);
	}
	if (
		!allowAppPath &&
		(url.pathname !== "/" || url.search !== "" || url.hash !== "")
	) {
		throw new Error(`Trusted channel origins cannot contain a path`);
	}
	const localHttp =
		url.protocol === "http:" &&
		(url.hostname === "localhost" ||
			url.hostname === "127.0.0.1" ||
			url.hostname === "[::1]");
	if (url.protocol !== "https:" && !localHttp) {
		throw new Error(`Trusted channel origins must use HTTPS`);
	}
	return url.origin;
}

export type ChannelOriginOptions = Readonly<{
	appUrl: string;
	trustedOrigins?: readonly string[];
	/** Public GETs can validate a supplied origin without requiring one for cookies. */
	requireOriginForCookies?: boolean;
}>;

export function trustedChannelOrigins(
	options: ChannelOriginOptions,
): ReadonlySet<string> {
	return new Set([
		exactOrigin(options.appUrl, true),
		...(options.trustedOrigins ?? []).map((origin) => exactOrigin(origin)),
	]);
}

/** Validate CSRF origin policy and return the exact origin to reflect for CORS. */
export function resolveChannelRequestOrigin(
	request: Request,
	options: ChannelOriginOptions,
): string | null {
	const trusted = trustedChannelOrigins(options);
	const supplied = request.headers.get("origin");
	const cookieAuthenticated =
		(options.requireOriginForCookies ?? true) && request.headers.has("cookie");
	if (!supplied) {
		if (!cookieAuthenticated) return null;
		throw new ChannelSecurityError(
			"channel_origin_denied",
			"Cookie-authenticated channel requests require a trusted Origin",
		);
	}
	if (supplied === "null") {
		throw new ChannelSecurityError(
			"channel_origin_denied",
			"Channel requests require a trusted Origin",
		);
	}
	let parsed: URL;
	try {
		parsed = new URL(supplied);
	} catch {
		throw new ChannelSecurityError(
			"channel_origin_denied",
			"Channel requests require a trusted Origin",
		);
	}
	if (supplied !== parsed.origin || !trusted.has(parsed.origin)) {
		throw new ChannelSecurityError(
			"channel_origin_denied",
			"Channel requests require a trusted Origin",
		);
	}
	return parsed.origin;
}

export function channelCorsHeaders(
	origin: string | null,
	allowedHeaders = "Authorization, Content-Type, X-API-Key",
): Headers {
	const headers = new Headers({
		"Access-Control-Allow-Credentials": "true",
		"Access-Control-Allow-Headers": allowedHeaders,
		"Access-Control-Allow-Methods": "POST, OPTIONS",
		"Cache-Control": "no-store",
		Vary: "Origin",
	});
	if (origin) headers.set("Access-Control-Allow-Origin", origin);
	return headers;
}

type PatternToken =
	| { kind: "literal"; value: string }
	| { kind: "param"; value: string };

function patternTokens(pattern: string): PatternToken[] {
	const tokens: PatternToken[] = [];
	let cursor = 0;
	for (const match of pattern.matchAll(/\[([^\]]+)\]/g)) {
		const index = match.index ?? 0;
		if (index > cursor) {
			tokens.push({ kind: "literal", value: pattern.slice(cursor, index) });
		}
		tokens.push({ kind: "param", value: match[1] as string });
		cursor = index + match[0].length;
	}
	if (cursor < pattern.length) {
		tokens.push({ kind: "literal", value: pattern.slice(cursor) });
	}
	return tokens;
}

function visibilityPrefix(definition: AnyChannelDefinition): string {
	if (definition.visibility === "private") return "private-";
	if (definition.visibility === "presence") return "presence-";
	return "";
}

function matchingParams(
	definition: AnyChannelDefinition,
	resolvedName: string,
): Record<string, string>[] {
	const prefix = visibilityPrefix(definition);
	if (!resolvedName.startsWith(prefix)) return [];
	const applicationName = resolvedName.slice(prefix.length);
	const tokens = patternTokens(definition.pattern);
	const matches: Record<string, string>[] = [];
	const maxMatches = 2;

	function visit(
		tokenIndex: number,
		nameIndex: number,
		params: Record<string, string>,
	): void {
		if (matches.length >= maxMatches) return;
		if (tokenIndex === tokens.length) {
			if (nameIndex === applicationName.length) matches.push(params);
			return;
		}
		const token = tokens[tokenIndex] as PatternToken;
		if (token.kind === "literal") {
			if (applicationName.startsWith(token.value, nameIndex)) {
				visit(tokenIndex + 1, nameIndex + token.value.length, params);
			}
			return;
		}

		const next = tokens[tokenIndex + 1];
		const remainingParams = tokens
			.slice(tokenIndex + 1)
			.filter((candidate) => candidate.kind === "param").length;
		const latestEnd = applicationName.length - remainingParams;
		const possibleEnds: number[] = [];
		if (next?.kind === "literal") {
			let found = applicationName.indexOf(next.value, nameIndex + 1);
			while (found !== -1 && found <= latestEnd) {
				possibleEnds.push(found);
				found = applicationName.indexOf(next.value, found + 1);
			}
		} else {
			for (let end = nameIndex + 1; end <= latestEnd; end++) {
				possibleEnds.push(end);
			}
		}
		for (const end of possibleEnds) {
			const value = applicationName.slice(nameIndex, end);
			if (!CHANNEL_NAME_PATTERN.test(value)) continue;
			visit(tokenIndex + 1, end, { ...params, [token.value]: value });
		}
	}

	visit(0, 0, {});
	return matches;
}

/**
 * Render a client-claimed key/params pair, then prove it is the sole canonical
 * identity for that final provider name across the generated registry.
 */
export function assertUniqueResolvedChannelName(
	definitions: ChannelDefinitions,
	channel: string,
	params: Record<string, string>,
): string {
	const definition = definitions[channel];
	if (!definition) throw new Error(`Unknown channel "${channel}"`);
	const resolved = resolveChannelName(definition, params);
	if (
		resolved.length > CHANNEL_MAX_LENGTH ||
		!CHANNEL_NAME_PATTERN.test(resolved)
	) {
		throw new ChannelSecurityError(
			"channel_name_collision",
			"Resolved channel name is invalid",
		);
	}
	const candidates: Array<{ channel: string; params: Record<string, string> }> =
		[];
	for (const [candidateChannel, candidateDefinition] of Object.entries(
		definitions,
	)) {
		for (const candidateParams of matchingParams(
			candidateDefinition,
			resolved,
		)) {
			candidates.push({ channel: candidateChannel, params: candidateParams });
			if (candidates.length > 1) break;
		}
		if (candidates.length > 1) break;
	}
	const sole = candidates[0];
	const canonicalParams = Object.fromEntries(
		Object.entries(params).sort(([left], [right]) => left.localeCompare(right)),
	);
	const soleParams = sole
		? Object.fromEntries(
				Object.entries(sole.params).sort(([left], [right]) =>
					left.localeCompare(right),
				),
			)
		: null;
	if (
		candidates.length !== 1 ||
		sole?.channel !== channel ||
		JSON.stringify(soleParams) !== JSON.stringify(canonicalParams)
	) {
		throw new ChannelSecurityError(
			"channel_name_collision",
			"Resolved channel name collision",
		);
	}
	return resolved;
}

/**
 * Cheap necessary preflight before authorization/sequence allocation.
 * The ledger measures the larger canonical eventId/event/data envelope exactly.
 */
export function assertChannelPayloadSize(data: unknown): string {
	let serialized: string | undefined;
	try {
		serialized = JSON.stringify(data);
	} catch {
		throw new ChannelSecurityError(
			"channel_payload_invalid",
			"Channel event data must be JSON serializable",
		);
	}
	if (serialized === undefined) {
		throw new ChannelSecurityError(
			"channel_payload_invalid",
			"Channel event data must be JSON serializable",
		);
	}
	if (
		new TextEncoder().encode(serialized).byteLength > CHANNEL_MAX_PAYLOAD_BYTES
	) {
		throw new ChannelSecurityError(
			"channel_payload_too_large",
			"Channel event data exceeds the 10,000-byte limit",
		);
	}
	return serialized;
}

type Bucket = { tokens: number; updatedAt: number };

export class ChannelTokenBucketLimiter {
	private readonly buckets = new Map<string, Bucket>();
	private readonly ratePerMillisecond: number;

	constructor(
		private readonly options: {
			ratePerSecond: number;
			burst: number;
			now?: () => number;
		},
	) {
		this.ratePerMillisecond = options.ratePerSecond / 1000;
	}

	private bucket(key: string): Bucket {
		const now = (this.options.now ?? Date.now)();
		const current = this.buckets.get(key) ?? {
			tokens: this.options.burst,
			updatedAt: now,
		};
		current.tokens = Math.min(
			this.options.burst,
			current.tokens +
				Math.max(0, now - current.updatedAt) * this.ratePerMillisecond,
		);
		current.updatedAt = now;
		this.buckets.set(key, current);
		return current;
	}

	consume(key: string): boolean {
		return this.consumeAll([key]);
	}

	/** Atomically consume one token from every independent bucket. */
	consumeAll(keys: readonly string[]): boolean {
		const buckets = [...new Set(keys)].map((key) => this.bucket(key));
		if (buckets.some((bucket) => bucket.tokens < 1)) return false;
		for (const bucket of buckets) bucket.tokens -= 1;
		return true;
	}

	retryAfterMs(keys: readonly string[]): number {
		if (this.ratePerMillisecond <= 0) return 60_000;
		const delay = Math.max(
			...[...new Set(keys)].map((key) =>
				Math.ceil(
					Math.max(0, 1 - this.bucket(key).tokens) / this.ratePerMillisecond,
				),
			),
		);
		return Math.min(60_000, Math.max(1, delay));
	}
}
