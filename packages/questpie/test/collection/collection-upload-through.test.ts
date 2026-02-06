import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { collection, questpie } from "../../src/server/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

// ==============================================================================
// TEST COLLECTIONS SETUP
// ==============================================================================

// Assets collection with .upload() for URL generation testing
const assets = collection("assets")
  .options({ timestamps: true })
  .fields((f) => ({
    alt: f.text({ maxLength: 500 }),
    caption: f.textarea(),
  }))
  .upload({
    visibility: "public",
  });

// Junction collection for many-to-many uploads
const postAssets = collection("post_assets").fields((f) => ({
  post: f.relation({
    to: "posts",
    required: true,
  }),
  asset: f.relation({
    to: "assets",
    required: true,
  }),
  position: f.number({ default: 0 }),
}));

// Posts collection with upload + through (gallery)
const posts = collection("posts").fields((f) => ({
  title: f.text({ required: true }),
  // Gallery via many-to-many upload
  gallery: f.upload({
    to: "assets",
    through: "post_assets",
    sourceField: "post",
    targetField: "asset",
  }),
}));

const testModule = questpie({ name: "upload-through-test" }).collections({
  assets,
  posts,
  post_assets: postAssets,
});

// ==============================================================================
// TESTS
// ==============================================================================

describe("upload + through (many-to-many)", () => {
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

  describe("metadata inference", () => {
    it("should infer manyToMany relation type for upload with through", async () => {
      const postsCrud = cms.api.collections.posts;
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
      const postsCrud = cms.api.collections.posts;
      const table = postsCrud["~internalRelatedTable"];

      // gallery should not be a column (it's a many-to-many via junction)
      expect(table.gallery).toBeUndefined();
    });
  });

  describe("CRUD operations", () => {
    it("should create post with gallery via set", async () => {
      const ctx = createTestContext();
      const assetsCrud = cms.api.collections.assets;
      const postsCrud = cms.api.collections.posts;

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
      const junctionCrud = cms.api.collections.post_assets;
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
      const assetsCrud = cms.api.collections.assets;
      const postsCrud = cms.api.collections.posts;

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
      const assetsCrud = cms.api.collections.assets;
      const postsCrud = cms.api.collections.posts;

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
      const junctionCrud = cms.api.collections.post_assets;
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
