import { describe, expect, it } from "bun:test";

import type { AppContext, RequestContext } from "questpie";

import {
	defaultOperationScope,
	evaluateMcpRule,
	normalizeRequiredScopes,
	requiredScopesForOperation,
	resolveEntityPolicy,
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
