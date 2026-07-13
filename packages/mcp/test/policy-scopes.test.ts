import { describe, expect, it } from "bun:test";

import type { AppContext, RequestContext } from "questpie";

import {
	defaultOperationScope,
	evaluateMcpRule,
	normalizeRequiredScopes,
	requiredScopesForOperation,
	resolveEntityPolicy,
	scopeGateAllows,
	scopesFromContext,
} from "../src/server/policy.js";
import type { McpAccessRuleContext, McpConfig } from "../src/server/types.js";

// Minimal ctx factory — the rule context only reads `principal` and `session`.
function ctxWith(
	principal: Record<string, unknown> | undefined,
): AppContext & Partial<RequestContext> {
	return { principal } as unknown as AppContext & Partial<RequestContext>;
}

describe("MO7 declarative scope model", () => {
	describe("defaultOperationScope (data-driven mapping)", () => {
		it("maps collection operation kinds to <resource>:<name>:<verb>", () => {
			expect(defaultOperationScope("collection", "posts", "read")).toBe(
				"collections:posts:read",
			);
			expect(defaultOperationScope("collection", "posts", "write")).toBe(
				"collections:posts:write",
			);
			expect(defaultOperationScope("collection", "posts", "delete")).toBe(
				"collections:posts:delete",
			);
		});

		it("maps globals and routes analogously without per-name logic", () => {
			expect(defaultOperationScope("global", "siteSettings", "read")).toBe(
				"globals:siteSettings:read",
			);
			expect(defaultOperationScope("global", "siteSettings", "write")).toBe(
				"globals:siteSettings:write",
			);
			expect(defaultOperationScope("route", "reports/generate", "invoke")).toBe(
				"routes:reports/generate:invoke",
			);
		});

		it("derives scopes for an arbitrary new entity name (scales without framework edits)", () => {
			expect(defaultOperationScope("collection", "brandNewThing", "read")).toBe(
				"collections:brandNewThing:read",
			);
		});
	});

	describe("normalizeRequiredScopes", () => {
		it("normalizes a string, list, false, and undefined", () => {
			expect(normalizeRequiredScopes("a:b:c")).toEqual(["a:b:c"]);
			expect(normalizeRequiredScopes(["a", "b"])).toEqual(["a", "b"]);
			expect(normalizeRequiredScopes(false)).toEqual([]);
			expect(normalizeRequiredScopes(undefined)).toEqual([]);
		});
	});

	describe("requiredScopesForOperation precedence", () => {
		it("falls back to the default mapping when nothing is declared", () => {
			const policy = resolveEntityPolicy({}, "collection", "posts");
			expect(
				requiredScopesForOperation(policy, "collection", "posts", "list", "read"),
			).toEqual(["collections:posts:read"]);
			expect(
				requiredScopesForOperation(
					policy,
					"collection",
					"posts",
					"delete",
					"delete",
				),
			).toEqual(["collections:posts:delete"]);
		});

		it("entity-level requiredScopes applies to every operation", () => {
			const config: McpConfig = {
				crud: {
					collections: { posts: { requiredScopes: "team:posts" } },
				},
			};
			const policy = resolveEntityPolicy(config, "collection", "posts");
			expect(
				requiredScopesForOperation(policy, "collection", "posts", "list", "read"),
			).toEqual(["team:posts"]);
			expect(
				requiredScopesForOperation(
					policy,
					"collection",
					"posts",
					"update",
					"write",
				),
			).toEqual(["team:posts"]);
		});

		it("per-operation operationScopes overrides both entity-level and default", () => {
			const config: McpConfig = {
				crud: {
					collections: {
						posts: {
							requiredScopes: "team:posts",
							operationScopes: {
								delete: ["admin:posts", "collections:posts:delete"],
								list: false,
							},
						},
					},
				},
			};
			const policy = resolveEntityPolicy(config, "collection", "posts");
			// delete: explicit per-op list wins
			expect(
				requiredScopesForOperation(
					policy,
					"collection",
					"posts",
					"delete",
					"delete",
				),
			).toEqual(["admin:posts", "collections:posts:delete"]);
			// list: explicit `false` → no scope required (stops fallback)
			expect(
				requiredScopesForOperation(policy, "collection", "posts", "list", "read"),
			).toEqual([]);
			// update: not overridden → entity-level applies
			expect(
				requiredScopesForOperation(
					policy,
					"collection",
					"posts",
					"update",
					"write",
				),
			).toEqual(["team:posts"]);
		});
	});

	describe("scopesFromContext", () => {
		it("returns scopes only for an oauth principal", () => {
			expect(
				scopesFromContext(
					ctxWith({ kind: "oauth", scopes: ["collections:posts:read"] }),
				),
			).toEqual(["collections:posts:read"]);
		});

		it("returns undefined for user/system/absent principals", () => {
			expect(scopesFromContext(ctxWith({ kind: "user" }))).toBeUndefined();
			expect(scopesFromContext(ctxWith({ kind: "system" }))).toBeUndefined();
			expect(scopesFromContext(ctxWith(undefined))).toBeUndefined();
		});
	});

	describe("evaluateMcpRule threads scopes to the rule", () => {
		it("passes oauth scopes into the access rule context", async () => {
			let seen: McpAccessRuleContext | undefined;
			const rule = (c: McpAccessRuleContext) => {
				seen = c;
				return true;
			};
			await evaluateMcpRule(rule, {
				transport: "http",
				accessMode: "user",
				ctx: ctxWith({
					kind: "oauth",
					scopes: ["collections:posts:read", "collections:posts:write"],
				}),
			});
			expect(seen?.scopes).toEqual([
				"collections:posts:read",
				"collections:posts:write",
			]);
		});

		it("passes undefined scopes for a non-oauth principal", async () => {
			let seen: McpAccessRuleContext | undefined;
			await evaluateMcpRule(
				(c) => {
					seen = c;
					return true;
				},
				{
					transport: "http",
					accessMode: "user",
					ctx: ctxWith({ kind: "user" }),
				},
			);
			expect(seen?.scopes).toBeUndefined();
		});
	});
});

