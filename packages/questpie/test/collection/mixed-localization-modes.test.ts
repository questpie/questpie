import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { defaultFields } from "../../src/server/fields/builtin/defaults.js";
import { questpie } from "../../src/server/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

/**
 * Test collection with mixed localization modes:
 * - Flat field (text) - entire column is localized (localized: true on primitive)
 * - JSONB whole-mode - entire JSONB object per locale (localized: true on json field)
 * - JSONB nested-mode - nested fields with localized: true in field definitions
 *
 * This tests that different localization strategies can coexist in one collection.
 *
 * Note: The localization system uses field definition schemas to know which
 * nested fields are localized. No $i18n wrappers needed from client.
 */

type TipTapContent = {
	type: "doc";
	content: Array<{
		type: string;
		content?: Array<{
			type: string;
			text?: string;
		}>;
	}>;
};

const q = questpie({ name: "mixed-modes-test" }).fields(defaultFields);

const products = q
	.collection("products")
	.fields((f) => ({
		name: f.text({ required: true, maxLength: 255, localized: true }), // flat localized
		description: f.json({ localized: true }), // whole-mode JSONB
		// nested-mode JSONB - uses object field with localized nested fields
		metadata: f.object({
			fields: {
				sku: f.text(), // static
				category: f.text({ localized: true }), // localized
				slogan: f.text({ localized: true }), // localized
				brand: f.text(), // static
			},
		}),
	}))
	.options({
		timestamps: true,
	});

const testModule = q.collections({
	products,
});

