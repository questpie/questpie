/**
 * The `x-miniapp-token` — the bridge auth artifact for the KnowledgeHost iframe.
 *
 * `.private/miniapps-v2-design.md` §3.3: the parent KnowledgeHost (the trusted
 * half) attaches THIS token to every bridged `POST /api/apps/{appId}/{action}`
 * and `…/fs/[...path]` call the untrusted iframe asks it to proxy. It is a
 * COMPLETELY SEPARATE artifact from the v1 broker token
 * (`x-questpie-sandbox-token`), which is supervisor-internal and SENSITIVE-stripped
 * before anything reaches the guest — this one lives in the BROWSER, so it must be
 * scoped tighter than "some admin is logged in" (the `sessionOnly` gap §3.3 calls
 * out) and bound to the EXACT caller.
 *
 * Design choices:
 *   - **Stateless HMAC**, not an in-memory map. A signed token needs NO shared
 *     server state between the mint endpoint and the `[fn].ts`/`fs` routes (which
 *     may run in different worker processes), survives a restart, and cannot be
 *     forged without the signing key. The payload is NOT secret (it carries only an
 *     appId + the caller's own session id + an action allowlist), so signing —
 *     not encryption — is the right primitive.
 *   - **Bound to `{appId, sessionId, userId}`** so a token minted for app A by user
 *     U's session S authorizes ONLY A, ONLY while S is the live session, ONLY for U.
 *     A different app, a different/stale session, or a different user fails
 *     validation — the route then rejects even though `session.user.id` is non-empty.
 *   - **An explicit `actions` allowlist** (the registered action names + the two fs
 *     pseudo-actions `fs:read`/`fs:write`). The mint endpoint stamps the app's
 *     resolved action surface; the route checks the requested `{action}` is in it.
 *     `*` means "any action of this app" (used for the fs routes / generic mint).
 *   - **Short-lived** (default 10 min) and **never longer than the session** — the
 *     caller re-mints as needed. CSRF: the token rides a NON-cookie header
 *     (`x-miniapp-token`) a cross-origin attacker cannot set, so requiring it (on
 *     top of the SameSite session cookie) closes the cross-origin-POST hole.
 *
 * Everything here is pure + dependency-free (Node `crypto` only) so the mint +
 * validate logic is unit-tested without a DB, an app, or the browser.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** The header the bridge sends the token in (a non-cookie header → CSRF defense). */
export const MINIAPP_TOKEN_HEADER = "x-miniapp-token";

/** Default token lifetime (ms). Short — the parent re-mints as the session lives on. */
export const DEFAULT_MINIAPP_TOKEN_TTL_MS = 10 * 60_000;

/** Hard ceiling on a minted token's lifetime, even if a longer TTL is requested. */
export const MAX_MINIAPP_TOKEN_TTL_MS = 60 * 60_000;

/**
 * Domain-separation label mixed into the signing key so the mini-app-token key is
 * a DISTINCT key from the raw app/auth secret (and from any other HMAC the app
 * derives off the same secret). Changing this invalidates all live tokens.
 */
const KEY_DERIVATION_LABEL = "questpie:miniapp-token:v1";

/** The wildcard action grant — "any registered action of this app". */
export const MINIAPP_ACTION_WILDCARD = "*";

/** Pseudo-actions for the file-as-DB bridge surface (not real `actions` keys). */
export const MINIAPP_FS_READ_ACTION = "fs:read";
export const MINIAPP_FS_WRITE_ACTION = "fs:write";

/** The signed claims carried by a mini-app token. */
export interface MiniAppTokenClaims {
	/** App the token authorizes — MUST equal the route's `{appId}`. */
	appId: string;
	/** The minting session's id (better-auth `session.session.id`). */
	sessionId: string;
	/** The minting user's id (better-auth `session.user.id`). */
	userId: string;
	/**
	 * Allowed action names. The route's requested `{action}` must be a member,
	 * unless the list contains {@link MINIAPP_ACTION_WILDCARD}. fs requests check
	 * the `fs:read`/`fs:write` pseudo-actions (or the wildcard).
	 */
	actions: string[];
	/** Issued-at epoch ms. */
	iat: number;
	/** Expiry epoch ms — rejected at/after this instant. */
	exp: number;
}

