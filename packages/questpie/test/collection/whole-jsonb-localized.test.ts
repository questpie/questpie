import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { defaultFields } from "../../src/server/fields/builtin/defaults.js";
import { questpie } from "../../src/server/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

/**
 * Test collection with whole JSONB localization (TipTap richtext use case).
 *
 * The `bio` field is a JSONB that should be replaced entirely per locale.
 * No { $i18n: value } wrappers - the entire JSONB structure is different per locale.
 *
 * Use case: TipTap editor where each locale has its own complete document structure.
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

const q = questpie({ name: "whole-jsonb-test" }).fields(defaultFields);

const barbers = q
  .collection("barbers")
  .fields((f) => ({
    name: f.text({ required: true, maxLength: 255, localized: true }),
    bio: f.json({ localized: true }),
  }))
  .options({
    timestamps: true,
  });

const testModule = questpie({ name: "whole-jsonb-test" }).collections({
  barbers,
});

describe("whole JSONB localization", () => {
  let setup: Awaited<ReturnType<typeof buildMockApp<typeof testModule>>>;

  beforeEach(async () => {
    setup = await buildMockApp(testModule);
    await runTestDbMigrations(setup.cms);
  });

  afterEach(async () => {
    await setup.cleanup();
  });

  it("creates barber with whole JSONB bio in default locale", async () => {
    const ctx = createTestContext({ locale: "en" });

    const bioEN: TipTapContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Hello, I'm a barber with 10 years of experience.",
            },
          ],
        },
      ],
    };

    const created = await setup.cms.api.collections.barbers.create(
      {
        name: "John Doe",
        bio: bioEN,
      },
      ctx,
    );

    expect(created.name).toBe("John Doe");
    expect(created.bio).toEqual(bioEN);

    // Read back in EN
    const found = await setup.cms.api.collections.barbers.findOne(
      { where: { id: created.id } },
      ctx,
    );

    expect(found).not.toBeNull();
    expect(found?.name).toBe("John Doe");
    expect(found?.bio).toEqual(bioEN);
  });

  it("updates barber with different locale bio (whole replacement)", async () => {
    const ctxEN = createTestContext({ locale: "en" });
    const ctxSK = createTestContext({ locale: "sk" });

    const bioEN: TipTapContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "English bio" }],
        },
      ],
    };

    const bioSK: TipTapContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Slovenský životopis" }],
        },
      ],
    };

    // Create in EN
    const created = await setup.cms.api.collections.barbers.create(
      {
        name: "John",
        bio: bioEN,
      },
      ctxEN,
    );

    // Update SK locale with different bio
    await setup.cms.api.collections.barbers.updateById(
      {
        id: created.id,
        data: {
          name: "Ján",
          bio: bioSK,
        },
      },
      ctxSK,
    );

    // Read in EN - should get EN bio
    const enBarber = await setup.cms.api.collections.barbers.findOne(
      { where: { id: created.id } },
      ctxEN,
    );

    expect(enBarber?.name).toBe("John");
    expect(enBarber?.bio).toEqual(bioEN);

    // Read in SK - should get SK bio
    const skBarber = await setup.cms.api.collections.barbers.findOne(
      { where: { id: created.id } },
      ctxSK,
    );

    expect(skBarber?.name).toBe("Ján");
    expect(skBarber?.bio).toEqual(bioSK);
  });

  it("falls back to default locale when translation is missing", async () => {
    const ctxEN = createTestContext({ locale: "en" });
    const ctxDE = createTestContext({ locale: "de" });

    const bioEN: TipTapContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "English bio" }],
        },
      ],
    };

    // Create in EN
    const created = await setup.cms.api.collections.barbers.create(
      {
        name: "John",
        bio: bioEN,
      },
      ctxEN,
    );

    // Read in DE (no translation) - should fallback to EN
    const deBarber = await setup.cms.api.collections.barbers.findOne(
      { where: { id: created.id } },
      ctxDE,
    );

    expect(deBarber?.name).toBe("John"); // fallback to EN
    expect(deBarber?.bio).toEqual(bioEN); // fallback to EN
  });

  it("handles complex TipTap structures per locale", async () => {
    const ctxEN = createTestContext({ locale: "en" });
    const ctxSK = createTestContext({ locale: "sk" });

    const bioEN: TipTapContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Paragraph 1 EN" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Paragraph 2 EN" }],
        },
      ],
    };

    const bioSK: TipTapContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Odsek 1 SK" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Odsek 2 SK" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Odsek 3 SK - extra" }],
        },
      ],
    };

    // Create in EN
    const created = await setup.cms.api.collections.barbers.create(
      {
        name: "Complex",
        bio: bioEN,
      },
      ctxEN,
    );

    // Update SK with different structure (more paragraphs)
    await setup.cms.api.collections.barbers.updateById(
      {
        id: created.id,
        data: {
          name: "Komplexný",
          bio: bioSK,
        },
      },
      ctxSK,
    );

    // Verify EN has 2 paragraphs
    const enBarber = await setup.cms.api.collections.barbers.findOne(
      { where: { id: created.id } },
      ctxEN,
    );
    expect((enBarber?.bio as any)?.content).toHaveLength(2);

    // Verify SK has 3 paragraphs
    const skBarber = await setup.cms.api.collections.barbers.findOne(
      { where: { id: created.id } },
      ctxSK,
    );
    expect((skBarber?.bio as any)?.content).toHaveLength(3);
  });

  it("handles null bio values", async () => {
    const ctx = createTestContext({ locale: "en" });

    // Create with null bio
    const created = await setup.cms.api.collections.barbers.create(
      {
        name: "No Bio",
        bio: null,
      },
      ctx,
    );

    expect(created.bio).toBeNull();

    // Read back
    const found = await setup.cms.api.collections.barbers.findOne(
      { where: { id: created.id } },
      ctx,
    );

    expect(found?.bio).toBeNull();
  });

  it("updates only specific locale without affecting others", async () => {
    const ctxEN = createTestContext({ locale: "en" });
    const ctxSK = createTestContext({ locale: "sk" });
    const ctxDE = createTestContext({ locale: "de" });

    const bioEN: TipTapContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "EN version" }],
        },
      ],
    };

    const bioSK: TipTapContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "SK version" }],
        },
      ],
    };

    const bioDE: TipTapContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "DE version" }],
        },
      ],
    };

    // Create in EN
    const created = await setup.cms.api.collections.barbers.create(
      {
        name: "Multi",
        bio: bioEN,
      },
      ctxEN,
    );

    // Add SK
    await setup.cms.api.collections.barbers.updateById(
      {
        id: created.id,
        data: {
          name: "Multi SK",
          bio: bioSK,
        },
      },
      ctxSK,
    );

    // Add DE
    await setup.cms.api.collections.barbers.updateById(
      {
        id: created.id,
        data: {
          name: "Multi DE",
          bio: bioDE,
        },
      },
      ctxDE,
    );

    // Verify all locales have their own versions
    const enBarber = await setup.cms.api.collections.barbers.findOne(
      { where: { id: created.id } },
      ctxEN,
    );
    expect(enBarber?.bio).toEqual(bioEN);

    const skBarber = await setup.cms.api.collections.barbers.findOne(
      { where: { id: created.id } },
      ctxSK,
    );
    expect(skBarber?.bio).toEqual(bioSK);

    const deBarber = await setup.cms.api.collections.barbers.findOne(
      { where: { id: created.id } },
      ctxDE,
    );
    expect(deBarber?.bio).toEqual(bioDE);
  });
});
