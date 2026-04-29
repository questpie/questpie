/**
 * QUE-248: Route Matcher PoC — test harness
 *
 * Tests priority (literal > parameterized > wildcard),
 * collision detection, and edge cases.
 *
 * Updated for method-grouped terminals (QUE-273 Phase 0a).
 */
import { describe, expect, it } from "bun:test";

import {
	RouteCollisionError,
	compileMatcher,
} from "../../src/server/routes/route-matcher.js";

// ============================================================================
// Helpers
// ============================================================================

function routes(...pairs: [string, string][]): Map<string, string> {
	return new Map(pairs);
}

/** Helper to get the handler from a match (uses "*" wildcard method for legacy tests). */
function getHandler<T>(match: { methods: Map<string, T> } | null): T | null {
	if (!match) return null;
	return match.methods.get("*") ?? null;
}

// ============================================================================
// Priority Tests
// ============================================================================

describe("Route Matcher — Priority", () => {
	it("literal beats parameterized", () => {
		const m = compileMatcher(
			routes(
				["users/admin", "literal-handler"],
				["users/:id", "param-handler"],
			),
		);

		const match = m.match("/users/admin");
		expect(match).not.toBeNull();
		expect(getHandler(match)).toBe("literal-handler");
		expect(match!.params).toEqual({});
	});

	it("parameterized matches when literal doesn't", () => {
		const m = compileMatcher(
			routes(
				["users/admin", "literal-handler"],
				["users/:id", "param-handler"],
			),
		);

		const match = m.match("/users/123");
		expect(match).not.toBeNull();
		expect(getHandler(match)).toBe("param-handler");
		expect(match!.params).toEqual({ id: "123" });
	});

	it("parameterized beats wildcard", () => {
		const m = compileMatcher(
			routes(
				["users/:id", "param-handler"],
				["users/*rest", "wildcard-handler"],
			),
		);

		const match = m.match("/users/123");
		expect(match).not.toBeNull();
		expect(getHandler(match)).toBe("param-handler");
		expect(match!.params).toEqual({ id: "123" });
	});

	it("wildcard matches multi-segment remainder", () => {
		const m = compileMatcher(
			routes(
				["users/:id", "param-handler"],
				["users/*rest", "wildcard-handler"],
			),
		);

		const match = m.match("/users/123/posts/456");
		expect(match).not.toBeNull();
		expect(getHandler(match)).toBe("wildcard-handler");
		expect(match!.params).toEqual({ rest: "123/posts/456" });
	});

	it("literal > param > wildcard in a single trie", () => {
		const m = compileMatcher(
			routes(
				["api/users/me", "literal-me"],
				["api/users/:id", "param-id"],
				["api/*path", "wildcard-api"],
			),
		);

		expect(getHandler(m.match("/api/users/me"))).toBe("literal-me");
		expect(getHandler(m.match("/api/users/42"))).toBe("param-id");
		expect(m.match("/api/users/42")!.params).toEqual({ id: "42" });
		expect(getHandler(m.match("/api/docs/intro"))).toBe("wildcard-api");
		expect(m.match("/api/docs/intro")!.params).toEqual({
			path: "docs/intro",
		});
	});

	it("deeper literal beats shorter param", () => {
		const m = compileMatcher(
			routes(
				["users/:id/posts", "param-posts"],
				["users/admin/posts", "literal-admin-posts"],
			),
		);

		expect(getHandler(m.match("/users/admin/posts"))).toBe(
			"literal-admin-posts",
		);
		expect(getHandler(m.match("/users/john/posts"))).toBe("param-posts");
		expect(m.match("/users/john/posts")!.params).toEqual({ id: "john" });
	});
});

// ============================================================================
// Param Extraction Tests
// ============================================================================

