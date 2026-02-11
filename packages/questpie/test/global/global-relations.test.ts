import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { defaultFields } from "../../src/server/fields/builtin/defaults.js";
import { questpie } from "../../src/server/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

const q = questpie({ name: "test-module" }).fields(defaultFields);

// Assets collection (target of many-to-many)
const assets = q.collection("assets").fields((f) => ({
	filename: f.text({ required: true, maxLength: 255 }),
	mimeType: f.text({ maxLength: 100 }),
}));

// Junction table for candle settings images
const candleSettingsImages = q
	.collection("candle_settings_images")
	.fields((f) => ({
		candleSettings: f.relation({
			to: "candle_settings",
			required: true,
			onDelete: "cascade",
		}),
		asset: f.relation({
			to: "assets",
			required: true,
			onDelete: "cascade",
		}),
		order: f.number({ default: 0 }),
	}));

// Candle settings global with many-to-many relation
const candleSettings = q.global("candle_settings").fields((f) => ({
	pageTitle: f.text({
		required: true,
		maxLength: 255,
		default: "Zapal svíčku",
	}),
	pageDescription: f.textarea({ default: "Test description" }),
	images: f.relation({
		to: "assets",
		hasMany: true,
		through: "candle_settings_images",
		sourceField: "candleSettings", // FK column key (field name with unified API)
		targetField: "asset", // FK column key (field name with unified API)
	}),
}));

const testModule = q
	.collections({
		assets,
		candle_settings_images: candleSettingsImages,
	})
	.globals({
		candle_settings: candleSettings,
	});

