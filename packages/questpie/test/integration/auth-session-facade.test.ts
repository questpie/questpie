import { describe, expect, it } from "bun:test";

import { handleAuthRoute } from "../../src/server/modules/core/routes/auth/_handler";

type SessionRow = {
	id: string;
	userId: string;
	token: string;
	createdAt: string;
	updatedAt: string;
	expiresAt: string;
	ipAddress?: string | null;
	userAgent?: string | null;
};

function createAuthHarness(sessions: SessionRow[], currentSessionId: string) {
	const calls: Array<{ path: string; body?: unknown }> = [];
	const auth = {
		handler: async (request: Request) => {
			const url = new URL(request.url);
			if (url.pathname.endsWith("/list-sessions")) {
				calls.push({ path: url.pathname });
				return Response.json(sessions);
			}
			if (url.pathname.endsWith("/get-session")) {
				calls.push({ path: url.pathname });
				return Response.json({
					session: sessions.find(({ id }) => id === currentSessionId),
					user: { id: "user-1" },
				});
			}
			if (url.pathname.endsWith("/revoke-session")) {
				const body = await request.json();
				calls.push({ path: url.pathname, body });
				return Response.json({ status: true });
			}
			return new Response("not found", { status: 404 });
		},
	};

	return {
		calls,
		invoke(request: Request) {
			return handleAuthRoute({ request, app: { auth } } as never);
		},
	};
}

function session(index: number): SessionRow {
	return {
		id: `session-${index}`,
		userId: "user-1",
		token: `bearer-secret-${index}`,
		createdAt: new Date(index * 1_000).toISOString(),
		updatedAt: new Date(index * 1_000).toISOString(),
		expiresAt: new Date(Date.now() + 60_000).toISOString(),
		ipAddress: "127.0.0.1",
		userAgent: "test",
	};
}

describe("Better Auth session facade", () => {
	it("projects a bounded list without reusable bearer tokens", async () => {
		const rows = Array.from({ length: 125 }, (_, index) => session(index));
		const harness = createAuthHarness(rows, "session-124");
		const response = await harness.invoke(
			new Request("https://example.test/api/auth/list-sessions"),
		);

		expect(response.status).toBe(200);
		const body = (await response.json()) as Array<Record<string, unknown>>;
		expect(body).toHaveLength(100);
		expect(JSON.stringify(body)).not.toContain("bearer-secret");
		expect(body[0]).toMatchObject({
			id: "session-124",
			token: "session-124",
			isCurrent: true,
		});
	});

	it("resolves an owned opaque session id before revocation", async () => {
		const harness = createAuthHarness([session(1), session(2)], "session-1");
		const response = await harness.invoke(
			new Request("https://example.test/api/auth/revoke-session", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ token: "session-2" }),
			}),
		);

		expect(response.status).toBe(200);
		expect(harness.calls.at(-1)).toEqual({
			path: "/api/auth/revoke-session",
			body: { token: "bearer-secret-2" },
		});
	});

	it("does not accept a raw bearer token or disclose another session", async () => {
		const harness = createAuthHarness([session(1)], "session-1");
		const response = await harness.invoke(
			new Request("https://example.test/api/auth/revoke-session", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ token: "bearer-secret-1" }),
			}),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: true });
		expect(
			harness.calls.filter(({ path }) => path.endsWith("/revoke-session")),
		).toHaveLength(0);
	});
});
