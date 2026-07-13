import { describe, expect, it } from "bun:test";

import {
	describeScope,
	describeScopes,
} from "#questpie/admin/client/lib/oauth-scope-descriptions";

describe("describeScope", () => {
	it("describes standard OIDC scopes", () => {
		expect(describeScope("openid")).toBe("Verify your identity");
		expect(describeScope("profile")).toBe(
			"View your basic profile information",
		);
		expect(describeScope("email")).toBe("View your email address");
	});

	it("describes coarse umbrella scopes", () => {
		expect(describeScope("collections:read")).toBe("Read all your collections");
		expect(describeScope("collections:write")).toBe(
			"Create and update all your collections",
		);
	});

	it("describes per-resource collection scopes by pattern", () => {
		expect(describeScope("collections:posts:read")).toBe(
			"Read the Posts collection",
		);
		expect(describeScope("collections:blog_posts:write")).toBe(
			"Create and update the Blog posts collection",
		);
		expect(describeScope("collections:media:delete")).toBe(
			"Delete records in the Media collection",
		);
	});

	it("describes per-resource global and route scopes", () => {
		expect(describeScope("globals:settings:read")).toBe(
			"Read the Settings global",
		);
		expect(describeScope("routes:send_email:invoke")).toBe(
			"Run the Send email action",
		);
	});

	it("falls back to a readable rendering for unknown scopes", () => {
		// Never a blank row — an unrecognised scope is humanized.
		expect(describeScope("something:weird:custom")).toBe(
			"Something weird custom",
		);
		expect(describeScope("mystery")).toBe("Mystery");
	});
});

describe("describeScopes", () => {
	it("parses a space-separated scope string preserving order", () => {
		const result = describeScopes("openid collections:posts:read email");
		expect(result.map((s) => s.scope)).toEqual([
			"openid",
			"collections:posts:read",
			"email",
		]);
		expect(result[1].label).toBe("Read the Posts collection");
	});

	it("de-duplicates and drops empties", () => {
		const result = describeScopes("  openid   openid  email ");
		expect(result.map((s) => s.scope)).toEqual(["openid", "email"]);
	});

	it("returns an empty array for missing input", () => {
		expect(describeScopes(null)).toEqual([]);
		expect(describeScopes(undefined)).toEqual([]);
		expect(describeScopes("")).toEqual([]);
	});
});
