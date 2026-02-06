import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { defaultFields } from "../../src/server/fields/builtin/defaults.js";
import { questpie } from "../../src/server/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

/**
 * Test collection with nested localized JSONB content.
 *
 * The `content` field is a JSONB that contains both static and localized values.
 * On write: client sends data with { $i18n: value } wrappers for localized fields
 * On read: server merges structure (with $i18n markers) with localized values from _localized column
 *
 * Note: The $i18n markers are auto-detected even without explicit localized configuration.
 * When the system encounters $i18n wrappers, it extracts those values to the _localized column.
 */
// Use any for the complex nested JSONB type to simplify test assertions
// In real usage, the type would be properly defined but tests focus on runtime behavior
type PageContent = any;

const q = questpie({ name: "nested-i18n-test" }).fields(defaultFields);

const pages = q
  .collection("pages")
  .fields((f) => ({
    slug: f.text({ required: true, maxLength: 100 }),
    // A localized field is needed to create the i18n table with _localized column
    // for storing nested $i18n marker values
    title: f.text({ localized: true }),
    // JSON field - $i18n markers in the content will be auto-detected and handled
    // by the localization system. The _localized column in i18n table stores the extracted values.
    content: f.json(),
  }))
  .options({
    timestamps: true,
  });

const testModule = q.collections({
  pages,
});

