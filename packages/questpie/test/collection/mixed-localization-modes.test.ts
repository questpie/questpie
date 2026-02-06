import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { defaultFields } from "../../src/server/fields/builtin/defaults.js";
import { questpie } from "../../src/server/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

/**
 * Test collection with mixed localization modes:
 * - Flat field (text) - whole replacement (default for primitives)
 * - JSONB whole-mode - entire JSONB per locale (localized: true on json field)
 * - JSONB nested-mode - { $i18n: value } wrappers (auto-detected, no localized flag needed)
 *
 * This tests that different localization strategies can coexist in one collection.
 *
 * Note: $i18n markers are auto-detected by the localization system even without
 * explicit localized configuration. When the system encounters $i18n wrappers,
 * it extracts those values to the _localized column.
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

type PageContent = any; // Complex nested structure with $i18n markers

const q = questpie({ name: "mixed-modes-test" }).fields(defaultFields);

const products = q
  .collection("products")
  .fields((f) => ({
    name: f.text({ required: true, maxLength: 255, localized: true }), // flat localized
    description: f.json({ localized: true }), // whole-mode JSONB
    // nested-mode JSONB - $i18n markers auto-detected, no localized flag needed
    metadata: f.json(),
  }))
  // Mix of modes:
  // - name: flat field (whole replacement - localized: true)
  // - description: JSONB whole-mode (localized: true)
  // - metadata: JSONB nested-mode ($i18n markers auto-detected)
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

    // JSONB nested-mode (with $i18n wrappers)
    const metadataEN: PageContent = {
      sku: "SH-001", // static
      category: { $i18n: "Hair Care" }, // localized
      tags: [
        { id: 1, name: { $i18n: "Natural" } }, // localized name
        { id: 2, name: { $i18n: "Organic" } }, // localized name
      ],
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
    expect(metadata.category).toBe("Hair Care"); // $i18n extracted
    expect(metadata.tags[0].name).toBe("Natural"); // $i18n extracted
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
          category: { $i18n: "Styling" },
          benefits: [{ $i18n: "Long lasting" }, { $i18n: "Easy to wash" }],
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
            category: { $i18n: "Styling" },
            benefits: [{ $i18n: "Dlhotrvajúce" }, { $i18n: "Ľahko sa zmýva" }],
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
    expect((enProduct?.metadata as any).benefits[0]).toBe("Long lasting");

    // Read in SK
    const skProduct = await setup.cms.api.collections.products.findOne(
      { where: { id: created.id } },
      ctxSK,
    );
    expect(skProduct?.name).toBe("Gél na vlasy");
    expect(
      (skProduct?.description as any)?.content[0]?.content?.[0]?.text,
    ).toBe("Silné držanie celý deň.");
    expect((skProduct?.metadata as any).category).toBe("Styling");
    expect((skProduct?.metadata as any).benefits[0]).toBe("Dlhotrvajúce");
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
          slogan: { $i18n: "The best for your hair" },
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

  it("preserves static values in nested-mode while localizing marked values", async () => {
    const ctx = createTestContext({ locale: "en" });

    const created = await setup.cms.api.collections.products.create(
      {
        name: "Test Product",
        metadata: {
          id: 123, // static number
          active: true, // static boolean
          title: { $i18n: "Localized Title" }, // localized string
          prices: [
            { currency: "EUR", amount: 1999 }, // static objects
            { currency: "USD", amount: 2199 },
          ],
          features: [
            { icon: "star", label: { $i18n: "Premium" } }, // mixed: static icon, localized label
            { icon: "shield", label: { $i18n: "Safe" } },
          ],
        },
      },
      ctx,
    );

    const createdMeta = created.metadata as any;
    expect(createdMeta.id).toBe(123);
    expect(createdMeta.active).toBe(true);
    expect(createdMeta.title).toBe("Localized Title");
    expect(createdMeta.prices).toEqual([
      { currency: "EUR", amount: 1999 },
      { currency: "USD", amount: 2199 },
    ]);
    expect(createdMeta.features[0].icon).toBe("star");
    expect(createdMeta.features[0].label).toBe("Premium");
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

  it("handles complex nested $i18n structures in nested-mode", async () => {
    const ctxEN = createTestContext({ locale: "en" });
    const ctxSK = createTestContext({ locale: "sk" });

    const metadataEN: PageContent = {
      sections: [
        {
          id: "intro",
          title: { $i18n: "Introduction" },
          items: [
            { label: { $i18n: "Welcome" }, value: "static-value" },
            { label: { $i18n: "Getting Started" }, value: "another-static" },
          ],
        },
        {
          id: "features",
          title: { $i18n: "Features" },
          items: [
            { label: { $i18n: "Fast" }, icon: "zap" },
            { label: { $i18n: "Secure" }, icon: "lock" },
          ],
        },
      ],
    };

    const created = await setup.cms.api.collections.products.create(
      {
        name: "Complex",
        metadata: metadataEN,
      },
      ctxEN,
    );

    // Update SK
    await setup.cms.api.collections.products.updateById(
      {
        id: created.id,
        data: {
          name: "Komplexný",
          metadata: {
            sections: [
              {
                id: "intro",
                title: { $i18n: "Úvod" },
                items: [
                  { label: { $i18n: "Vitajte" }, value: "static-value" },
                  { label: { $i18n: "Začíname" }, value: "another-static" },
                ],
              },
              {
                id: "features",
                title: { $i18n: "Funkcie" },
                items: [
                  { label: { $i18n: "Rýchly" }, icon: "zap" },
                  { label: { $i18n: "Bezpečný" }, icon: "lock" },
                ],
              },
            ],
          },
        },
      },
      ctxSK,
    );

    // Verify EN
    const enProduct = await setup.cms.api.collections.products.findOne(
      { where: { id: created.id } },
      ctxEN,
    );
    const enMeta = enProduct?.metadata as any;
    expect(enMeta.sections[0].title).toBe("Introduction");
    expect(enMeta.sections[0].items[0].label).toBe("Welcome");
    expect(enMeta.sections[0].items[0].value).toBe("static-value"); // static preserved

    // Verify SK
    const skProduct = await setup.cms.api.collections.products.findOne(
      { where: { id: created.id } },
      ctxSK,
    );
    const skMeta = skProduct?.metadata as any;
    expect(skMeta.sections[0].title).toBe("Úvod");
    expect(skMeta.sections[0].items[0].label).toBe("Vitajte");
    expect(skMeta.sections[0].items[0].value).toBe("static-value"); // static preserved
    expect(skMeta.sections[1].items[0].icon).toBe("zap"); // static preserved
  });
});