describe("mixed localization modes", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp<typeof testModule>>>;

	beforeEach(async () => {
		setup = await buildMockApp(testModule);
		await runTestDbMigrations(setup.cms);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("handles all three localization modes in one collection", async () => {
		const ctxEN = createTestContext({ locale: "en" });

		// Flat field
		const nameEN = "Premium Shampoo";

		// JSONB whole-mode (TipTap)
		const descriptionEN: TipTapContent = {
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [
						{ type: "text", text: "Natural ingredients for healthy hair." },
					],
				},
			],
		};

		// JSONB nested-mode (plain data, schema determines what's localized)
		const metadataEN = {
			sku: "SH-001", // static
			category: "Hair Care", // localized (server knows from schema)
		};

		const created = await setup.cms.api.collections.products.create(
			{
				name: nameEN,
				description: descriptionEN,
				metadata: metadataEN,
			},
			ctxEN,
		);

		expect(created.name).toBe(nameEN);
		expect(created.description).toEqual(descriptionEN);
		// Type assertion needed due to JSONB type inference
		const metadata = created.metadata as any;
		expect(metadata.sku).toBe("SH-001"); // static preserved
		expect(metadata.category).toBe("Hair Care"); // localized extracted and merged back
	});

	it("updates different locales independently for each mode", async () => {
		const ctxEN = createTestContext({ locale: "en" });
		const ctxSK = createTestContext({ locale: "sk" });

		// Create in EN
		const created = await setup.cms.api.collections.products.create(
			{
				name: "Hair Gel",
				description: {
					type: "doc",
					content: [
						{
							type: "paragraph",
							content: [{ type: "text", text: "Strong hold all day." }],
						},
					],
				},
				metadata: {
					sku: "HG-001",
					category: "Styling",
				},
			},
			ctxEN,
		);

		// Update SK locale
		await setup.cms.api.collections.products.updateById(
			{
				id: created.id,
				data: {
					name: "Gél na vlasy",
					description: {
						type: "doc",
						content: [
							{
								type: "paragraph",
								content: [{ type: "text", text: "Silné držanie celý deň." }],
							},
						],
					},
					metadata: {
						sku: "HG-001", // static unchanged
						category: "Štýlovanie",
					},
				},
			},
			ctxSK,
		);

		// Read in EN
		const enProduct = await setup.cms.api.collections.products.findOne(
			{ where: { id: created.id } },
			ctxEN,
		);
		expect(enProduct?.name).toBe("Hair Gel");
		expect(
			(enProduct?.description as any)?.content[0]?.content?.[0]?.text,
		).toBe("Strong hold all day.");
		expect((enProduct?.metadata as any).category).toBe("Styling");

		// Read in SK
		const skProduct = await setup.cms.api.collections.products.findOne(
			{ where: { id: created.id } },
			ctxSK,
		);
		expect(skProduct?.name).toBe("Gél na vlasy");
		expect(
			(skProduct?.description as any)?.content[0]?.content?.[0]?.text,
		).toBe("Silné držanie celý deň.");
		expect((skProduct?.metadata as any).category).toBe("Štýlovanie");
	});

	it("falls back correctly for each mode", async () => {
		const ctxEN = createTestContext({ locale: "en" });
		const ctxDE = createTestContext({ locale: "de" });

		// Create in EN only
		const created = await setup.cms.api.collections.products.create(
			{
				name: "Conditioner",
				description: {
					type: "doc",
					content: [
						{
							type: "paragraph",
							content: [{ type: "text", text: "Moisturizing formula." }],
						},
					],
				},
				metadata: {
					brand: "SharpCuts",
					slogan: "The best for your hair",
				},
			},
			ctxEN,
		);

		// Read in DE (no translation) - should fallback to EN for all modes
		const deProduct = await setup.cms.api.collections.products.findOne(
			{ where: { id: created.id } },
			ctxDE,
		);

		// All should fallback to EN
		expect(deProduct?.name).toBe("Conditioner"); // flat field fallback
		expect(
			(deProduct?.description as any)?.content[0]?.content?.[0]?.text,
		).toBe("Moisturizing formula."); // whole-mode JSONB fallback
		expect((deProduct?.metadata as any).slogan).toBe("The best for your hair"); // nested-mode fallback
	});

	it("preserves static values in nested-mode while localizing marked fields", async () => {
		const ctx = createTestContext({ locale: "en" });

		const created = await setup.cms.api.collections.products.create(
			{
				name: "Test Product",
				metadata: {
					sku: "TP-001", // static
					brand: "TestBrand", // static
					category: "Test Category", // localized
					slogan: "Best product ever", // localized
				},
			},
			ctx,
		);

		const createdMeta = created.metadata as any;
		expect(createdMeta.sku).toBe("TP-001"); // static preserved
		expect(createdMeta.brand).toBe("TestBrand"); // static preserved
		expect(createdMeta.category).toBe("Test Category"); // localized
		expect(createdMeta.slogan).toBe("Best product ever"); // localized
	});

	it("handles null values for each mode", async () => {
		const ctx = createTestContext({ locale: "en" });

		const created = await setup.cms.api.collections.products.create(
			{
				name: "Minimal Product",
				description: null, // null whole-mode JSONB
				metadata: null, // null nested-mode JSONB
			},
			ctx,
		);

		expect(created.description).toBeNull();
		expect(created.metadata).toBeNull();
	});

	it("updates only one locale without affecting whole-mode JSONB in other locales", async () => {
		const ctxEN = createTestContext({ locale: "en" });
		const ctxSK = createTestContext({ locale: "sk" });
		const ctxDE = createTestContext({ locale: "de" });

		const descEN: TipTapContent = {
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [{ type: "text", text: "EN paragraph 1" }],
				},
				{
					type: "paragraph",
					content: [{ type: "text", text: "EN paragraph 2" }],
				},
			],
		};

		const descSK: TipTapContent = {
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [{ type: "text", text: "SK paragraph 1" }],
				},
			],
		};

		const descDE: TipTapContent = {
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [{ type: "text", text: "DE paragraph 1" }],
				},
				{
					type: "paragraph",
					content: [{ type: "text", text: "DE paragraph 2" }],
				},
				{
					type: "paragraph",
					content: [{ type: "text", text: "DE paragraph 3" }],
				},
			],
		};

		// Create in EN
		const created = await setup.cms.api.collections.products.create(
			{
				name: "Multi Desc",
				description: descEN,
			},
			ctxEN,
		);

		// Add SK
		await setup.cms.api.collections.products.updateById(
			{
				id: created.id,
				data: {
					name: "Multi Desc SK",
					description: descSK,
				},
			},
			ctxSK,
		);

		// Add DE
		await setup.cms.api.collections.products.updateById(
			{
				id: created.id,
				data: {
					name: "Multi Desc DE",
					description: descDE,
				},
			},
			ctxDE,
		);

		// Verify each locale has its own structure
		const enProduct = await setup.cms.api.collections.products.findOne(
			{ where: { id: created.id } },
			ctxEN,
		);
		expect((enProduct?.description as any)?.content).toHaveLength(2); // EN has 2 paragraphs

		const skProduct = await setup.cms.api.collections.products.findOne(
			{ where: { id: created.id } },
			ctxSK,
		);
		expect((skProduct?.description as any)?.content).toHaveLength(1); // SK has 1 paragraph

		const deProduct = await setup.cms.api.collections.products.findOne(
			{ where: { id: created.id } },
			ctxDE,
		);
		expect((deProduct?.description as any)?.content).toHaveLength(3); // DE has 3 paragraphs
	});
});
