import { describe, expect, it } from "vitest";

import {
	DEFAULT_MINIAPP_TOKEN_TTL_MS,
	MAX_MINIAPP_TOKEN_TTL_MS,
	MINIAPP_ACTION_WILDCARD,
	mintMiniAppToken,
	resolveMiniAppTokenSecret,
	verifyMiniAppToken,
} from "../apps/mini-app-token";

const SECRET = "test-secret-with-more-than-32-characters-xxxx";

const base = {
	appId: "social-scheduler",
	sessionId: "session-1",
	userId: "user-1",
	actions: ["status"],
};

describe("mini-app token — mint", () => {
	it("mints a `payload.signature` token carrying the bound claims", () => {
		const now = 1_000_000;
		const { token, claims } = mintMiniAppToken(SECRET, { ...base, now });
		expect(token.split(".")).toHaveLength(2);
		expect(claims.appId).toBe("social-scheduler");
		expect(claims.sessionId).toBe("session-1");
		expect(claims.userId).toBe("user-1");
		expect(claims.actions).toEqual(["status"]);
		expect(claims.iat).toBe(now);
		expect(claims.exp).toBe(now + DEFAULT_MINIAPP_TOKEN_TTL_MS);
	});

	it("de-dupes + drops empty action names", () => {
		const { claims } = mintMiniAppToken(SECRET, {
			...base,
			actions: ["status", "status", "", "fs:read"],
		});
		expect(claims.actions).toEqual(["status", "fs:read"]);
	});

	it("clamps the TTL to the hard ceiling", () => {
		const now = 0;
		const { claims } = mintMiniAppToken(SECRET, {
			...base,
			ttlMs: MAX_MINIAPP_TOKEN_TTL_MS * 10,
			now,
		});
		expect(claims.exp).toBe(MAX_MINIAPP_TOKEN_TTL_MS);
	});

	it("refuses to mint without a binding field (fail-closed)", () => {
		expect(() => mintMiniAppToken("", base)).toThrow(/secret/);
		expect(() => mintMiniAppToken(SECRET, { ...base, appId: "" })).toThrow(
			/appId/,
		);
		expect(() => mintMiniAppToken(SECRET, { ...base, sessionId: "" })).toThrow(
			/sessionId/,
		);
		expect(() => mintMiniAppToken(SECRET, { ...base, userId: "" })).toThrow(
			/userId/,
		);
	});
});

describe("mini-app token — verify (happy path + binding)", () => {
	it("accepts a token that binds the exact app/session/user/action", () => {
		const now = 1_000;
		const { token } = mintMiniAppToken(SECRET, { ...base, now });
		const result = verifyMiniAppToken(SECRET, token, {
			appId: "social-scheduler",
			sessionId: "session-1",
			userId: "user-1",
			action: "status",
			now: now + 1,
		});
		expect(result.ok).toBe(true);
	});

	it("accepts any action when the token carries the wildcard", () => {
		const now = 1_000;
		const { token } = mintMiniAppToken(SECRET, {
			...base,
			actions: [MINIAPP_ACTION_WILDCARD],
			now,
		});
		const result = verifyMiniAppToken(SECRET, token, {
			appId: "social-scheduler",
			sessionId: "session-1",
			userId: "user-1",
			action: "anything",
			now: now + 1,
		});
		expect(result.ok).toBe(true);
	});

	it("skips the action check when no action is expected", () => {
		const { token } = mintMiniAppToken(SECRET, base);
		const result = verifyMiniAppToken(SECRET, token, {
			appId: "social-scheduler",
			sessionId: "session-1",
			userId: "user-1",
		});
		expect(result.ok).toBe(true);
	});
});

