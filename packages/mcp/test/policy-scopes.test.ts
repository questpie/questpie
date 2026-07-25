import { describe, expect, it } from "bun:test";

import type { AppContext, RequestContext } from "questpie";
import { z } from "zod";

import { resolveMcpCatalog } from "../src/server/catalog.js";
import { mcpTool } from "../src/server/mcp-tool.js";
import {
	defaultOperationScope,
	evaluateMcpRule,
	normalizeRequiredScopes,
	operationRule,
	requiredScopesForOperation,
	resolveMcpConfig,
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
	describe("explicit named catalog policy", () => {
		it("denies omitted entities and operations", () => {
			for (const kind of ["collection", "global", "route"] as const) {
				const policy = resolveEntityPolicy({}, kind, "omitted");
				expect(policy.expose).toBe(false);
				expect(operationRule(policy, "list")).toBeUndefined();
				expect(operationRule(policy, "get")).toBeUndefined();
				expect(operationRule(policy, "execute")).toBeUndefined();
			}
		});

		it("resolves only existing, explicitly enabled operations and resources", () => {
			const explicit = mcpTool("custom.explicit", {
				access: true,
				scopes: "custom:explicit:invoke",
				inputSchema: z.object({}),
			}).handler(async () => ({ content: [] }));
			const omitted = mcpTool("custom.omitted", {
				access: false,
				scopes: "custom:omitted:invoke",
				inputSchema: z.object({}),
			}).handler(async () => ({ content: [] }));
			const missingScope = mcpTool("custom.missing-scope", {
				access: true,
				inputSchema: z.object({}),
			}).handler(async () => ({ content: [] }));
			const explicitNoScope = mcpTool("custom.no-oauth-scope", {
				access: true,
				scopes: false,
				inputSchema: z.object({}),
			}).handler(async () => ({ content: [] }));
			const app = {
				getCollections: () => ({ posts: {}, hidden: {} }),
				getGlobals: () => ({ siteSettings: {} }),
				state: {
					mcpTools: { explicit, omitted, missingScope, explicitNoScope },
				},
				config: {},
			};
			const catalog = resolveMcpCatalog(app as never, {
				crud: {
					collections: {
						posts: { operations: { list: true } },
						unknown: { operations: { delete: true } },
					},
				},
				resources: { collections: { posts: true, hidden: true } },
			});

			expect([...catalog.collections.keys()]).toEqual(["posts"]);
			expect(catalog.collections.get("posts")?.operations).toEqual(["list"]);
			expect([...catalog.globals.keys()]).toEqual([]);
			expect([...catalog.customTools.keys()]).toEqual([
				"custom.explicit",
				"custom.no-oauth-scope",
			]);
			expect([...catalog.resources.collections]).toEqual(["posts"]);
			expect((catalog.collections as any).set).toBeUndefined();
			expect(
				Object.isFrozen(catalog.collections.get("posts")?.operations),
			).toBe(true);
			expect(
				Object.isFrozen(
					catalog.customTools.get("custom.explicit")?.tool.config,
				),
			).toBe(true);
			expect(catalog.oauth.scopes).toEqual([
				"collections:posts:read",
				"custom:explicit:invoke",
				"collections:read",
			]);
			expect(catalog.oauth.scopes).not.toContain("collections:posts:write");
			expect(catalog.oauth.scopes).not.toContain("collections:unknown:delete");
			expect(catalog.oauth.scopesSupported).toEqual(["collections:read"]);
		});

		it("fails closed on duplicate released tool names", () => {
			const first = mcpTool("custom.duplicate", {
				access: true,
				scopes: false,
			}).handler(async () => ({ content: [] }));
			const second = mcpTool("custom.duplicate", {
				access: true,
				scopes: false,
			}).handler(async () => ({ content: [] }));
			const app = {
				getCollections: () => ({}),
				getGlobals: () => ({}),
				state: { mcpTools: { first, second } },
				config: {},
			};

			expect(() => resolveMcpCatalog(app as never, {})).toThrow(
				"Duplicate MCP tool name",
			);
		});

		it("replaces a named entity policy instead of inheriting omitted operations", () => {
			const app = {
				state: {
					config: {
						mcp: {
							crud: {
								collections: {
									posts: {
										operations: { list: true, delete: true },
									},
								},
							},
						},
					},
				},
			};
			const resolved = resolveMcpConfig(app as never, {
				crud: {
					collections: {
						posts: { operations: { list: true } },
					},
				},
			});

			expect(resolved.crud?.collections?.posts).toEqual({
				operations: { list: true },
			});
		});

		it("ignores inherited and prototype-pollution config entries", () => {
			const inherited = Object.create({
				hidden: { operations: { list: true } },
			}) as Record<string, unknown>;
			inherited.posts = { operations: { list: true } };
			Object.defineProperty(inherited, "constructor", {
				enumerable: true,
				value: { operations: { delete: true } },
			});
			Object.defineProperty(inherited, "__proto__", {
				enumerable: true,
				value: { operations: { delete: true } },
			});

			const app = {
				state: {
					config: {
						mcp: {
							crud: { collections: inherited },
							resources: {
								collections: Object.create({ hidden: true }),
							},
						},
					},
				},
			};
			const resolved = resolveMcpConfig(app as never);

			expect(Object.getPrototypeOf(resolved.crud?.collections)).toBeNull();
			expect(Object.keys(resolved.crud?.collections ?? {})).toEqual(["posts"]);
			expect(resolveEntityPolicy(resolved, "collection", "hidden").expose).toBe(
				false,
			);
			expect(
				resolveEntityPolicy(resolved, "collection", "constructor").expose,
			).toBe(false);
			expect(
				resolveEntityPolicy(resolved, "collection", "__proto__").expose,
			).toBe(false);
			expect(Object.keys(resolved.resources?.collections ?? {})).toEqual([]);

			const inheritedTopLevel = Object.create({
				crud: {
					collections: { posts: { operations: { list: true } } },
				},
			}) as McpConfig;
			expect(
				resolveEntityPolicy(inheritedTopLevel, "collection", "posts").expose,
			).toBe(false);

			const inheritedResources = Object.create({
				resources: { collections: { posts: true } },
			}) as McpConfig;
			inheritedResources.crud = {
				collections: { posts: { operations: { list: true } } },
			};
			const directCatalog = resolveMcpCatalog(
				{
					getCollections: () => ({ posts: {} }),
					getGlobals: () => ({}),
					state: {},
					config: {},
				} as never,
				inheritedResources,
			);
			expect([...directCatalog.resources.collections]).toEqual([]);
		});
	});

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
				requiredScopesForOperation(
					policy,
					"collection",
					"posts",
					"list",
					"read",
				),
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
				requiredScopesForOperation(
					policy,
					"collection",
					"posts",
					"list",
					"read",
				),
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
				requiredScopesForOperation(
					policy,
					"collection",
					"posts",
					"list",
					"read",
				),
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
					ctxWith({
						kind: "oauth",
						user: { id: "user-1" },
						clientId: "client-1",
						tokenId: "token-1",
						scopes: ["collections:posts:read"],
					}),
				),
			).toEqual(["collections:posts:read"]);
		});

		it("returns undefined for user/system/absent principals", () => {
			expect(
				scopesFromContext(
					ctxWith({
						kind: "user",
						user: { id: "user-1" },
						session: { id: "session-1" },
					}),
				),
			).toBeUndefined();
			expect(scopesFromContext(ctxWith({ kind: "system" }))).toBeUndefined();
			expect(scopesFromContext(ctxWith(undefined))).toBeUndefined();
		});

		it("fails closed for incomplete or malformed oauth principals", () => {
			for (const principal of [
				{ kind: "oauth" },
				{
					kind: "oauth",
					user: { id: "user-1" },
					clientId: "",
					tokenId: "token-1",
					scopes: [],
				},
				{
					kind: "oauth",
					user: { id: "user-1" },
					clientId: "client-1",
					tokenId: "token-1",
				},
				{
					kind: "oauth",
					user: { id: "user-1" },
					clientId: "client-1",
					tokenId: "token-1",
					scopes: ["allowed", 42],
				},
			]) {
				const held = scopesFromContext(ctxWith(principal));
				expect(held).toBeNull();
				expect(scopeGateAllows(held, [])).toBe(false);
				expect(scopeGateAllows(held, ["allowed"])).toBe(false);
			}
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
					user: { id: "user-1" },
					clientId: "client-1",
					tokenId: "token-1",
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
					ctx: ctxWith({
						kind: "user",
						user: { id: "user-1" },
						session: { id: "session-1" },
					}),
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
			scopeGateAllows(["collections:posts:write"], ["collections:posts:write"]),
		).toBe(true);
		expect(
			scopeGateAllows(
				["collections:posts:delete"],
				["collections:posts:delete"],
			),
		).toBe(true);
		expect(
			scopeGateAllows(
				["globals:siteSettings:read"],
				["globals:siteSettings:read"],
			),
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
			scopeGateAllows(["collections:posts:read"], ["collections:other:read"]),
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
			scopeGateAllows(
				["collections:posts:delete"],
				["collections:posts:delete"],
			),
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
		expect(scopeGateAllows(["globals:read"], ["collections:posts:read"])).toBe(
			false,
		);
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
