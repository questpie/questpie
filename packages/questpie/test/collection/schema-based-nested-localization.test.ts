import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { defaultFields } from "../../src/server/fields/builtin/defaults.js";
import { questpie } from "../../src/server/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

/**
 * Test schema-based nested localization.
 *
 * NEW APPROACH: Client sends plain data (no $i18n wrappers).
 * Server uses field definitions to know which nested fields are localized.
 *
 * Field definitions specify `localized: true` on nested fields:
 * ```ts
 * workingHours: f.object({
 *   fields: () => ({
 *     monday: f.object({
 *       fields: () => ({
 *         isOpen: f.boolean(),
 *         note: f.text({ localized: true }),  // <-- Server knows this is localized
 *       }),
 *     }),
 *   }),
 * })
 * ```
 *
 * Client sends plain data:
 * ```ts
 * { workingHours: { monday: { isOpen: true, note: "Morning only" } } }
 * ```
 *
 * Server automatically:
 * 1. Splits localized values based on schema
 * 2. Stores structure with $i18n markers in main table
 * 3. Stores extracted values in i18n table _localized column
 */

const q = questpie({ name: "schema-based-i18n-test" }).fields(defaultFields);

// Collection with nested localized fields in object
const barbers = q
  .collection("barbers")
  .fields((f) => ({
    name: f.text({ required: true, maxLength: 100 }),
    // Top-level localized field (needed to create i18n table)
    bio: f.text({ localized: true }),
    // Object with nested localized fields - NO top-level localized flag
    // Note: Using direct object syntax (not factory function) - simpler!
    workingHours: f.object({
      fields: {
        monday: f.object({
          fields: {
            isOpen: f.boolean({ default: false }),
            start: f.text(),
            end: f.text(),
            // This nested field is localized!
            note: f.text({ localized: true }),
          },
        }),
        tuesday: f.object({
          fields: {
            isOpen: f.boolean({ default: false }),
            start: f.text(),
            end: f.text(),
            note: f.text({ localized: true }),
          },
        }),
      },
    }),
    // Array with localized fields in items
    socialLinks: f.array({
      of: f.object({
        fields: {
          platform: f.text({ required: true }),
          url: f.text({ required: true }),
          // Localized description in array items
          description: f.text({ localized: true }),
        },
      }),
    }),
  }))
  .options({
    timestamps: true,
  });

const testModule = q.collections({
  barbers,
});

