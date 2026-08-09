import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";

import {
	parseRecipeCatalog,
	recipeCatalogSchema,
} from "../../src/cli/recipes/schema.js";

const fixtureUrl = new URL("./fixtures/recipes/catalog.json", import.meta.url);
const fixture = JSON.parse(await readFile(fixtureUrl, "utf8")) as unknown;

function cloneFixture(): Record<string, unknown> {
	return structuredClone(fixture) as Record<string, unknown>;
}

function firstItem(catalog: Record<string, unknown>): Record<string, unknown> {
	return (catalog.items as Array<Record<string, unknown>>)[0]!;
}

function questpieMeta(item: Record<string, unknown>): Record<string, unknown> {
	return (item.meta as { questpie: Record<string, unknown> }).questpie;
}

describe("QUESTPIE recipe schema", () => {
	it("parses the offline dependency-free route fixture", () => {
		const catalog = parseRecipeCatalog(fixture);

		expect(catalog.items).toHaveLength(1);
		expect(catalog.items[0]!.name).toBe("public-announcements-route");
		expect(catalog.items[0]!.dependencies).toEqual([]);
		expect(catalog.items[0]!.registryDependencies).toEqual([]);
		expect(catalog.items[0]!.meta.questpie.surfaces).toEqual(["server"]);
	});

	it("rejects an unknown schema version", () => {
		const catalog = cloneFixture();
		questpieMeta(firstItem(catalog)).schemaVersion = 2;

		expect(() => parseRecipeCatalog(catalog)).toThrow(
			/recipe "public-announcements-route".*schemaVersion/,
		);
	});

	it("rejects a non-kebab recipe name", () => {
		const catalog = cloneFixture();
		firstItem(catalog).name = "PublicAnnouncements";

		expect(() => parseRecipeCatalog(catalog)).toThrow(/must be kebab-case/);
	});

	it("rejects a non-item registry type", () => {
		const catalog = cloneFixture();
		firstItem(catalog).type = "registry:block";

		expect(() => parseRecipeCatalog(catalog)).toThrow(/items\.0\.type/);
	});

	it("rejects recipe-provided verification commands", () => {
		const catalog = cloneFixture();
		questpieMeta(firstItem(catalog)).verificationProfile = "bun run unsafe";

		expect(() => parseRecipeCatalog(catalog)).toThrow(/verificationProfile/);
	});

	it("rejects an invalid recipe version and compatibility range", () => {
		const invalidVersion = cloneFixture();
		questpieMeta(firstItem(invalidVersion)).recipeVersion = "next";
		expect(() => parseRecipeCatalog(invalidVersion)).toThrow(/recipeVersion/);

		const invalidRange = cloneFixture();
		const compatibility = questpieMeta(firstItem(invalidRange))
			.compatibility as Record<string, unknown>;
		compatibility.questpie = "latest";
		expect(() => parseRecipeCatalog(invalidRange)).toThrow(
			/compatibility\.questpie/,
		);
	});

	it.each(["../outside.ts", "/tmp/outside.ts", "C:/outside.ts"])(
		"rejects unsafe target path %s",
		(target) => {
			const catalog = cloneFixture();
			const item = firstItem(catalog);
			(item.files as Array<Record<string, unknown>>)[0]!.target = target;

			expect(() => parseRecipeCatalog(catalog)).toThrow(/files\.0\.target/);
		},
	);

	it("rejects generated targets", () => {
		const catalog = cloneFixture();
		const item = firstItem(catalog);
		(item.files as Array<Record<string, unknown>>)[0]!.target =
			"src/questpie/server/.generated/recipe.ts";

		expect(() => parseRecipeCatalog(catalog)).toThrow(
			/must not target generated output/,
		);
	});

	it.each([
		"src\\routes\\unsafe.ts",
		".git/hooks/pre-commit",
		".env.local",
		"src/routes/CON.ts",
	])("rejects protected or non-portable target %s", (target) => {
		const catalog = cloneFixture();
		const item = firstItem(catalog);
		(item.files as Array<Record<string, unknown>>)[0]!.target = target;

		expect(() => parseRecipeCatalog(catalog)).toThrow(/files\.0\.target/);
	});

	it("rejects duplicate targets including case-only collisions", () => {
		const catalog = cloneFixture();
		const item = firstItem(catalog);
		const files = item.files as Array<Record<string, unknown>>;
		files.push({
			...files[0],
			target: "src/questpie/server/routes/Public-Announcements.ts",
		});

		expect(() => parseRecipeCatalog(catalog)).toThrow(/duplicates target/);
	});

	it("rejects duplicate recipe identities", () => {
		const catalog = cloneFixture();
		const items = catalog.items as Array<Record<string, unknown>>;
		items.push(structuredClone(items[0]!));

		expect(() => parseRecipeCatalog(catalog)).toThrow(
			/duplicates recipe identity/,
		);
	});

	it("rejects missing compatibility metadata", () => {
		const catalog = cloneFixture();
		delete questpieMeta(firstItem(catalog)).compatibility;

		expect(() => parseRecipeCatalog(catalog)).toThrow(/compatibility/);
	});

	it("keeps standard shadcn envelope fields forward-compatible", () => {
		const catalog = cloneFixture();
		firstItem(catalog).futureRegistryField = { enabled: true };

		const result = recipeCatalogSchema.parse(catalog);
		expect(result.items[0]!.futureRegistryField).toEqual({ enabled: true });
	});
});
