/**
 * MO11 — declarative OAuth scope catalog.
 *
 * The catalog is DERIVED from the app's discovered collections/globals/routes
 * (the same declarative source the MCP scope gate derives from) and merged into
 * the `oauthProvider()` so a real DCR client can request the granular scopes the
 * gate requires — no manual catalog. This unit pins the derivation (adding a
 * collection auto-adds its scopes) and the provider enrichment; the mcp e2e
 * (`packages/mcp/test/oauth-mcp-e2e.test.ts`) exercises the real token → gate path.
 */
import { afterEach, describe, expect, test } from "bun:test";

import { oauthProvider } from "@better-auth/oauth-provider";
import { z } from "zod";

import { collection, global, route } from "../../src/exports/index.js";
import {
	applyOAuthScopeCatalog,
	buildScopeCatalog,
} from "../../src/server/modules/core/integrated/auth/scope-catalog.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";

const posts = collection("posts").fields(({ f }) => ({
	title: f.text(255).required(),
}));
const products = collection("products").fields(({ f }) => ({
	name: f.text(255).required(),
}));
const siteSettings = global("siteSettings").fields(({ f }) => ({
	siteName: f.text(255).required(),
}));

// MCP-exposed JSON route → gets a `routes:<key>:invoke` scope.
const exposedRoute = route()
	.post()
	.schema(z.object({ period: z.enum(["day", "week"]) }))
	.meta({ mcp: { expose: true } })
	.handler(async ({ input }) => ({ period: input.period }));

// Not MCP-exposed → contributes NO scope (matches what the gate registers).
const hiddenRoute = route()
	.post()
	.schema(z.object({ q: z.string() }))
	.handler(async ({ input }) => ({ q: input.q }));

describe("MO11 OAuth scope catalog", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>> | undefined;
	afterEach(async () => {
		await setup?.cleanup?.();
		setup = undefined;
	});

	test("aggregates only exact scopes from explicit package contributors", async () => {
		setup = await buildMockApp({
			collections: { posts, products },
			globals: { siteSettings },
			routes: {
				"reports/generate:POST": exposedRoute,
				"search/run:POST": hiddenRoute,
			},
		});
		expect(buildScopeCatalog(setup.app)).toEqual({
			scopes: [],
			scopesSupported: [],
		});
		setup.app.state = {
			...setup.app.state,
			oauthScopeCatalogs: {
				example: () => ({
					scopes: [
						"collections:posts:read",
						"collections:posts:read",
						"custom:invoke",
					],
					scopesSupported: ["collections:posts:read"],
				}),
			},
		};
		const { scopes, scopesSupported } = buildScopeCatalog(setup.app);

		expect(scopes).toEqual(["collections:posts:read", "custom:invoke"]);
		expect(scopesSupported).toEqual(["collections:posts:read"]);
		expect(scopes).not.toContain("collections:products:read");
		expect(scopes).not.toContain("globals:siteSettings:read");
		expect(scopes).not.toContain("routes:reports/generate:invoke");
	}, 30_000);

	test("unions the catalog into the oauthProvider, preserving its own scopes", async () => {
		setup = await buildMockApp({ collections: { posts } });
		setup.app.state = {
			...setup.app.state,
			oauthScopeCatalogs: {
				example: () => ({
					scopes: ["collections:posts:read"],
					scopesSupported: ["collections:posts:read"],
				}),
			},
		};

		const enriched = applyOAuthScopeCatalog(setup.app, {
			plugins: [oauthProvider({ scopes: ["openid", "custom:keep"] })],
		});
		const provider = enriched.plugins?.find(
			(p) => (p as { id?: string }).id === "oauth-provider",
		) as {
			options: {
				scopes: string[];
				advertisedMetadata: { scopes_supported: string[] };
			};
		};

		// The provider's own scopes survive (OIDC + any user additions)…
		expect(provider.options.scopes).toContain("openid");
		expect(provider.options.scopes).toContain("custom:keep");
		// …and the derived resource scopes are merged in.
		expect(provider.options.scopes).toContain("collections:posts:read");
		expect(provider.options.advertisedMetadata.scopes_supported).toContain(
			"collections:posts:read",
		);
	}, 30_000);

	test("derives collaborative scopes and the shared API audience from the resolved app", async () => {
		setup = await buildMockApp({ collections: { posts } });
		(setup.app as any).crdtRegistry = {
			collections: { posts: {} },
			globals: { siteSettings: {} },
		};
		(setup.app as any).config.app.url = "https://runtime.example.test/root";

		const enriched = applyOAuthScopeCatalog(setup.app, {
			plugins: [
				oauthProvider({
					scopes: ["openid"],
					validAudiences: ["http://localhost:3000/api/mcp"],
				}),
			],
		});
		const provider = enriched.plugins?.find(
			(plugin) => (plugin as { id?: string }).id === "oauth-provider",
		) as {
			options: { scopes: string[]; validAudiences: string[] };
		};

		expect(provider.options.scopes).toEqual(
			expect.arrayContaining([
				"collections:posts:read",
				"collections:posts:write",
				"globals:siteSettings:read",
				"globals:siteSettings:write",
			]),
		);
		expect(provider.options.validAudiences).toContain(
			"https://runtime.example.test",
		);
	}, 30_000);

	test("is a no-op when no oauth-provider is configured", async () => {
		setup = await buildMockApp({ collections: { posts } });
		const authOptions = { plugins: [] };
		expect(applyOAuthScopeCatalog(setup.app, authOptions)).toBe(authOptions);
	}, 30_000);
});
