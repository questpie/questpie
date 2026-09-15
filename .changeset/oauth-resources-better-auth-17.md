---
"questpie": patch
"@questpie/mcp": patch
"@questpie/admin": patch
"create-questpie": patch
---

Move auth to Better Auth 1.7.4 so OAuth access tokens can only target registered resources (GHSA-p2fr-6hmx-4528).

- The OAuth module gains the 1.7 schema: `oauthResource`, `oauthClientResource` and `oauthClientAssertion`, plus new columns on `oauthClient`, `oauthAccessToken`, `oauthRefreshToken`, `oauthConsent` and `jwks`. Generate and run a migration after upgrading.
- `validAudiences` is gone in Better Auth 1.7. The MCP endpoint (and the CRDT API audience when collaboration is enabled) is now registered through `resources`; per-client resource links are not enforced, so already registered clients keep working.
- An app that supplies its own `oauthProvider()` replaces these defaults: rename `validAudiences` to `resources` and set `enforcePerClientResources: false`, or every existing client fails with `invalid_target` (Better Auth 1.7 enforces per-client links by default).
- Resource rows are only inserted at boot. Removing an audience from config does not disable its row; disable it in `oauthResource`.
- Better Auth 1.7 advertises DPoP. The MCP endpoint still accepts Bearer tokens only, so a DPoP-bound token is refused there.
- A dynamic registration that names no `application_type` and carries a redirect a web client may not use (http, loopback or private-use scheme) is registered as `native`, so local MCP clients can still connect.
- Google and GitHub sign-in verify the provider subject through Better Auth's `accountSubject` instead of the mapped user `id`; stored account ids are unchanged.
- The auth adapter rethrows Postgres' own error for a missing table or a unique violation, so an auth instance built before migrations ran, or two replicas seeding at once, no longer crash on Bun SQL.