describe("nested localized JSONB", () => {
  let setup: Awaited<ReturnType<typeof buildMockApp<typeof testModule>>>;

  beforeEach(async () => {
    setup = await buildMockApp(testModule);
    await runTestDbMigrations(setup.cms);
  });

  afterEach(async () => {
    await setup.cleanup();
  });

  it("creates page with nested localized content using $i18n wrappers", async () => {
    const ctx = createTestContext();

    // Create page with $i18n wrappers for localized values
    const created = await setup.cms.api.collections.pages.create(
      {
        slug: "home",
        content: {
          title: { $i18n: "Welcome" },
          subtitle: { $i18n: "Hello World" },
          alignment: "center", // static - no $i18n wrapper
          features: {
            _order: ["f1", "f2"],
            f1: {
              id: "f1",
              icon: "star", // static
              title: { $i18n: "Feature 1" },
              description: { $i18n: "First feature" },
            },
            f2: {
              id: "f2",
              icon: "heart", // static
              title: { $i18n: "Feature 2" },
              description: { $i18n: "Second feature" },
            },
          },
        },
      },
      ctx,
    );

    expect(created.slug).toBe("home");

    // Read back - should get merged content (localized values injected)
    const found = await setup.cms.api.collections.pages.findOne(
      { where: { id: created.id } },
      ctx,
    );

    expect(found).not.toBeNull();
    const content = found?.content as PageContent;
    expect(content?.title).toBe("Welcome");
    expect(content?.subtitle).toBe("Hello World");
    expect(content?.alignment).toBe("center");
    expect(content?.features?._order).toEqual(["f1", "f2"]);
    expect(content?.features?.f1?.title).toBe("Feature 1");
    expect(content?.features?.f1?.icon).toBe("star");
  });

  it("creates page in default locale and updates in different locale with fallback", async () => {
    const ctxEn = createTestContext({ locale: "en" });
    const ctxSk = createTestContext({ locale: "sk" });

    // Create in EN with $i18n wrappers
    const created = await setup.cms.api.collections.pages.create(
      {
        slug: "about",
        content: {
          title: { $i18n: "About Us" },
          subtitle: { $i18n: "Learn more" },
          alignment: "left",
          features: {
            _order: ["f1"],
            f1: {
              id: "f1",
              icon: "info",
              title: { $i18n: "Info" },
              description: { $i18n: "Information" },
            },
          },
        },
      },
      ctxEn,
    );

    // Update only SK localized values
    await setup.cms.api.collections.pages.updateById(
      {
        id: created.id,
        data: {
          content: {
            title: { $i18n: "O nas" },
            subtitle: { $i18n: "Zistite viac" },
            alignment: "left", // static - unchanged
            features: {
              _order: ["f1"],
              f1: {
                id: "f1",
                icon: "info",
                title: { $i18n: "Info SK" },
                description: { $i18n: "Informacie" },
              },
            },
          },
        },
      },
      ctxSk,
    );

    // Read in SK - should get SK values
    const skPage = await setup.cms.api.collections.pages.findOne(
      { where: { id: created.id } },
      ctxSk,
    );

    const skContent = skPage?.content as PageContent;
    expect(skContent?.title).toBe("O nas");
    expect(skContent?.subtitle).toBe("Zistite viac");
    expect(skContent?.alignment).toBe("left"); // static unchanged
    expect(skContent?.features?.f1?.title).toBe("Info SK");

    // Read in DE (no translation) - should fallback to EN
    const ctxDe = createTestContext({ locale: "de" });
    const dePage = await setup.cms.api.collections.pages.findOne(
      { where: { id: created.id } },
      ctxDe,
    );

    const deContent = dePage?.content as PageContent;
    expect(deContent?.title).toBe("About Us"); // fallback to EN
    expect(deContent?.subtitle).toBe("Learn more"); // fallback to EN
    expect(deContent?.alignment).toBe("left"); // static
    expect(deContent?.features?.f1?.title).toBe("Info"); // fallback to EN
  });

  it("handles mixed static and localized fields correctly", async () => {
    const ctx = createTestContext();

    const created = await setup.cms.api.collections.pages.create(
      {
        slug: "contact",
        content: {
          title: { $i18n: "Contact" },
          subtitle: { $i18n: "Get in touch" },
          alignment: "right", // static
          email: "info@example.com", // static - no $i18n
          features: {
            _order: ["f1"],
            f1: {
              id: "f1",
              icon: "phone", // static
              title: { $i18n: "Call Us" },
              description: { $i18n: "24/7 support" },
            },
          },
        },
      },
      ctx,
    );

    // Update only title - other localized values stay
    await setup.cms.api.collections.pages.updateById(
      {
        id: created.id,
        data: {
          content: {
            title: { $i18n: "Contact Us" },
            subtitle: { $i18n: "Get in touch" },
            alignment: "right", // unchanged
            email: "info@example.com", // unchanged
            features: {
              _order: ["f1"],
              f1: {
                id: "f1",
                icon: "phone",
                title: { $i18n: "Call Us Now" },
                description: { $i18n: "24/7 support" },
              },
            },
          },
        },
      },
      ctx,
    );

    const found = await setup.cms.api.collections.pages.findOne(
      { where: { id: created.id } },
      ctx,
    );

    const foundContent = found?.content as PageContent;
    expect(foundContent?.title).toBe("Contact Us");
    expect(foundContent?.alignment).toBe("right"); // static preserved
    expect(foundContent?.email).toBe("info@example.com"); // static preserved
    expect(foundContent?.features?.f1?.icon).toBe("phone"); // static preserved
    expect(foundContent?.features?.f1?.title).toBe("Call Us Now"); // localized updated
  });

  it("handles content without $i18n wrappers (fully static content)", async () => {
    const ctx = createTestContext();

    // Create page with fully static content (no $i18n wrappers)
    const created = await setup.cms.api.collections.pages.create(
      {
        slug: "static-page",
        content: {
          title: "Static Title",
          alignment: "center",
          metadata: {
            author: "John",
            tags: ["a", "b"],
          },
        },
      },
      ctx,
    );

    const foundStatic = await setup.cms.api.collections.pages.findOne(
      { where: { id: created.id } },
      ctx,
    );

    // Static content should be preserved as-is
    const staticContent = foundStatic?.content as PageContent;
    expect(staticContent?.title).toBe("Static Title");
    expect(staticContent?.alignment).toBe("center");
    expect(staticContent?.metadata?.author).toBe("John");
    expect(staticContent?.metadata?.tags).toEqual(["a", "b"]);
  });

  it("updates blocks structure with _tree and _values (seed.ts scenario)", async () => {
    const ctxEn = createTestContext({ locale: "en" });
    const ctxSk = createTestContext({ locale: "sk" });

    // Create page with blocks structure in EN (like seed.ts)
    const created = await setup.cms.api.collections.pages.create(
      {
        slug: "home",
        content: {
          _tree: [
            { id: "hero-1", type: "hero", children: [] },
            { id: "services-1", type: "services", children: [] },
            { id: "cta-1", type: "cta", children: [] },
          ],
          _values: {
            "hero-1": {
              title: { $i18n: "Sharp Cuts. Clean Style." },
              subtitle: {
                $i18n: "Precision grooming in the heart of the city.",
              },
              backgroundImage: "hero.jpg",
              overlayOpacity: 60,
              alignment: "center",
              ctaText: { $i18n: "Book Appointment" },
              ctaLink: "/booking",
              height: "large",
            },
            "services-1": {
              title: { $i18n: "Our Services" },
              subtitle: {
                $i18n: "Tailored services for clean, confident looks.",
              },
              showPrices: true,
              showDuration: true,
              columns: "3",
              limit: 6,
            },
            "cta-1": {
              title: { $i18n: "Ready for a Fresh Look?" },
              description: {
                $i18n:
                  "Book your appointment today and experience the difference.",
              },
              buttonText: { $i18n: "Book Now" },
              buttonLink: "/booking",
              variant: "highlight",
              size: "medium",
            },
          },
        },
      },
      ctxEn,
    );

    // Update with SK translations (like seed.ts does)
    await setup.cms.api.collections.pages.updateById(
      {
        id: created.id,
        data: {
          content: {
            _tree: [
              { id: "hero-1", type: "hero", children: [] },
              { id: "services-1", type: "services", children: [] },
              { id: "cta-1", type: "cta", children: [] },
            ],
            _values: {
              "hero-1": {
                title: { $i18n: "Sharp Cuts. Čistý štýl." },
                subtitle: { $i18n: "Precízna starostlivosť v srdci mesta." },
                backgroundImage: "hero.jpg",
                overlayOpacity: 60,
                alignment: "center",
                ctaText: { $i18n: "Rezervovať termín" },
                ctaLink: "/booking",
                height: "large",
              },
              "services-1": {
                title: { $i18n: "Naše služby" },
                subtitle: {
                  $i18n: "Služby na mieru pre čistý a sebavedomý vzhľad.",
                },
                showPrices: true,
                showDuration: true,
                columns: "3",
                limit: 6,
              },
              "cta-1": {
                title: { $i18n: "Pripravený na nový vzhľad?" },
                description: {
                  $i18n: "Rezervujte si termín ešte dnes a zažite rozdiel.",
                },
                buttonText: { $i18n: "Rezervovať" },
                buttonLink: "/booking",
                variant: "highlight",
                size: "medium",
              },
            },
          },
        },
      },
      ctxSk,
    );

    // Read in SK - should get SK values
    const skPage = await setup.cms.api.collections.pages.findOne(
      { where: { id: created.id } },
      ctxSk,
    );

    const skContent = skPage?.content as PageContent;
    expect(skContent?._tree).toEqual([
      { id: "hero-1", type: "hero", children: [] },
      { id: "services-1", type: "services", children: [] },
      { id: "cta-1", type: "cta", children: [] },
    ]);
    expect(skContent?._values["hero-1"]?.title).toBe("Sharp Cuts. Čistý štýl.");
    expect(skContent?._values["hero-1"]?.subtitle).toBe(
      "Precízna starostlivosť v srdci mesta.",
    );
    expect(skContent?._values["hero-1"]?.ctaText).toBe("Rezervovať termín");
    expect(skContent?._values["hero-1"]?.backgroundImage).toBe("hero.jpg"); // static
    expect(skContent?._values["hero-1"]?.overlayOpacity).toBe(60); // static
    expect(skContent?._values["services-1"]?.title).toBe("Naše služby");
    expect(skContent?._values["cta-1"]?.buttonText).toBe("Rezervovať");

    // Read in EN - should get EN values
    const enPage = await setup.cms.api.collections.pages.findOne(
      { where: { id: created.id } },
      ctxEn,
    );

    const enContent = enPage?.content as PageContent;
    expect(enContent?._values["hero-1"]?.title).toBe(
      "Sharp Cuts. Clean Style.",
    );
    expect(enContent?._values["hero-1"]?.subtitle).toBe(
      "Precision grooming in the heart of the city.",
    );
    expect(enContent?._values["hero-1"]?.ctaText).toBe("Book Appointment");
    expect(enContent?._values["services-1"]?.title).toBe("Our Services");
    expect(enContent?._values["cta-1"]?.buttonText).toBe("Book Now");
  });

  it("updates multiple records with nested localized content (updateMany)", async () => {
    const ctxEn = createTestContext({ locale: "en" });
    const ctxSk = createTestContext({ locale: "sk" });

    // Create two pages
    const p1 = await setup.cms.api.collections.pages.create(
      {
        slug: "page-1",
        content: {
          title: { $i18n: "Page 1 EN" },
          alignment: "left",
        },
      },
      ctxEn,
    );

    const p2 = await setup.cms.api.collections.pages.create(
      {
        slug: "page-2",
        content: {
          title: { $i18n: "Page 2 EN" },
          alignment: "right",
        },
      },
      ctxEn,
    );

    // Batch update in SK
    await setup.cms.api.collections.pages.update(
      {
        where: { id: { in: [p1.id, p2.id] } },
        data: {
          content: {
            title: { $i18n: "Stranka SK" },
            alignment: "center",
          },
        },
      },
      ctxSk,
    );

    // Verify P1 in SK
    const p1Sk = await setup.cms.api.collections.pages.findOne(
      { where: { id: p1.id } },
      ctxSk,
    );
    expect((p1Sk?.content as any)?.title).toBe("Stranka SK");
    expect((p1Sk?.content as any)?.alignment).toBe("center");

    // Verify P2 in SK
    const p2Sk = await setup.cms.api.collections.pages.findOne(
      { where: { id: p2.id } },
      ctxSk,
    );
    expect((p2Sk?.content as any)?.title).toBe("Stranka SK");
    expect((p2Sk?.content as any)?.alignment).toBe("center");

    // Verify P1 in EN remains unchanged in localized part
    const p1En = await setup.cms.api.collections.pages.findOne(
      { where: { id: p1.id } },
      ctxEn,
    );
    expect((p1En?.content as any)?.title).toBe("Page 1 EN");
    expect((p1En?.content as any)?.alignment).toBe("center"); // static field changed for all
  });
});