/** Options for {@link mintMiniAppToken}. */
export interface MintMiniAppTokenOptions {
	appId: string;
	sessionId: string;
	userId: string;
	actions: string[];
	/** Lifetime (ms). Clamped to {@link MAX_MINIAPP_TOKEN_TTL_MS}. */
	ttlMs?: number;
	/** Injectable clock (epoch ms) for deterministic tests. */
	now?: number;
}

/**
 * Derive the HMAC signing key from the app secret with domain separation.
 *
 * The app secret (`config.secret` / `BETTER_AUTH_SECRET`) is reused so no NEW
 * secret has to be provisioned, but it is run through an HMAC keyed by the secret
 * with a fixed label so this key is independent of the auth-session signing key.
 */
function deriveSigningKey(appSecret: string): Buffer {
	return createHmac("sha256", appSecret).update(KEY_DERIVATION_LABEL).digest();
}

/** URL-safe base64 (no padding) — safe to carry in a header value. */
function b64url(buf: Buffer): string {
	return buf
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

/** Inverse of {@link b64url}. Returns `null` on malformed input (never throws). */
function fromB64url(value: string): Buffer | null {
	if (!/^[A-Za-z0-9_-]*$/.test(value)) return null;
	const pad = value.length % 4 === 0 ? "" : "=".repeat(4 - (value.length % 4));
	try {
		return Buffer.from(
			value.replace(/-/g, "+").replace(/_/g, "/") + pad,
			"base64",
		);
	} catch {
		return null;
	}
}

/** Sign the `payload.signature` body with the derived key. */
function sign(appSecret: string, payloadB64: string): string {
	const key = deriveSigningKey(appSecret);
	return b64url(createHmac("sha256", key).update(payloadB64).digest());
}

/**
 * Mint a signed, scoped mini-app token. The returned string is
 * `base64url(JSON(claims)) + "." + base64url(HMAC)`.
 *
 * @throws {Error} when a required binding field is empty (a token must never be
 *   minted with an absent app/session/user — that would defeat the binding).
 */
export function mintMiniAppToken(
	appSecret: string,
	options: MintMiniAppTokenOptions,
): { token: string; claims: MiniAppTokenClaims } {
	if (!appSecret) throw new Error("mini-app token: missing signing secret");
	if (!options.appId) throw new Error("mini-app token: missing appId");
	if (!options.sessionId) throw new Error("mini-app token: missing sessionId");
	if (!options.userId) throw new Error("mini-app token: missing userId");

	const now = options.now ?? Date.now();
	const ttl = Math.min(
		options.ttlMs ?? DEFAULT_MINIAPP_TOKEN_TTL_MS,
		MAX_MINIAPP_TOKEN_TTL_MS,
	);
	const claims: MiniAppTokenClaims = {
		appId: options.appId,
		sessionId: options.sessionId,
		userId: options.userId,
		// De-dupe + drop empties so the allowlist is clean.
		actions: [
			...new Set(options.actions.filter((a) => typeof a === "string" && a)),
		],
		iat: now,
		exp: now + ttl,
	};

	const payloadB64 = b64url(Buffer.from(JSON.stringify(claims), "utf8"));
	const signature = sign(appSecret, payloadB64);
	return { token: `${payloadB64}.${signature}`, claims };
}

/** Why a token failed validation (for diagnostics / 401 messages). */
export type MiniAppTokenError =
	| "missing"
	| "malformed"
	| "bad_signature"
	| "expired"
	| "app_mismatch"
	| "session_mismatch"
	| "user_mismatch"
	| "action_not_allowed";

/** Result of {@link verifyMiniAppToken}. */
export type MiniAppTokenResult =
	| { ok: true; claims: MiniAppTokenClaims }
	| { ok: false; error: MiniAppTokenError };

/** The binding the route asserts the token must match. */
export interface MiniAppTokenExpectation {
	appId: string;
	sessionId: string;
	userId: string;
	/**
	 * The action being invoked. The token's `actions` allowlist must contain it
	 * (or the wildcard). Omit to skip the action check (e.g. a non-action probe).
	 */
	action?: string;
	/** Injectable clock (epoch ms). */
	now?: number;
}

/**
 * Verify a mini-app token's signature, expiry, AND that it binds the EXACT
 * `{appId, sessionId, userId, action}` the route is serving.
 *
 * Constant-time on the signature compare. Every failure is a typed reason — the
 * route maps any `ok:false` to a 401 and NEVER falls back to "logged-in is enough".
 */
export function verifyMiniAppToken(
	appSecret: string,
	token: string | null | undefined,
	expected: MiniAppTokenExpectation,
): MiniAppTokenResult {
	if (typeof token !== "string" || token.length === 0) {
		return { ok: false, error: "missing" };
	}

	const dot = token.indexOf(".");
	if (dot <= 0 || dot === token.length - 1) {
		return { ok: false, error: "malformed" };
	}
	const payloadB64 = token.slice(0, dot);
	const providedSig = token.slice(dot + 1);

	// Constant-time signature check. Re-sign the payload and compare lengths first
	// (timingSafeEqual throws on length mismatch), then the bytes.
	const expectedSig = sign(appSecret, payloadB64);
	const a = Buffer.from(providedSig);
	const b = Buffer.from(expectedSig);
	if (a.length !== b.length || !timingSafeEqual(a, b)) {
		return { ok: false, error: "bad_signature" };
	}

	const payloadBytes = fromB64url(payloadB64);
	if (!payloadBytes) return { ok: false, error: "malformed" };

	let claims: MiniAppTokenClaims;
	try {
		const parsed = JSON.parse(payloadBytes.toString("utf8")) as unknown;
		if (!isClaims(parsed)) return { ok: false, error: "malformed" };
		claims = parsed;
	} catch {
		return { ok: false, error: "malformed" };
	}

	const now = expected.now ?? Date.now();
	if (now >= claims.exp) return { ok: false, error: "expired" };

	// Bind the caller. A signed-but-mismatched token is as bad as a forgery here.
	if (claims.appId !== expected.appId)
		return { ok: false, error: "app_mismatch" };
	if (claims.sessionId !== expected.sessionId) {
		return { ok: false, error: "session_mismatch" };
	}
	if (claims.userId !== expected.userId) {
		return { ok: false, error: "user_mismatch" };
	}

	if (expected.action !== undefined) {
		const allowed =
			claims.actions.includes(MINIAPP_ACTION_WILDCARD) ||
			claims.actions.includes(expected.action);
		if (!allowed) return { ok: false, error: "action_not_allowed" };
	}

	return { ok: true, claims };
}

/** The minimal app shape {@link resolveMiniAppTokenSecret} reads (config only). */
export interface TokenSecretAppLike {
	config?: { secret?: string };
}

/**
 * Resolve the signing secret the same config-first way `resolveBrokerUrl` resolves
 * the broker URL: `app.config.secret` → `QUESTPIE_SECRET` → `BETTER_AUTH_SECRET`.
 *
 * @throws {Error} when NO secret is configured. Failing closed is deliberate: a
 *   missing secret must NOT silently fall back to a constant (which would let
 *   anyone forge tokens) — the mini-app bridge is simply unavailable until a
 *   secret is set.
 */
export function resolveMiniAppTokenSecret(app: TokenSecretAppLike): string {
	const fromConfig = app.config?.secret;
	if (typeof fromConfig === "string" && fromConfig.length > 0)
		return fromConfig;
	const fromEnv = process.env.QUESTPIE_SECRET ?? process.env.BETTER_AUTH_SECRET;
	if (typeof fromEnv === "string" && fromEnv.length > 0) return fromEnv;
	throw new Error(
		"mini-app token: no signing secret configured (set config.secret / QUESTPIE_SECRET / BETTER_AUTH_SECRET)",
	);
}

/** Structural guard for a decoded claims object. */
function isClaims(value: unknown): value is MiniAppTokenClaims {
	if (typeof value !== "object" || value === null) return false;
	const v = value as Record<string, unknown>;
	return (
		typeof v.appId === "string" &&
		typeof v.sessionId === "string" &&
		typeof v.userId === "string" &&
		Array.isArray(v.actions) &&
		v.actions.every((a) => typeof a === "string") &&
		typeof v.iat === "number" &&
		typeof v.exp === "number"
	);
}