// ---------------------------------------------------------------------------
// MO8 scope gate — coarse umbrellas (LOCKED #2)
//
// Unit-level truth table for `scopeGateAllows(held, required)`: a granular
// requirement is satisfied by the held granular scope OR its applicable coarse
// umbrella. The umbrella is derived by PARSING the scope string (no per-name
// map), so these assertions pin the exact no-over-grant boundary the gate must
// never cross (read≠write≠delete, no delete/route umbrella, cross-kind
// isolation). The end-to-end tool-visibility consequences live in
// `scope-gate.test.ts`.
// ---------------------------------------------------------------------------

describe("MO8 scope gate — coarse umbrellas", () => {
	// ---- no-op / passthrough semantics unchanged ----------------------------

	it("undefined held (user/system) → passes regardless of required", () => {
		expect(scopeGateAllows(undefined, ["collections:posts:read"])).toBe(true);
		expect(scopeGateAllows(undefined, ["collections:posts:delete"])).toBe(true);
	});

	it("empty required → passes for any held set", () => {
		expect(scopeGateAllows([], [])).toBe(true);
		expect(scopeGateAllows(["collections:read"], [])).toBe(true);
	});

	// ---- existing strict-granular grants still pass -------------------------

	it("holding the exact granular scope still satisfies it (regression)", () => {
		expect(
			scopeGateAllows(["collections:posts:read"], ["collections:posts:read"]),
		).toBe(true);
		expect(
			scopeGateAllows(
				["collections:posts:write"],
				["collections:posts:write"],
			),
		).toBe(true);
		expect(
			scopeGateAllows(
				["collections:posts:delete"],
				["collections:posts:delete"],
			),
		).toBe(true);
		expect(
			scopeGateAllows(["globals:siteSettings:read"], [
				"globals:siteSettings:read",
			]),
		).toBe(true);
		expect(
			scopeGateAllows(
				["routes:reports/generate:invoke"],
				["routes:reports/generate:invoke"],
			),
		).toBe(true);
	});

	it("a missing granular scope with no held umbrella is denied (regression)", () => {
		expect(
			scopeGateAllows(["collections:posts:read"], [
				"collections:other:read",
			]),
		).toBe(false);
		expect(scopeGateAllows([], ["collections:posts:read"])).toBe(false);
	});

	// ---- umbrella grants the matching granular verb (convenience) -----------

	it("collections:read umbrella satisfies ANY collection <name>:read", () => {
		expect(
			scopeGateAllows(["collections:read"], ["collections:posts:read"]),
		).toBe(true);
		expect(
			scopeGateAllows(["collections:read"], ["collections:anything:read"]),
		).toBe(true);
	});

	it("collections:write umbrella satisfies ANY collection <name>:write", () => {
		expect(
			scopeGateAllows(["collections:write"], ["collections:posts:write"]),
		).toBe(true);
	});

	it("globals:read / globals:write umbrellas satisfy the matching global verb", () => {
		expect(
			scopeGateAllows(["globals:read"], ["globals:siteSettings:read"]),
		).toBe(true);
		expect(
			scopeGateAllows(["globals:write"], ["globals:siteSettings:write"]),
		).toBe(true);
	});

	it("an umbrella satisfies a multi-scope requirement when it covers every entry", () => {
		expect(
			scopeGateAllows(
				["collections:read"],
				["collections:posts:read", "collections:comments:read"],
			),
		).toBe(true);
	});

	// ---- NO OVER-GRANT: read ≠ write ≠ delete -------------------------------

	it("collections:read does NOT satisfy <name>:write (read never implies write)", () => {
		expect(
			scopeGateAllows(["collections:read"], ["collections:posts:write"]),
		).toBe(false);
	});

	it("collections:read does NOT satisfy <name>:delete (no read→delete)", () => {
		expect(
			scopeGateAllows(["collections:read"], ["collections:posts:delete"]),
		).toBe(false);
	});

	it("collections:write does NOT satisfy <name>:read (write does NOT imply read)", () => {
		expect(
			scopeGateAllows(["collections:write"], ["collections:posts:read"]),
		).toBe(false);
	});

	it("collections:write does NOT satisfy <name>:delete", () => {
		expect(
			scopeGateAllows(["collections:write"], ["collections:posts:delete"]),
		).toBe(false);
	});

	// ---- NO OVER-GRANT: no umbrella for :delete or routes:…:invoke ----------

	it("NO coarse umbrella satisfies a <name>:delete requirement", () => {
		// Neither a (non-existent) delete umbrella nor read/write umbrellas help;
		// only the exact granular delete scope does.
		expect(
			scopeGateAllows(
				["collections:read", "collections:write", "collections:delete"],
				["collections:posts:delete"],
			),
		).toBe(false);
		expect(
			scopeGateAllows(["collections:posts:delete"], [
				"collections:posts:delete",
			]),
		).toBe(true);
	});

	it("NO umbrella satisfies a routes:<key>:invoke requirement", () => {
		expect(
			scopeGateAllows(["routes:invoke"], ["routes:reports/generate:invoke"]),
		).toBe(false);
		// Only the exact granular route scope invokes it.
		expect(
			scopeGateAllows(
				["routes:reports/generate:invoke"],
				["routes:reports/generate:invoke"],
			),
		).toBe(true);
	});

	// ---- NO OVER-GRANT: cross-resource-kind isolation -----------------------

	it("collections:read does NOT satisfy a globals:<name>:read requirement", () => {
		expect(
			scopeGateAllows(["collections:read"], ["globals:siteSettings:read"]),
		).toBe(false);
	});

	it("globals:read does NOT satisfy a collections:<name>:read requirement", () => {
		expect(
			scopeGateAllows(["globals:read"], ["collections:posts:read"]),
		).toBe(false);
	});

	// ---- a custom (non-resource) scope gains no umbrella --------------------

	it("a custom three-segment scope is not umbrella-widened (verb not read/write)", () => {
		// `custom:scoped:use` has three segments but `use` is not umbrella-eligible,
		// so only the exact scope satisfies it — a `custom:use` umbrella does not.
		expect(scopeGateAllows(["custom:use"], ["custom:scoped:use"])).toBe(false);
		expect(scopeGateAllows(["custom:scoped:use"], ["custom:scoped:use"])).toBe(
			true,
		);
	});
});