describe("mini-app token — verify (rejections, fail-closed)", () => {
	const expected = {
		appId: "social-scheduler",
		sessionId: "session-1",
		userId: "user-1",
		action: "status",
	};

	it("rejects a missing/empty token", () => {
		expect(verifyMiniAppToken(SECRET, undefined, expected)).toEqual({
			ok: false,
			error: "missing",
		});
		expect(verifyMiniAppToken(SECRET, "", expected)).toEqual({
			ok: false,
			error: "missing",
		});
	});

	it("rejects a malformed token (no dot / empty parts)", () => {
		expect(verifyMiniAppToken(SECRET, "nodot", expected).ok).toBe(false);
		expect(verifyMiniAppToken(SECRET, ".sig", expected).ok).toBe(false);
		expect(verifyMiniAppToken(SECRET, "payload.", expected).ok).toBe(false);
	});

	it("rejects a token signed with a DIFFERENT secret (forgery)", () => {
		const { token } = mintMiniAppToken(
			"attacker-secret-aaaaaaaaaaaaaaaaaaaa",
			base,
		);
		const result = verifyMiniAppToken(SECRET, token, expected);
		expect(result).toEqual({ ok: false, error: "bad_signature" });
	});

	it("rejects a token whose payload was tampered (signature mismatch)", () => {
		const { token } = mintMiniAppToken(SECRET, base);
		const [, sig] = token.split(".");
		// Swap the payload for a forged one but keep the original signature.
		const forgedPayload = Buffer.from(
			JSON.stringify({
				...base,
				userId: "admin",
				iat: 0,
				exp: 9_999_999_999_999,
			}),
			"utf8",
		)
			.toString("base64")
			.replace(/\+/g, "-")
			.replace(/\//g, "_")
			.replace(/=+$/, "");
		const result = verifyMiniAppToken(
			SECRET,
			`${forgedPayload}.${sig}`,
			expected,
		);
		expect(result.ok).toBe(false);
		expect(result).toEqual({ ok: false, error: "bad_signature" });
	});

	it("rejects an expired token", () => {
		const now = 1_000;
		const { token } = mintMiniAppToken(SECRET, { ...base, ttlMs: 60_000, now });
		const result = verifyMiniAppToken(SECRET, token, {
			...expected,
			now: now + 60_001,
		});
		expect(result).toEqual({ ok: false, error: "expired" });
	});

	it("rejects a token for a DIFFERENT app", () => {
		const { token } = mintMiniAppToken(SECRET, base);
		const result = verifyMiniAppToken(SECRET, token, {
			...expected,
			appId: "other-app",
		});
		expect(result).toEqual({ ok: false, error: "app_mismatch" });
	});

	it("rejects a token from a DIFFERENT (rotated/stale) session", () => {
		const { token } = mintMiniAppToken(SECRET, base);
		const result = verifyMiniAppToken(SECRET, token, {
			...expected,
			sessionId: "session-2",
		});
		expect(result).toEqual({ ok: false, error: "session_mismatch" });
	});

	it("rejects a token for a DIFFERENT user", () => {
		const { token } = mintMiniAppToken(SECRET, base);
		const result = verifyMiniAppToken(SECRET, token, {
			...expected,
			userId: "user-2",
		});
		expect(result).toEqual({ ok: false, error: "user_mismatch" });
	});

	it("rejects an action NOT in the token's allowlist", () => {
		const { token } = mintMiniAppToken(SECRET, {
			...base,
			actions: ["status"],
		});
		const result = verifyMiniAppToken(SECRET, token, {
			...expected,
			action: "deletePost",
		});
		expect(result).toEqual({ ok: false, error: "action_not_allowed" });
	});
});

describe("mini-app token — secret resolution (config-first, fail-closed)", () => {
	it("prefers config.secret", () => {
		expect(
			resolveMiniAppTokenSecret({ config: { secret: "from-config" } }),
		).toBe("from-config");
	});

	it("throws when no secret is configured anywhere", () => {
		const prevQ = process.env.QUESTPIE_SECRET;
		const prevB = process.env.BETTER_AUTH_SECRET;
		delete process.env.QUESTPIE_SECRET;
		delete process.env.BETTER_AUTH_SECRET;
		try {
			expect(() => resolveMiniAppTokenSecret({ config: {} })).toThrow(
				/no signing secret/,
			);
		} finally {
			if (prevQ !== undefined) process.env.QUESTPIE_SECRET = prevQ;
			if (prevB !== undefined) process.env.BETTER_AUTH_SECRET = prevB;
		}
	});
});
