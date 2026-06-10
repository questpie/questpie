import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { collection } from "../../src/exports/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

// ==============================================================================
// TEST COLLECTIONS SETUP
// ==============================================================================

// Assets collection with .upload() for URL generation testing
const assets = collection("assets")
	.options({ timestamps: true })
	.fields(({ f }) => ({
		alt: f.text(500),
		caption: f.textarea(),
	}))
	.upload({
		visibility: "public",
	});

// Junction collection for many-to-many uploads
const postAssets = collection("post_assets").fields(({ f }) => ({
	post: f.relation("posts").required(),
	asset: f.relation("assets").required(),
	position: f.number().default(0),
}));

// Posts collection with upload + through (gallery)
const posts = collection("posts").fields(({ f }) => ({
	title: f.text().required(),
	// Gallery via many-to-many upload
	gallery: f.upload({
		to: "assets",
		through: "post_assets",
		sourceField: "post",
		targetField: "asset",
	}),
}));

// ==============================================================================
// TESTS
// ==============================================================================

describe("upload + through (many-to-many)", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	let app: (typeof setup)["app"];

	beforeEach(async () => {
		setup = await buildMockApp({
			collections: { assets, posts, post_assets: postAssets },
		});
		app = setup.app;
		await runTestDbMigrations(app);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	describe("metadata inference", () => {
		it("should infer manyToMany relation type for upload with through", async () => {
			const postsCrud = app.collections.posts;
			const state = postsCrud["~internalState"];
			const relations = state.relations;

			expect(relations?.gallery).toBeDefined();
			expect(relations?.gallery.type).toBe("manyToMany");
			expect(relations?.gallery.through).toBe("post_assets");
			expect(relations?.gallery.sourceField).toBe("post");
			expect(relations?.gallery.targetField).toBe("asset");
			expect(relations?.gallery.collection).toBe("assets");
		});

		it("should not create a column for upload with through", async () => {
			const postsCrud = app.collections.posts;
			const table = postsCrud["~internalRelatedTable"];

			// gallery should not be a column (it's a many-to-many via junction)
			expect(table.gallery).toBeUndefined();
		});
	});

	describe("CRUD operations", () => {
		it("should create post with gallery via set", async () => {
			const ctx = createTestContext();
			const assetsCrud = app.collections.assets;
			const postsCrud = app.collections.posts;

			// Create assets
			const asset1 = await assetsCrud.create(
				{
					id: crypto.randomUUID(),
					key: "uploads/image1.png",
					filename: "image1.png",
					mimeType: "image/png",
					size: 1000,
					visibility: "public",
				},
				ctx,
			);

			const asset2 = await assetsCrud.create(
				{
					id: crypto.randomUUID(),
					key: "uploads/image2.jpg",
					filename: "image2.jpg",
					mimeType: "image/jpeg",
					size: 2000,
					visibility: "public",
				},
				ctx,
			);

			// Create post with gallery (set operation)
			const post = await postsCrud.create(
				{
					title: "Test Post",
					gallery: { set: [{ id: asset1.id }, { id: asset2.id }] },
				},
				ctx,
			);

			// Verify junction records were created
			const junctionCrud = app.collections.post_assets;
			const junctions = await junctionCrud.find(
				{ where: { post: { eq: post.id } } },
				ctx,
			);

			expect(junctions.docs).toHaveLength(2);
			expect(junctions.docs.map((j) => j.asset)).toContain(asset1.id);
			expect(junctions.docs.map((j) => j.asset)).toContain(asset2.id);
		});

		it("should expand gallery with with clause", async () => {
			const ctx = createTestContext();
			const assetsCrud = app.collections.assets;
			const postsCrud = app.collections.posts;

			// Create assets
			const asset1 = await assetsCrud.create(
				{
					id: crypto.randomUUID(),
					key: "uploads/image1.png",
					filename: "image1.png",
					mimeType: "image/png",
					size: 1000,
					visibility: "public",
				},
				ctx,
			);

			// Create post with gallery
			const post = await postsCrud.create(
				{
					title: "Test Post",
					gallery: { set: [{ id: asset1.id }] },
				},
				ctx,
			);

			// Fetch with expanded gallery
			const postWithGallery = await postsCrud.findOne(
				{ where: { id: { eq: post.id } }, with: { gallery: true } },
				ctx,
			);

			expect(postWithGallery).not.toBeNull();
			expect((postWithGallery as any).gallery).toBeDefined();
			expect((postWithGallery as any).gallery).toHaveLength(1);
			expect((postWithGallery as any).gallery[0].id).toBe(asset1.id);
		});

		it("should update gallery via set", async () => {
			const ctx = createTestContext();
			const assetsCrud = app.collections.assets;
			const postsCrud = app.collections.posts;

			// Create assets
			const asset1 = await assetsCrud.create(
				{
					id: crypto.randomUUID(),
					key: "uploads/image1.png",
					filename: "image1.png",
					mimeType: "image/png",
					size: 1000,
					visibility: "public",
				},
				ctx,
			);

			const asset2 = await assetsCrud.create(
				{
					id: crypto.randomUUID(),
					key: "uploads/image2.jpg",
					filename: "image2.jpg",
					mimeType: "image/jpeg",
					size: 2000,
					visibility: "public",
				},
				ctx,
			);

			const asset3 = await assetsCrud.create(
				{
					id: crypto.randomUUID(),
					key: "uploads/image3.gif",
					filename: "image3.gif",
					mimeType: "image/gif",
					size: 3000,
					visibility: "public",
				},
				ctx,
			);

			// Create post with initial gallery
			const post = await postsCrud.create(
				{
					title: "Test Post",
					gallery: { set: [{ id: asset1.id }, { id: asset2.id }] },
				},
				ctx,
			);

			// Update gallery (replace asset2 with asset3)
			await postsCrud.update(
				{
					where: { id: { eq: post.id } },
					data: { gallery: { set: [{ id: asset1.id }, { id: asset3.id }] } },
				},
				ctx,
			);

			// Verify new junction state
			const junctionCrud = app.collections.post_assets;
			const junctions = await junctionCrud.find(
				{ where: { post: { eq: post.id } } },
				ctx,
			);

			expect(junctions.docs).toHaveLength(2);
			expect(junctions.docs.map((j) => j.asset)).toContain(asset1.id);
			expect(junctions.docs.map((j) => j.asset)).toContain(asset3.id);
			expect(junctions.docs.map((j) => j.asset)).not.toContain(asset2.id);
		});
	});
});

// ==============================================================================
// M2M upload population through parent access (inheritAccess)
// ==============================================================================

const publicPostAssets = collection("public_post_assets").fields(({ f }) => ({
	post: f.relation("public_posts").required(),
	asset: f.relation("assets").required(),
}));

const publicPosts = collection("public_posts")
	.fields(({ f }) => ({
		title: f.text().required(),
		gallery: f.upload({
			to: "assets",
			through: "public_post_assets",
			sourceField: "post",
			targetField: "asset",
		}),
	}))
	.access({ read: true });

describe("upload + through population inherits parent access", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	let app: (typeof setup)["app"];

	beforeEach(async () => {
		setup = await buildMockApp({
			collections: {
				assets,
				public_posts: publicPosts,
				public_post_assets: publicPostAssets,
			},
		});
		app = setup.app;
		await runTestDbMigrations(app);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("populates the gallery for anonymous readers of a public parent", async () => {
		const systemCtx = createTestContext({ accessMode: "system" });
		const anonCtx = createTestContext({ accessMode: "user", session: null });

		const asset = await app.collections.assets.create(
			{
				id: crypto.randomUUID(),
				key: "uploads/gallery-image.png",
				filename: "gallery-image.png",
				mimeType: "image/png",
				size: 1000,
				visibility: "public",
			},
			systemCtx,
		);

		const post = await app.collections.public_posts.create(
			{
				title: "Public Post",
				gallery: { set: [{ id: asset.id }] },
			},
			systemCtx,
		);

		// Neither the assets nor the junction collection is anonymously listable
		// (no .access() → session required)
		await expect(app.collections.assets.find({}, anonCtx)).rejects.toThrow();
		await expect(
			app.collections.public_post_assets.find({}, anonCtx),
		).rejects.toThrow();

		// But the gallery populates through the parent's read decision —
		// junction AND target reads inherit access from the readable parent
		const found = (await app.collections.public_posts.findOne(
			{ where: { id: post.id }, with: { gallery: true } },
			anonCtx,
		)) as any;

		expect(found).not.toBeNull();
		expect(found?.gallery).toHaveLength(1);
		expect(found?.gallery[0]?.id).toBe(asset.id);
		expect(typeof found?.gallery[0]?.url).toBe("string");
	});
});
