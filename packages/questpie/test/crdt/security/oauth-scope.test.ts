import { describe, expect, it } from "bun:test";

import {
	buildCrdtOAuthScopeCatalog,
	oauthCrdtScopesAllow,
} from "../../../src/server/modules/core/integrated/crdt/oauth-scope.js";

const oauthPrincipal = (scopes: string[]) =>
	({
		kind: "oauth",
		user: { id: "user-1" },
		clientId: "client-1",
		tokenId: "token-1",
		scopes,
	}) as any;

describe("CRDT OAuth scope intersection", () => {
	it("maps collection and global view/edit to the shared scope primitives", () => {
		expect(
			oauthCrdtScopesAllow(
				oauthPrincipal(["collections:articles:read"]),
				{ kind: "collection", key: "articles" },
				"view",
			),
		).toBe(true);
		expect(
			oauthCrdtScopesAllow(
				oauthPrincipal(["collections:articles:write"]),
				{ kind: "collection", key: "articles" },
				"edit",
			),
		).toBe(false);
		expect(
			oauthCrdtScopesAllow(
				oauthPrincipal(["collections:read", "collections:write"]),
				{ kind: "collection", key: "articles" },
				"edit",
			),
		).toBe(true);
		expect(
			oauthCrdtScopesAllow(
				oauthPrincipal([
					"globals:siteSettings:read",
					"globals:siteSettings:write",
				]),
				{ kind: "global", key: "siteSettings" },
				"edit",
			),
		).toBe(true);
		expect(
			oauthCrdtScopesAllow(
				oauthPrincipal(["collections:read", "collections:write"]),
				{ kind: "global", key: "siteSettings" },
				"edit",
			),
		).toBe(false);
	});

	it("publishes only scopes for collaborative owners", () => {
		expect(
			buildCrdtOAuthScopeCatalog({
				collections: { articles: {} },
				globals: { siteSettings: {} },
			}),
		).toEqual({
			scopes: [
				"collections:articles:read",
				"collections:read",
				"collections:articles:write",
				"collections:write",
				"globals:siteSettings:read",
				"globals:read",
				"globals:siteSettings:write",
				"globals:write",
			],
			scopesSupported: [
				"collections:read",
				"collections:write",
				"globals:read",
				"globals:write",
			],
		});
	});
});