describe("global many-to-many relations", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp<typeof testModule>>>;
	let cms: typeof testModule.$inferCms;

	beforeEach(async () => {
		setup = await buildMockApp(testModule);
		cms = setup.cms;
		await runTestDbMigrations(cms);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("should resolve many-to-many relations when querying global with 'with'", async () => {
		const ctx = createTestContext({ accessMode: "system" });

		// Create some assets
		const asset1 = await cms.api.collections.assets.create(
			{
				id: crypto.randomUUID(),
				filename: "image1.jpg",
				mimeType: "image/jpeg",
			},
			ctx,
		);
		const asset2 = await cms.api.collections.assets.create(
			{
				id: crypto.randomUUID(),
				filename: "image2.jpg",
				mimeType: "image/jpeg",
			},
			ctx,
		);

		// Initialize the global (this will auto-create a record)
		const settings = await cms.api.globals.candle_settings.update(
			{
				pageTitle: "Test Title",
			},
			ctx,
		);

		// Manually create junction records (since global CRUD doesn't support many-to-many mutations yet)
		const settingsId = (settings as any).id;
		await (cms as any).api.collections.candle_settings_images.create(
			{
				id: crypto.randomUUID(),
				candleSettings: settingsId, // FK column key is field name with unified API
				asset: asset1.id,
				order: 0,
			},
			ctx,
		);
		await (cms as any).api.collections.candle_settings_images.create(
			{
				id: crypto.randomUUID(),
				candleSettings: settingsId,
				asset: asset2.id,
				order: 1,
			},
			ctx,
		);

		// Now query the global WITH the relation
		const settingsWithImages = await cms.api.globals.candle_settings.get(
			{ with: { images: true } },
			ctx,
		);

		// This test will help us identify if the issue is in resolution or mutations
		console.log(
			"Settings with images:",
			JSON.stringify(settingsWithImages, null, 2),
		);

		// Expect images to be resolved
		expect(settingsWithImages?.images).toBeDefined();
		expect(settingsWithImages?.images).toHaveLength(2);
		expect(
			settingsWithImages?.images?.map((img: any) => img.filename).sort(),
		).toEqual(["image1.jpg", "image2.jpg"]);
	});

	it("should support filtering global queries by many-to-many relation (via WHERE)", async () => {
		const ctx = createTestContext({ accessMode: "system" });

		// Create assets
		const asset1 = await cms.api.collections.assets.create(
			{
				id: crypto.randomUUID(),
				filename: "special.jpg",
				mimeType: "image/jpeg",
			},
			ctx,
		);

		// Initialize global
		const settings = await cms.api.globals.candle_settings.update(
			{
				pageTitle: "Special Title",
			},
			ctx,
		);

		// Create junction record
		await (cms as any).api.collections.candle_settings_images.create(
			{
				id: crypto.randomUUID(),
				candleSettings: (settings as any).id,
				asset: asset1.id,
				order: 0,
			},
			ctx,
		);

		// Try to query global - globals have only one record so filtering doesn't make much sense,
		// but we should at least be able to get it with the relation
		const settingsWithImages = await cms.api.globals.candle_settings.get(
			{
				with: {
					images: {
						where: { filename: "special.jpg" },
					},
				},
			},
			ctx,
		);

		expect(settingsWithImages?.images).toBeDefined();
		expect(settingsWithImages?.images).toHaveLength(1);
		expect((settingsWithImages?.images as any[])[0].filename).toBe(
			"special.jpg",
		);
	});

	describe("nested mutations", () => {
		it("should connect existing assets via many-to-many relation", async () => {
			const ctx = createTestContext({ accessMode: "system" });

			// Create assets first
			const asset1 = await cms.api.collections.assets.create(
				{
					id: crypto.randomUUID(),
					filename: "connected1.jpg",
					mimeType: "image/jpeg",
				},
				ctx,
			);
			const asset2 = await cms.api.collections.assets.create(
				{
					id: crypto.randomUUID(),
					filename: "connected2.jpg",
					mimeType: "image/jpeg",
				},
				ctx,
			);

			// Update global with connect operation
			await cms.api.globals.candle_settings.update(
				{
					pageTitle: "With Connected Images",
					images: {
						connect: [{ id: asset1.id }, { id: asset2.id }],
					},
				},
				ctx,
			);

			// Verify by querying
			const settingsWithImages = await cms.api.globals.candle_settings.get(
				{ with: { images: true } },
				ctx,
			);

			expect(settingsWithImages?.images).toHaveLength(2);
			const filenames = (settingsWithImages?.images as any[])
				.map((img: any) => img.filename)
				.sort();
			expect(filenames).toEqual(["connected1.jpg", "connected2.jpg"]);
		});

		it("should create new assets via many-to-many relation", async () => {
			const ctx = createTestContext({ accessMode: "system" });

			// Update global with create operation
			await cms.api.globals.candle_settings.update(
				{
					pageTitle: "With Created Images",
					images: {
						create: [
							{ filename: "created1.png", mimeType: "image/png" },
							{ filename: "created2.png", mimeType: "image/png" },
						],
					},
				},
				ctx,
			);

			// Verify by querying
			const settingsWithImages = await cms.api.globals.candle_settings.get(
				{ with: { images: true } },
				ctx,
			);

			expect(settingsWithImages?.images).toHaveLength(2);
			const filenames = (settingsWithImages?.images as any[])
				.map((img: any) => img.filename)
				.sort();
			expect(filenames).toEqual(["created1.png", "created2.png"]);
		});

		it("should support connectOrCreate operation", async () => {
			const ctx = createTestContext({ accessMode: "system" });

			// Create one existing asset
			const existingAsset = await cms.api.collections.assets.create(
				{
					id: crypto.randomUUID(),
					filename: "existing.jpg",
					mimeType: "image/jpeg",
				},
				ctx,
			);

			// Update global with connectOrCreate (one existing, one new)
			await cms.api.globals.candle_settings.update(
				{
					pageTitle: "With ConnectOrCreate",
					images: {
						connectOrCreate: [
							{
								where: { id: existingAsset.id },
								create: { filename: "existing.jpg", mimeType: "image/jpeg" },
							},
							{
								where: { filename: "new-asset.jpg" } as any,
								create: { filename: "new-asset.jpg", mimeType: "image/jpeg" },
							},
						],
					},
				},
				ctx,
			);

			// Verify by querying
			const settingsWithImages = await cms.api.globals.candle_settings.get(
				{ with: { images: true } },
				ctx,
			);

			expect(settingsWithImages?.images).toHaveLength(2);
			const filenames = (settingsWithImages?.images as any[])
				.map((img: any) => img.filename)
				.sort();
			expect(filenames).toEqual(["existing.jpg", "new-asset.jpg"]);

			// Verify only 2 assets exist in total (not 3)
			const allAssets = await cms.api.collections.assets.find({}, ctx);
			expect(allAssets.docs).toHaveLength(2);
		});

		it("should support plain array of IDs (admin form pattern)", async () => {
			const ctx = createTestContext({ accessMode: "system" });

			// Create assets
			const asset1 = await cms.api.collections.assets.create(
				{
					id: crypto.randomUUID(),
					filename: "plain1.jpg",
					mimeType: "image/jpeg",
				},
				ctx,
			);
			const asset2 = await cms.api.collections.assets.create(
				{
					id: crypto.randomUUID(),
					filename: "plain2.jpg",
					mimeType: "image/jpeg",
				},
				ctx,
			);

			// Update global with plain array of IDs
			await cms.api.globals.candle_settings.update(
				{
					pageTitle: "With Plain IDs",
					images: [asset1.id, asset2.id],
				} as any,
				ctx,
			);

			// Verify by querying
			const settingsWithImages = await cms.api.globals.candle_settings.get(
				{ with: { images: true } },
				ctx,
			);

			expect(settingsWithImages?.images).toHaveLength(2);
			const filenames = (settingsWithImages?.images as any[])
				.map((img: any) => img.filename)
				.sort();
			expect(filenames).toEqual(["plain1.jpg", "plain2.jpg"]);
		});

		it("should support set operation to replace relations", async () => {
			const ctx = createTestContext({ accessMode: "system" });

			// Create initial assets
			const asset1 = await cms.api.collections.assets.create(
				{
					id: crypto.randomUUID(),
					filename: "old1.jpg",
					mimeType: "image/jpeg",
				},
				ctx,
			);
			const asset2 = await cms.api.collections.assets.create(
				{
					id: crypto.randomUUID(),
					filename: "old2.jpg",
					mimeType: "image/jpeg",
				},
				ctx,
			);
			const asset3 = await cms.api.collections.assets.create(
				{
					id: crypto.randomUUID(),
					filename: "new1.jpg",
					mimeType: "image/jpeg",
				},
				ctx,
			);

			// First connect two assets
			await cms.api.globals.candle_settings.update(
				{
					pageTitle: "With Old Images",
					images: { connect: [{ id: asset1.id }, { id: asset2.id }] },
				},
				ctx,
			);

			// Then replace with set operation
			await cms.api.globals.candle_settings.update(
				{
					pageTitle: "With New Images",
					images: { set: [{ id: asset3.id }] } as any,
				},
				ctx,
			);

			// Verify only new asset is connected
			const settingsWithImages = await cms.api.globals.candle_settings.get(
				{ with: { images: true } },
				ctx,
			);

			expect(settingsWithImages?.images).toHaveLength(1);
			expect((settingsWithImages?.images as any[])[0].filename).toBe(
				"new1.jpg",
			);
		});

		it("should preserve junction table extra fields", async () => {
			const ctx = createTestContext({ accessMode: "system" });

			// Create asset
			const asset = await cms.api.collections.assets.create(
				{
					id: crypto.randomUUID(),
					filename: "ordered.jpg",
					mimeType: "image/jpeg",
				},
				ctx,
			);

			// Initialize global and connect asset
			const settings = await cms.api.globals.candle_settings.update(
				{
					pageTitle: "With Ordered Images",
					images: { connect: [{ id: asset.id }] },
				},
				ctx,
			);

			// Manually update junction with order
			await (cms as any).api.collections.candle_settings_images.update(
				{
					where: {
						AND: [
							{ candleSettings: (settings as any).id },
							{ asset: asset.id },
						],
					},
					data: { order: 10 },
				},
				ctx,
			);

			// Verify extra field is preserved
			const junctionRecords = await (
				cms as any
			).api.collections.candle_settings_images.find(
				{ where: { candleSettings: (settings as any).id } },
				ctx,
			);

			expect(junctionRecords.docs).toHaveLength(1);
			expect((junctionRecords.docs[0] as any).order).toBe(10);
		});

		it("should handle empty array to remove all relations", async () => {
			const ctx = createTestContext({ accessMode: "system" });

			// Create assets
			const asset1 = await cms.api.collections.assets.create(
				{
					id: crypto.randomUUID(),
					filename: "remove1.jpg",
					mimeType: "image/jpeg",
				},
				ctx,
			);
			const asset2 = await cms.api.collections.assets.create(
				{
					id: crypto.randomUUID(),
					filename: "remove2.jpg",
					mimeType: "image/jpeg",
				},
				ctx,
			);

			// Initialize global with assets
			await cms.api.globals.candle_settings.update(
				{
					pageTitle: "With Images To Remove",
					images: { connect: [{ id: asset1.id }, { id: asset2.id }] },
				},
				ctx,
			);

			// Verify images are connected
			let settings = await cms.api.globals.candle_settings.get(
				{ with: { images: true } },
				ctx,
			);
			expect(settings?.images).toHaveLength(2);

			// Remove all with empty set
			await cms.api.globals.candle_settings.update(
				{
					pageTitle: "Without Images",
					images: { set: [] } as any,
				},
				ctx,
			);

			// Verify no images remain
			settings = await cms.api.globals.candle_settings.get(
				{ with: { images: true } },
				ctx,
			);
			expect(settings?.images).toHaveLength(0);
		});
	});
});
