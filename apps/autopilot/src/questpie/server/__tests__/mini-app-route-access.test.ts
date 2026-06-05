import type { RouteAccessContext } from "questpie/services";
import { describe, expect, it } from "vitest";

import { mintMiniAppToken } from "../apps/mini-app-token";
import { fsPseudoAction, miniAppTokenAccess } from "../lib/route-access";

/**
 * The mini-app bridge ACCESS rule (`miniAppTokenAccess`) — the glue that composes
 * the route's `{appId}`, the request's `x-miniapp-token` header, and the run's
 * `{userId, sessionId}` into a `verifyMiniAppToken` call (the pure token logic is
 * covered by mini-app-token.test.ts). This proves the rule is strictly tighter
 * than `sessionOnly`: a logged-in admin WITHOUT a valid bound token is denied.
 */

const SECRET = "access-test-secret-with-more-than-32-chars-x";

const PRINCIPAL = {
	user: { id: "user-1" },
	session: { id: "session-1" },
};

function ctx(opts: {
	appId?: string;
	token?: string | null;
	action?: string;
	method?: string;
	session?: unknown;
}): RouteAccessContext {
	const headers = new Headers();
	if (opts.token) headers.set("x-miniapp-token", opts.token);
	const url = `http://localhost/api/apps/${opts.appId ?? "social-scheduler"}/${
		opts.action ?? "status"
	}`;
	return {
		session: "session" in opts ? opts.session : PRINCIPAL,
		params: {
			appId: opts.appId ?? "social-scheduler",
			fn: opts.action ?? "status",
		},
		request: new Request(url, { method: opts.method ?? "POST", headers }),
		app: { config: { secret: SECRET } },
	} as unknown as RouteAccessContext;
}

function freshToken(
	overrides?: Partial<Parameters<typeof mintMiniAppToken>[1]>,
) {
	return mintMiniAppToken(SECRET, {
		appId: "social-scheduler",
		sessionId: "session-1",
		userId: "user-1",
		actions: ["status", "fs:read", "fs:write"],
		...overrides,
	}).token;
}

describe("miniAppTokenAccess (named-action route)", () => {
	const access = miniAppTokenAccess(
		(c) => (c.params as { fn?: string } | undefined)?.fn,
	);

	it("allows a logged-in admin WITH a valid bound token", () => {
		expect(access(ctx({ token: freshToken() }))).toBe(true);
	});

	it("DENIES a logged-in admin with NO token (tighter than sessionOnly)", () => {
		expect(access(ctx({ token: null }))).toBe(false);
	});

	it("denies when there is no session at all", () => {
		expect(access(ctx({ token: freshToken(), session: null }))).toBe(false);
	});

	it("denies a token bound to a DIFFERENT session", () => {
		const token = freshToken({ sessionId: "session-2" });
		expect(access(ctx({ token }))).toBe(false);
	});

	it("denies a token bound to a DIFFERENT app than the route", () => {
		const token = mintMiniAppToken(SECRET, {
			appId: "other-app",
			sessionId: "session-1",
			userId: "user-1",
			actions: ["status"],
		}).token;
		expect(access(ctx({ token, appId: "social-scheduler" }))).toBe(false);
	});

	it("denies when the requested action is not in the token allowlist", () => {
		const token = freshToken({ actions: ["status"] });
		expect(access(ctx({ token, action: "deletePost" }))).toBe(false);
	});

	it("denies a forged token (signed with another secret)", () => {
		const token = mintMiniAppToken("totally-different-secret-aaaaaaaaaaaa", {
			appId: "social-scheduler",
			sessionId: "session-1",
			userId: "user-1",
			actions: ["status"],
		}).token;
		expect(access(ctx({ token }))).toBe(false);
	});
});

describe("miniAppTokenAccess (fs route)", () => {
	const access = miniAppTokenAccess(fsPseudoAction);

	it("maps GET → fs:read and allows it when granted", () => {
		const token = freshToken();
		expect(access(ctx({ token, method: "GET" }))).toBe(true);
	});

	it("maps PUT → fs:write and allows it when granted", () => {
		const token = freshToken();
		expect(access(ctx({ token, method: "PUT" }))).toBe(true);
	});

	it("denies fs when the token lacks the fs pseudo-action", () => {
		const token = freshToken({ actions: ["status"] });
		expect(access(ctx({ token, method: "GET" }))).toBe(false);
	});
});

describe("fsPseudoAction", () => {
	it("classifies methods to fs pseudo-actions", () => {
		const make = (method: string) =>
			({
				request: new Request("http://localhost/x", { method }),
			}) as unknown as RouteAccessContext;
		expect(fsPseudoAction(make("GET"))).toBe("fs:read");
		expect(fsPseudoAction(make("HEAD"))).toBe("fs:read");
		expect(fsPseudoAction(make("PUT"))).toBe("fs:write");
		expect(fsPseudoAction(make("DELETE"))).toBeUndefined();
	});
});