describe("schema-based nested localization", () => {
  let setup: Awaited<ReturnType<typeof buildMockApp<typeof testModule>>>;

  beforeEach(async () => {
    setup = await buildMockApp(testModule);
    await runTestDbMigrations(setup.cms);
  });

  afterEach(async () => {
    await setup.cleanup();
  });

  it("creates barber with nested localized fields - plain data, no $i18n wrappers", async () => {
    const ctx = createTestContext({ locale: "en" });

    // Client sends PLAIN data - no $i18n wrappers needed!
    const created = await setup.cms.api.collections.barbers.create(
      {
        name: "John Doe",
        bio: "Experienced barber",
        workingHours: {
          monday: {
            isOpen: true,
            start: "09:00",
            end: "17:00",
            note: "Morning appointments preferred", // Plain string, not { $i18n: "..." }
          },
          tuesday: {
            isOpen: true,
            start: "10:00",
            end: "18:00",
            note: "Afternoon available",
          },
        },
        socialLinks: [
          {
            platform: "instagram",
            url: "https://instagram.com/johndoe",
            description: "My Instagram profile", // Plain string
          },
          {
            platform: "twitter",
            url: "https://twitter.com/johndoe",
            description: "Follow me on Twitter",
          },
        ],
      },
      ctx,
    );

    expect(created.name).toBe("John Doe");
    expect(created.bio).toBe("Experienced barber");

    // Read back - should get merged content
    const found = await setup.cms.api.collections.barbers.findOne(
      { where: { id: created.id } },
      ctx,
    );

    expect(found).not.toBeNull();
    expect(found?.workingHours?.monday?.isOpen).toBe(true);
    expect(found?.workingHours?.monday?.start).toBe("09:00");
    expect(found?.workingHours?.monday?.note).toBe(
      "Morning appointments preferred",
    );
    expect(found?.workingHours?.tuesday?.note).toBe("Afternoon available");

    // Array items
    expect(found?.socialLinks).toHaveLength(2);
    expect(found?.socialLinks?.[0]?.platform).toBe("instagram");
    expect(found?.socialLinks?.[0]?.description).toBe("My Instagram profile");
    expect(found?.socialLinks?.[1]?.description).toBe("Follow me on Twitter");
  });

  it("supports multi-locale for nested localized fields", async () => {
    const ctxEn = createTestContext({ locale: "en" });
    const ctxSk = createTestContext({ locale: "sk" });

    // Create in English
    const created = await setup.cms.api.collections.barbers.create(
      {
        name: "John Doe",
        bio: "English bio",
        workingHours: {
          monday: {
            isOpen: true,
            start: "09:00",
            end: "17:00",
            note: "English note for Monday",
          },
          tuesday: {
            isOpen: false,
            note: "Closed on Tuesday",
          },
        },
        socialLinks: [
          {
            platform: "instagram",
            url: "https://instagram.com/johndoe",
            description: "English description",
          },
        ],
      },
      ctxEn,
    );

    // Update with Slovak locale - only localized fields change
    await setup.cms.api.collections.barbers.updateById(
      {
        id: created.id,
        data: {
          bio: "Slovenska biografia",
          workingHours: {
            monday: {
              isOpen: true, // Structure stays same
              start: "09:00",
              end: "17:00",
              note: "Slovenska poznamka pre pondelok", // Localized value changes
            },
            tuesday: {
              isOpen: false,
              note: "Zatvorene v utorok",
            },
          },
          socialLinks: [
            {
              platform: "instagram",
              url: "https://instagram.com/johndoe",
              description: "Slovensky popis",
            },
          ],
        },
      },
      ctxSk,
    );

    // Read in English - should get English values
    const foundEn = await setup.cms.api.collections.barbers.findOne(
      { where: { id: created.id } },
      ctxEn,
    );

    expect(foundEn?.bio).toBe("English bio");
    expect(foundEn?.workingHours?.monday?.note).toBe("English note for Monday");
    expect(foundEn?.workingHours?.tuesday?.note).toBe("Closed on Tuesday");
    expect(foundEn?.socialLinks?.[0]?.description).toBe("English description");

    // Read in Slovak - should get Slovak values
    const foundSk = await setup.cms.api.collections.barbers.findOne(
      { where: { id: created.id } },
      ctxSk,
    );

    expect(foundSk?.bio).toBe("Slovenska biografia");
    expect(foundSk?.workingHours?.monday?.note).toBe(
      "Slovenska poznamka pre pondelok",
    );
    expect(foundSk?.workingHours?.tuesday?.note).toBe("Zatvorene v utorok");
    expect(foundSk?.socialLinks?.[0]?.description).toBe("Slovensky popis");

    // Structure (non-localized) should be same in both
    expect(foundEn?.workingHours?.monday?.isOpen).toBe(true);
    expect(foundSk?.workingHours?.monday?.isOpen).toBe(true);
    expect(foundEn?.workingHours?.monday?.start).toBe("09:00");
    expect(foundSk?.workingHours?.monday?.start).toBe("09:00");
  });

  it("falls back to default locale when translation missing", async () => {
    const ctxEn = createTestContext({ locale: "en" });
    const ctxSk = createTestContext({ locale: "sk" });

    // Create only in English
    const created = await setup.cms.api.collections.barbers.create(
      {
        name: "Jane Doe",
        bio: "English bio only",
        workingHours: {
          monday: {
            isOpen: true,
            note: "English only note",
          },
        },
      },
      ctxEn,
    );

    // Read in Slovak - should fallback to English
    const foundSk = await setup.cms.api.collections.barbers.findOne(
      { where: { id: created.id } },
      ctxSk,
    );

    expect(foundSk?.bio).toBe("English bio only"); // Fallback
    expect(foundSk?.workingHours?.monday?.note).toBe("English only note"); // Fallback
  });

  it("handles partial updates to nested localized fields", async () => {
    const ctx = createTestContext({ locale: "en" });

    // Create with initial data
    const created = await setup.cms.api.collections.barbers.create(
      {
        name: "Bob",
        workingHours: {
          monday: {
            isOpen: true,
            start: "09:00",
            end: "17:00",
            note: "Original note",
          },
          tuesday: {
            isOpen: false,
            note: "Closed",
          },
        },
      },
      ctx,
    );

    // Update only monday note
    await setup.cms.api.collections.barbers.updateById(
      {
        id: created.id,
        data: {
          workingHours: {
            monday: {
              isOpen: true,
              start: "09:00",
              end: "17:00",
              note: "Updated note", // Only this changes
            },
            tuesday: {
              isOpen: false,
              note: "Closed", // Keep same
            },
          },
        },
      },
      ctx,
    );

    // Verify update
    const found = await setup.cms.api.collections.barbers.findOne(
      { where: { id: created.id } },
      ctx,
    );

    expect(found?.workingHours?.monday?.note).toBe("Updated note");
    expect(found?.workingHours?.tuesday?.note).toBe("Closed");
  });
});
