/**
 * `oauthModule` composability — the OAuth 2.1 provider + OAuth tables are a
 * self-contained, opt-in unit, NOT welded to the starter/admin.
 *
 * An app using `starterModule` gets OAuth-MCP transitively (starter includes
 * oauthModule) — proven by `packages/mcp/test/oauth-mcp-e2e.test.ts`, which
 * composes `[starterModule, mcpModule]` with no admin. This test proves the OTHER
 * direction: a custom-auth / headless app that does NOT use the starter can add
 * `oauthModule` on top of its own better-auth user model and get exactly the
 * OAuth provider + the five OAuth tables — nothing from admin.
 */
import { describe, expect, test } from "bun:test";

import { collection, oauthModule } from "../../src/exports/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";

// The "custom auth" user model a headless app brings itself (stand-in). oauthModule
// stores `userId` as plain text, so it has no hard schema dependency on this.
const user = collection("user").fields(({ f }) => ({
	email: f.text(255).required(),
}));

describe("oauthModule composability (headless / custom-auth)", () => {
	test("contributes the OAuth provider + jwt and the five OAuth tables, with no starter/admin", async () => {
		const setup = await buildMockApp({
			modules: [oauthModule],
			collections: { user },
		});
		try {
			// The OAuth tables come from oauthModule.
			const collections = Object.keys(setup.app.getCollections());
			for (const table of [
				"jwks",
				"oauthClient",
				"oauthAccessToken",
				"oauthRefreshToken",
				"oauthConsent",
			]) {
				expect(collections).toContain(table);
			}

			// The OAuth provider + jwt plugins come from oauthModule's config/auth.ts;
			// the admin plugin (starter-only) is absent.
			const plugins = (setup.app.config.auth?.plugins ?? []) as Array<{
				id?: string;
			}>;
			const ids = plugins.map((p) => p?.id);
			expect(ids).toContain("oauth-provider");
			expect(ids).toContain("jwt");
			expect(ids).not.toContain("admin");
		} finally {
			await setup.cleanup();
		}
	}, 30_000);
});