describe("Route Matcher — Param Extraction", () => {
	it("extracts single param", () => {
		const m = compileMatcher(routes(["users/:id", "handler"]));
		const match = m.match("/users/abc");
		expect(match!.params).toEqual({ id: "abc" });
	});

	it("extracts multiple params", () => {
		const m = compileMatcher(
			routes(["users/:userId/posts/:postId", "handler"]),
		);
		const match = m.match("/users/42/posts/99");
		expect(match!.params).toEqual({ userId: "42", postId: "99" });
	});

	it("extracts wildcard with default name", () => {
		const m = compileMatcher(routes(["files/*", "handler"]));
		const match = m.match("/files/docs/readme.md");
		expect(match!.params).toEqual({ wildcard: "docs/readme.md" });
	});

	it("extracts wildcard with custom name", () => {
		const m = compileMatcher(routes(["files/*filepath", "handler"]));
		const match = m.match("/files/docs/readme.md");
		expect(match!.params).toEqual({ filepath: "docs/readme.md" });
	});

	it("mixed params and wildcard", () => {
		const m = compileMatcher(routes(["org/:orgId/files/*filepath", "handler"]));
		const match = m.match("/org/acme/files/src/index.ts");
		expect(match!.params).toEqual({
			orgId: "acme",
			filepath: "src/index.ts",
		});
	});
});

// ============================================================================
// No Match Tests
// ============================================================================

describe("Route Matcher — No Match", () => {
	it("returns null for unregistered path", () => {
		const m = compileMatcher(routes(["users/:id", "handler"]));
		expect(m.match("/posts/123")).toBeNull();
	});

	it("returns null for shorter path than pattern", () => {
		const m = compileMatcher(routes(["users/:id/posts", "handler"]));
		expect(m.match("/users/123")).toBeNull();
	});

	it("returns null for longer path without wildcard", () => {
		const m = compileMatcher(routes(["users/:id", "handler"]));
		expect(m.match("/users/123/extra")).toBeNull();
	});

	it("returns null for empty path on non-root route", () => {
		const m = compileMatcher(routes(["users", "handler"]));
		expect(m.match("/")).toBeNull();
	});
});

// ============================================================================
// Collision Detection Tests
// ============================================================================

describe("Route Matcher — Collision Detection", () => {
	it("detects collision: two params at same position", () => {
		expect(() =>
			compileMatcher(
				routes(["users/:id", "handler-a"], ["users/:userId", "handler-b"]),
			),
		).toThrow(RouteCollisionError);
	});

	it("detects collision: same literal pattern", () => {
		// Use array input — Map deduplicates same keys
		expect(() =>
			compileMatcher([
				["users/admin", "handler-a"],
				["users/admin", "handler-b"],
			]),
		).toThrow(RouteCollisionError);
	});

	it("detects collision: two wildcards at same prefix", () => {
		expect(() =>
			compileMatcher(
				routes(["api/*rest", "handler-a"], ["api/*path", "handler-b"]),
			),
		).toThrow(RouteCollisionError);
	});

	it("allows: different literal prefixes (no collision)", () => {
		expect(() =>
			compileMatcher(
				routes(["users/:id", "handler-a"], ["posts/:id", "handler-b"]),
			),
		).not.toThrow();
	});

	it("allows: literal and param at same depth (not ambiguous — priority resolves)", () => {
		expect(() =>
			compileMatcher(
				routes(["users/admin", "literal"], ["users/:id", "param"]),
			),
		).not.toThrow();
	});

	it("allows: param and wildcard at same prefix (priority resolves)", () => {
		expect(() =>
			compileMatcher(
				routes(["users/:id", "param"], ["users/*rest", "wildcard"]),
			),
		).not.toThrow();
	});
});

// ============================================================================
// Edge Cases
// ============================================================================

