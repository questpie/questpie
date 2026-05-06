import { describe, expect, it } from "bun:test";

import { localizeAuditTitle } from "../../src/server/modules/audit/config/localize-title.js";

describe("localizeAuditTitle", () => {
	const baseData = {
		action: "create",
		resourceType: "collection",
		resource: "posts",
		resourceLabel: "My Post",
		userName: "Alice",
	};

	it("returns null when no locale is provided", () => {
		expect(localizeAuditTitle(baseData, undefined, null)).toBeNull();
	});

	it("resolves action and resourceType using en messages", () => {
		const result = localizeAuditTitle(baseData, "en", null);
		expect(result).toContain("Alice");
		expect(result).toContain("created");
		expect(result).toContain("collection");
		expect(result).toContain("'My Post'");
	});

	it("resolves action and resourceType using sk messages", () => {
		const result = localizeAuditTitle(baseData, "sk", null);
		expect(result).toContain("Alice");
		expect(result).toContain("vytvoril(a)");
		expect(result).toContain("kolekciu");
		expect(result).toContain("'My Post'");
	});

	it("handles update action in sk", () => {
		const result = localizeAuditTitle(
			{ ...baseData, action: "update" },
			"sk",
			null,
		);
		expect(result).toContain("upravil(a)");
	});

	it("handles delete action in sk", () => {
		const result = localizeAuditTitle(
			{ ...baseData, action: "delete" },
			"sk",
			null,
		);
		expect(result).toContain("zmazal(a)");
	});

	it("handles transition action in sk", () => {
		const result = localizeAuditTitle(
			{ ...baseData, action: "transition" },
			"sk",
			null,
		);
		expect(result).toContain("zmenil(a) stav");
	});

	it("falls back to raw action string for unknown actions", () => {
		const result = localizeAuditTitle(
			{ ...baseData, action: "bulk-email" },
			"en",
			null,
		);
		expect(result).toContain("bulk-email");
	});

	it("shows (bez názvu) for missing resourceLabel in sk", () => {
		const result = localizeAuditTitle(
			{ ...baseData, resourceLabel: null },
			"sk",
			null,
		);
		expect(result).toContain("(bez názvu)");
	});

	it("shows (unnamed) for missing resourceLabel in en", () => {
		const result = localizeAuditTitle(
			{ ...baseData, resourceLabel: "" },
			"en",
			null,
		);
		expect(result).toContain("(unnamed)");
	});

	it("resolves collection admin.label from app context (string)", () => {
		const mockApp = {
			getCollectionConfig: (slug: string) => {
				if (slug === "posts")
					return { state: { admin: { label: "Blog Posts" } } };
				return null;
			},
		};
		const result = localizeAuditTitle(baseData, "en", mockApp);
		expect(result).toContain("Blog Posts");
	});

	it("resolves collection admin.label from app context (locale map)", () => {
		const mockApp = {
			getCollectionConfig: (slug: string) => {
				if (slug === "posts")
					return {
						state: { admin: { label: { en: "Posts", sk: "Príspevky" } } },
					};
				return null;
			},
		};
		const result = localizeAuditTitle(baseData, "sk", mockApp);
		expect(result).toContain("Príspevky");
	});

	it("resolves collection admin.label from app context (i18n key)", () => {
		const mockApp = {
			getCollectionConfig: (slug: string) => {
				if (slug === "posts")
					return {
						state: {
							admin: { label: { key: "audit.collection.label" } },
						},
					};
				return null;
			},
		};
		const result = localizeAuditTitle(baseData, "sk", mockApp);
		// "audit.collection.label" resolves to "Audit log" in sk
		expect(result).toContain("Audit log");
	});

	it("falls back to slug when app is not available", () => {
		const result = localizeAuditTitle(baseData, "en", null);
		expect(result).toContain("posts");
	});

	it("handles global resourceType", () => {
		const data = {
			...baseData,
			resourceType: "global",
			resource: "settings",
		};
		const result = localizeAuditTitle(data, "sk", null);
		expect(result).toContain("globálne nastavenie");
	});

	it("handles cs locale", () => {
		const result = localizeAuditTitle(baseData, "cs", null);
		expect(result).toContain("vytvořil(a)");
		expect(result).toContain("kolekci");
	});

	it("handles de locale", () => {
		const result = localizeAuditTitle(baseData, "de", null);
		expect(result).toContain("erstellte");
		expect(result).toContain("Sammlung");
	});

	it("handles es locale", () => {
		const result = localizeAuditTitle(baseData, "es", null);
		expect(result).toContain("creó");
		expect(result).toContain("colección");
	});

	it("handles pt locale", () => {
		const result = localizeAuditTitle(baseData, "pt", null);
		expect(result).toContain("criou");
		expect(result).toContain("coleção");
	});
});
