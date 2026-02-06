import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { defaultFields } from "../../src/server/fields/builtin/defaults.js";
import { questpie } from "../../src/server/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

// Create questpie builder with default fields
const q = questpie({ name: "test-module" }).fields(defaultFields);

const products = q
  .collection("products")
  .fields((f) => ({
    sku: f.text({ required: true, maxLength: 50 }),
    name: f.text({ required: true, localized: true }),
    description: f.text({ localized: true }),
  }))
  .title(({ f }) => f.name)
  .options({
    timestamps: true,
    softDelete: true,
    versioning: true,
  });

// Collection without .title() - should fallback _title to id
const simple_items = q
  .collection("simple_items")
  .fields((f) => ({
    name: f.text({ required: true }),
    description: f.text(),
  }))
  .options({
    timestamps: true,
  });

const locked_products = q
  .collection("locked_products")
  .fields((f) => ({
    sku: f.text({ required: true, maxLength: 50 }),
    name: f.text({ required: true, localized: true }),
  }))
  .title(({ f }) => f.name)
  .options({
    timestamps: true,
    softDelete: true,
    versioning: true,
  })
  .access({
    create: () => false,
  });

const testModule = q.collections({
  products,
  simple_items,
  locked_products,
});

describe("collection CRUD", () => {
  let setup: Awaited<ReturnType<typeof buildMockApp<typeof testModule>>>;

  beforeEach(async () => {
    setup = await buildMockApp(testModule);
    await runTestDbMigrations(setup.cms);
  });

  afterEach(async () => {
    await setup.cleanup();
  });

  it("creates, updates localized fields, and falls back to default locale", async () => {
    const ctx = createTestContext();

    const created = await setup.cms.api.collections.products.create(
      {
        id: crypto.randomUUID(),
        sku: "sku-1",
        name: "Name EN",
        description: "Desc EN",
      },
      ctx,
    );

    await setup.cms.api.collections.products.updateById(
      {
        id: created.id,
        data: { name: "Nazov SK" },
      },
      createTestContext({ locale: "sk" }),
    );

    const skRow = await setup.cms.api.collections.products.findOne(
      { where: { id: created.id } },
      createTestContext({ locale: "sk" }),
    );
    expect(skRow?.name).toBe("Nazov SK");

    const deRow = await setup.cms.api.collections.products.findOne(
      { where: { id: created.id } },
      createTestContext({ locale: "de" }),
    );
    expect(deRow?.name).toBe("Name EN");
  });

  it("soft delete hides rows from find", async () => {
    const ctx = createTestContext();

    const created = await setup.cms.api.collections.products.create(
      {
        id: crypto.randomUUID(),
        sku: "sku-2",
        name: "Name EN",
      },
      ctx,
    );

    await setup.cms.api.collections.products.deleteById(
      { id: created.id },
      ctx,
    );

    const rows = await setup.cms.api.collections.products.find({}, ctx);
    expect(rows.docs.length).toBe(0);
    expect(rows.totalDocs).toBe(0);
  });

  it("system access mode bypasses access rules", async () => {
    const _ctx = createTestContext();

    await expect(
      setup.cms.api.collections.locked_products.create(
        {
          id: crypto.randomUUID(),
          sku: "sku-3",
          name: "Locked",
        },
        createTestContext({ accessMode: "user" }),
      ),
    ).rejects.toThrow("User does not have permission to create records");

    const created = await setup.cms.api.collections.locked_products.create(
      {
        id: crypto.randomUUID(),
        sku: "sku-4",
        name: "System",
      },
      createTestContext({ accessMode: "system" }),
    );
    expect(created.sku).toBe("sku-4");
  });

  it("records versions on create, update, and delete", async () => {
    const ctx = createTestContext();

    const created = await setup.cms.api.collections.products.create(
      {
        id: crypto.randomUUID(),
        sku: "sku-5",
        name: "Name EN",
      },
      ctx,
    );

    await setup.cms.api.collections.products.updateById(
      {
        id: created.id,
        data: { sku: "sku-5b" },
      },
      ctx,
    );

    await setup.cms.api.collections.products.deleteById(
      { id: created.id },
      ctx,
    );

    const versions = await setup.cms.api.collections.products.findVersions(
      { id: created.id },
      ctx,
    );
    expect(versions.length).toBe(3);
  });

  it("returns _title field when collection has .title() defined", async () => {
    const ctx = createTestContext();

    // Create a product
    const created = await setup.cms.api.collections.products.create(
      {
        id: crypto.randomUUID(),
        sku: "TITLE-TEST",
        name: "Test Product",
      },
      ctx,
    );

    // _title should be returned on create (now just name, not virtual)
    expect(created._title).toBeDefined();
    expect(created._title).toBe("Test Product");

    // _title should be returned on findOne
    const found = await setup.cms.api.collections.products.findOne(
      { where: { id: created.id } },
      ctx,
    );
    expect(found?._title).toBe("Test Product");

    // _title should be returned on find (list)
    const list = await setup.cms.api.collections.products.find(
      { where: { id: created.id } },
      ctx,
    );
    expect(list.docs[0]._title).toBe("Test Product");

    // _title should be returned on updateById
    const updated = await setup.cms.api.collections.products.updateById(
      {
        id: created.id,
        data: { name: "Updated Product" },
      },
      ctx,
    );
    expect(updated._title).toBe("Updated Product");
  });

  it("returns _title field falling back to id when collection has no .title() defined", async () => {
    const ctx = createTestContext();
    const id = crypto.randomUUID();

    // Create a simple item (collection without .title())
    const created = await setup.cms.api.collections.simple_items.create(
      {
        id,
        name: "Simple Item",
        description: "A simple test item",
      },
      ctx,
    );

    // _title should be returned and should equal the id
    expect(created._title).toBeDefined();
    expect(created._title).toBe(id);

    // _title should be returned on findOne
    const found = await setup.cms.api.collections.simple_items.findOne(
      { where: { id: created.id } },
      ctx,
    );
    expect(found?._title).toBe(id);

    // _title should be returned on find (list)
    const list = await setup.cms.api.collections.simple_items.find(
      { where: { id: created.id } },
      ctx,
    );
    expect(list.docs[0]._title).toBe(id);

    // _title should be returned on updateById
    const updated = await setup.cms.api.collections.simple_items.updateById(
      {
        id: created.id,
        data: { name: "Updated Simple Item" },
      },
      ctx,
    );
    expect(updated._title).toBe(id);
  });

  it("filters by _title when search parameter is provided", async () => {
    const ctx = createTestContext();

    // Create multiple products with different titles
    await setup.cms.api.collections.products.create(
      {
        id: crypto.randomUUID(),
        sku: "ALPHA-001",
        name: "Alpha Product",
      },
      ctx,
    );

    await setup.cms.api.collections.products.create(
      {
        id: crypto.randomUUID(),
        sku: "BETA-002",
        name: "Beta Product",
      },
      ctx,
    );

    await setup.cms.api.collections.products.create(
      {
        id: crypto.randomUUID(),
        sku: "GAMMA-003",
        name: "Gamma Product",
      },
      ctx,
    );

    // Search for "Alpha" - should match title "Alpha Product"
    const alphaResults = await setup.cms.api.collections.products.find(
      { search: "Alpha" } as any,
      ctx,
    );
    expect(alphaResults.docs.length).toBe(1);
    expect((alphaResults.docs[0] as any)._title).toContain("Alpha");

    // Search for "Beta" - should match title "Beta Product"
    const betaResults = await setup.cms.api.collections.products.find(
      { search: "Beta" } as any,
      ctx,
    );
    expect(betaResults.docs.length).toBe(1);
    expect((betaResults.docs[0] as any)._title).toContain("Beta");

    // Search for "Product" - should match all 3 products
    const allResults = await setup.cms.api.collections.products.find(
      { search: "Product" } as any,
      ctx,
    );
    expect(allResults.docs.length).toBe(3);

    // Search for "XYZ" - should return no results
    const noResults = await setup.cms.api.collections.products.find(
      { search: "XYZ" } as any,
      ctx,
    );
    expect(noResults.docs.length).toBe(0);
  });

  it("updates multiple records (updateMany) and returns full updated state", async () => {
    const ctx = createTestContext();

    // Create two products
    const p1 = await setup.cms.api.collections.products.create(
      {
        sku: "BATCH-1",
        name: "Original 1",
      },
      ctx,
    );

    const p2 = await setup.cms.api.collections.products.create(
      {
        sku: "BATCH-2",
        name: "Original 2",
      },
      ctx,
    );

    // Update both
    const updated = await setup.cms.api.collections.products.update(
      {
        where: { id: { in: [p1.id, p2.id] } },
        data: { name: "Updated Batch" },
      },
      ctx,
    );

    expect(updated.length).toBe(2);
    expect(updated[0].name).toBe("Updated Batch");
    expect(updated[1].name).toBe("Updated Batch");

    // Verify _title is updated in returned objects
    expect(updated[0]._title).toBe("Updated Batch");
    expect(updated[1]._title).toBe("Updated Batch");
  });
});