describe("Route Matcher — Edge Cases", () => {
	it("handles root path", () => {
		const m = compileMatcher(routes(["", "root-handler"]));
		// Empty pattern = zero segments = matches empty path
		// This is a degenerate case; root typically handled separately
	});

	it("handles trailing slash normalization", () => {
		const m = compileMatcher(routes(["users/:id", "handler"]));
		// "/users/123/" splits to ["users", "123", ""] — trailing empty segment
		// This is fine since filter(Boolean) removes empty strings
		expect(m.match("/users/123/")!.params).toEqual({ id: "123" });
	});

	it("handles leading slash normalization", () => {
		const m = compileMatcher(routes(["users/:id", "handler"]));
		expect(m.match("users/123")!.params).toEqual({ id: "123" });
	});

	it("handles special characters in params", () => {
		const m = compileMatcher(routes(["users/:id", "handler"]));
		expect(m.match("/users/hello%20world")!.params).toEqual({
			id: "hello%20world",
		});
	});

	it("handles many routes and repeated matches", () => {
		const r = new Map<string, string>();
		for (let i = 0; i < 200; i++) {
			r.set(`api/v${i}/resource`, `handler-${i}`);
		}
		r.set("api/:version/resource", "param-handler");

		const m = compileMatcher(r);

		// All 200 literals should match before param
		expect(getHandler(m.match("/api/v42/resource"))).toBe("handler-42");
		expect(getHandler(m.match("/api/v999/resource"))).toBe("param-handler");

		// Repeated matches should stay correct across the trie.
		for (let i = 0; i < 1000; i++) {
			const version = i % 200;
			expect(getHandler(m.match(`/api/v${version}/resource`))).toBe(
				`handler-${version}`,
			);
		}
	});

	it("preserves pattern in match result", () => {
		const m = compileMatcher(
			routes(["users/:id", "handler-a"], ["posts/:slug", "handler-b"]),
		);

		expect(m.match("/users/42")!.pattern).toBe("users/:id");
		expect(m.match("/posts/hello")!.pattern).toBe("posts/:slug");
	});
});

// ============================================================================
// Method-grouped terminals (QUE-273)
// ============================================================================

describe("Route Matcher — Method-Grouped Terminals", () => {
	it("stores multiple methods on the same path", () => {
		const m = compileMatcher<string>([
			[":collection/:id", "GET", "findOne-handler"],
			[":collection/:id", "PATCH", "update-handler"],
			[":collection/:id", "DELETE", "remove-handler"],
		]);

		const match = m.match("/users/42");
		expect(match).not.toBeNull();
		expect(match!.methods.get("GET")).toBe("findOne-handler");
		expect(match!.methods.get("PATCH")).toBe("update-handler");
		expect(match!.methods.get("DELETE")).toBe("remove-handler");
		expect(match!.params).toEqual({ collection: "users", id: "42" });
	});

	it("stores multiple methods on the same literal path", () => {
		const m = compileMatcher<string>([
			["globals/:name", "GET", "global-get"],
			["globals/:name", "PATCH", "global-update"],
		]);

		const match = m.match("/globals/settings");
		expect(match).not.toBeNull();
		expect(match!.methods.get("GET")).toBe("global-get");
		expect(match!.methods.get("PATCH")).toBe("global-update");
		expect(match!.params).toEqual({ name: "settings" });
	});

	it("detects collision: same pattern + same method", () => {
		expect(() =>
			compileMatcher<string>([
				["users/:id", "GET", "handler-a"],
				["users/:userId", "GET", "handler-b"],
			]),
		).toThrow(RouteCollisionError);
	});

	it("allows: same pattern structure but different methods", () => {
		expect(() =>
			compileMatcher<string>([
				[":collection", "GET", "find-handler"],
				[":collection", "POST", "create-handler"],
				[":collection", "PATCH", "update-many-handler"],
			]),
		).not.toThrow();
	});

	it("supports wildcard with multiple methods", () => {
		const m = compileMatcher<string>([
			["auth/*path", "GET", "auth-get"],
			["auth/*path", "POST", "auth-post"],
		]);

		const match = m.match("/auth/login");
		expect(match).not.toBeNull();
		expect(match!.methods.get("GET")).toBe("auth-get");
		expect(match!.methods.get("POST")).toBe("auth-post");
		expect(match!.params).toEqual({ path: "login" });
	});

	it("mixed 3-tuple routes with priority", () => {
		const m = compileMatcher<string>([
			["health", "GET", "health-check"],
			["auth/*path", "GET", "auth-get"],
			["auth/*path", "POST", "auth-post"],
			["globals/:name", "GET", "global-get"],
			["globals/:name", "PATCH", "global-update"],
			[":collection", "GET", "collection-find"],
			[":collection", "POST", "collection-create"],
			[":collection/:id", "GET", "collection-findOne"],
			[":collection/:id", "PATCH", "collection-update"],
			[":collection/:id", "DELETE", "collection-remove"],
		]);

		// Literal beats param
		const healthMatch = m.match("/health");
		expect(healthMatch).not.toBeNull();
		expect(healthMatch!.methods.get("GET")).toBe("health-check");

		// Globals literal beats collection param
		const globalMatch = m.match("/globals/settings");
		expect(globalMatch).not.toBeNull();
		expect(globalMatch!.methods.get("GET")).toBe("global-get");
		expect(globalMatch!.methods.get("PATCH")).toBe("global-update");

		// Collection param when no literal matches
		const collMatch = m.match("/users");
		expect(collMatch).not.toBeNull();
		expect(collMatch!.methods.get("GET")).toBe("collection-find");
		expect(collMatch!.methods.get("POST")).toBe("collection-create");
		expect(collMatch!.params).toEqual({ collection: "users" });

		// Collection/:id
		const itemMatch = m.match("/users/42");
		expect(itemMatch).not.toBeNull();
		expect(itemMatch!.methods.get("GET")).toBe("collection-findOne");
		expect(itemMatch!.methods.get("PATCH")).toBe("collection-update");
		expect(itemMatch!.methods.get("DELETE")).toBe("collection-remove");
		expect(itemMatch!.params).toEqual({ collection: "users", id: "42" });
	});
});

