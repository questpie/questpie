import { expect, test } from "bun:test";

import { defineCredentialResolver } from "../../packages/questpie/src/credential-resolver";
import { defineService } from "../../packages/questpie/src/service";

const service = defineService({
	name: "credentialChallengeService",
	lifetime: "application",
	effect: "external",
	dependencies: {},
	create: async () => ({}),
});

test("a static string challenge normalizes to a Request-independent function", () => {
	const resolver = defineCredentialResolver({
		name: "static",
		service,
		resolve: async () => ({ kind: "anonymous" }),
		challenge:
			'Bearer resource_metadata="https://example.test/.well-known/oauth-protected-resource"',
	});
	expect(typeof resolver.challenge).toBe("function");
	expect(
		resolver.challenge!(new Request("https://example.test/_questpie/mcp")),
	).toBe(
		'Bearer resource_metadata="https://example.test/.well-known/oauth-protected-resource"',
	);
});

test("a function challenge is preserved and may vary per Request, including returning undefined", () => {
	const resolver = defineCredentialResolver({
		name: "dynamic",
		service,
		resolve: async () => ({ kind: "anonymous" }),
		challenge: (request) =>
			new URL(request.url).hostname === "example.test" ? "Bearer" : undefined,
	});
	expect(
		resolver.challenge!(new Request("https://example.test/_questpie/mcp")),
	).toBe("Bearer");
	expect(
		resolver.challenge!(new Request("https://other.test/_questpie/mcp")),
	).toBeUndefined();
});

test("omitting challenge, protectCatalog, and requireCredential keeps all three absent, preserving today's default", () => {
	const resolver = defineCredentialResolver({
		name: "default",
		service,
		resolve: async () => ({ kind: "anonymous" }),
	});
	expect(resolver.challenge).toBeUndefined();
	expect(resolver.protectCatalog).toBeUndefined();
	expect(resolver.requireCredential).toBeUndefined();
});

test("protectCatalog is preserved verbatim as an explicit opt-in, never inferred", () => {
	const resolver = defineCredentialResolver({
		name: "protected",
		service,
		resolve: async () => ({ kind: "anonymous" }),
		protectCatalog: true,
	});
	expect(resolver.protectCatalog).toBe(true);
});

test("requireCredential is preserved verbatim as an explicit opt-in, independent of challenge or protectCatalog", () => {
	const resolver = defineCredentialResolver({
		name: "callsRequireCredential",
		service,
		resolve: async () => ({ kind: "anonymous" }),
		requireCredential: true,
	});
	expect(resolver.requireCredential).toBe(true);
	expect(resolver.challenge).toBeUndefined();
	expect(resolver.protectCatalog).toBeUndefined();
});