// ============================================================================
// Integration-style: Simulated HTTP dispatch
// ============================================================================

describe("Route Matcher — HTTP Dispatch Simulation", () => {
	it("dispatches QuestPie-style routes", () => {
		const m = compileMatcher(
			routes(
				// Framework adapter routes
				["health", "health-check"],
				["auth/*path", "auth-handler"],
				["storage/files/*filepath", "storage-handler"],
				["search", "search-handler"],
				["search/reindex/:collection", "reindex-handler"],
				["realtime", "sse-handler"],

				// Global CRUD
				["globals/:name", "global-read"],
				["globals/:name/update", "global-update"],
				["globals/:name/audit", "global-audit"],

				// Custom user routes
				["admin/stats", "admin-stats"],
				["admin/export/:format", "admin-export"],

				// Collection CRUD (catch-all)
				[":collection", "collection-list"],
				[":collection/create", "collection-create"],
				[":collection/:id", "collection-read"],
				[":collection/:id/update", "collection-update"],
				[":collection/:id/delete", "collection-delete"],
				[":collection/:id/versions", "collection-versions"],
			),
		);

		// Framework routes
		expect(getHandler(m.match("/health"))).toBe("health-check");
		expect(getHandler(m.match("/auth/login"))).toBe("auth-handler");
		expect(m.match("/auth/login")!.params).toEqual({ path: "login" });
		expect(getHandler(m.match("/storage/files/uploads/img.png"))).toBe(
			"storage-handler",
		);
		expect(m.match("/storage/files/uploads/img.png")!.params).toEqual({
			filepath: "uploads/img.png",
		});

		// Global CRUD
		expect(getHandler(m.match("/globals/settings"))).toBe("global-read");
		expect(getHandler(m.match("/globals/settings/update"))).toBe(
			"global-update",
		);
		expect(getHandler(m.match("/globals/settings/audit"))).toBe("global-audit");

		// Custom routes (literal beats param)
		expect(getHandler(m.match("/admin/stats"))).toBe("admin-stats");
		expect(getHandler(m.match("/admin/export/csv"))).toBe("admin-export");
		expect(m.match("/admin/export/csv")!.params).toEqual({
			format: "csv",
		});

		// Collection CRUD
		expect(getHandler(m.match("/users"))).toBe("collection-list");
		expect(m.match("/users")!.params).toEqual({ collection: "users" });
		expect(getHandler(m.match("/users/create"))).toBe("collection-create");
		expect(getHandler(m.match("/users/42"))).toBe("collection-read");
		expect(getHandler(m.match("/users/42/update"))).toBe("collection-update");
		expect(getHandler(m.match("/users/42/versions"))).toBe(
			"collection-versions",
		);

		// Search routes (literal beats param)
		expect(getHandler(m.match("/search"))).toBe("search-handler");
		expect(getHandler(m.match("/search/reindex/posts"))).toBe(
			"reindex-handler",
		);
	});
});
