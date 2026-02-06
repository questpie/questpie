import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { defaultFields } from "../../src/server/fields/builtin/defaults.js";
import type { JsonValue } from "../../src/server/fields/builtin/json.js";
import { questpie } from "../../src/server/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

const q = questpie({ name: "test-module" }).fields(defaultFields);

const testModule = q.collections({
  content: q
    .collection("content")
    .fields((f) => ({
      title: f.text({ required: true, maxLength: 255 }),
      description: f.textarea(),
      richContent: f.json(),
      isPublished: f.boolean({ default: false }),
      viewCount: f.number({ default: 0 }),
      publishedAt: f.datetime(),
    }))
    .options({
      timestamps: true,
    }),
});

describe("collection field types", () => {
  let setup: Awaited<ReturnType<typeof buildMockApp<typeof testModule>>>;

  beforeEach(async () => {
    setup = await buildMockApp(testModule);
    await runTestDbMigrations(setup.cms);
  });

  afterEach(async () => {
    await setup.cleanup();
  });

  describe("text field (varchar 255)", () => {
    it("stores and retrieves short text", async () => {
      const ctx = createTestContext();
      // Use cms.api.collections.content directly

      const created = await setup.cms.api.collections.content.create(
        {
          id: crypto.randomUUID(),
          title: "Short Title",
        },
        ctx,
      );

      expect(created.title).toBe("Short Title");

      const found = await setup.cms.api.collections.content.findOne(
        { where: { id: created.id } },
        ctx,
      );
      expect(found?.title).toBe("Short Title");
    });

    it("enforces not null constraint", async () => {
      const ctx = createTestContext();
      // Use cms.api.collections.content directly

      await expect(
        setup.cms.api.collections.content.create(
          {
            id: crypto.randomUUID(),
            // title missing
          } as any,
          ctx,
        ),
      ).rejects.toThrow();
    });

    it("handles empty string", async () => {
      const ctx = createTestContext();
      // Use cms.api.collections.content directly

      const created = await setup.cms.api.collections.content.create(
        {
          id: crypto.randomUUID(),
          title: "",
        },
        ctx,
      );

      expect(created.title).toBe("");
    });
  });

  describe("textarea field (text)", () => {
    it("stores and retrieves long text", async () => {
      const ctx = createTestContext();
      // Use cms.api.collections.content directly

      const longText = "A".repeat(1000);

      const created = await setup.cms.api.collections.content.create(
        {
          id: crypto.randomUUID(),
          title: "Test",
          description: longText,
        },
        ctx,
      );

      expect(created.description).toBe(longText);
    });

    it("handles null values", async () => {
      const ctx = createTestContext();
      // Use cms.api.collections.content directly

      const created = await setup.cms.api.collections.content.create(
        {
          id: crypto.randomUUID(),
          title: "Test",
          description: null,
        },
        ctx,
      );

      expect(created.description).toBeNull();
    });

    it("handles multiline text", async () => {
      const ctx = createTestContext();
      // Use cms.api.collections.content directly

      const multiline = "Line 1\nLine 2\nLine 3";

      const created = await setup.cms.api.collections.content.create(
        {
          id: crypto.randomUUID(),
          title: "Test",
          description: multiline,
        },
        ctx,
      );

      expect(created.description).toBe(multiline);
    });
  });

  describe("richText field (JSON)", () => {
    it("stores and retrieves rich text JSON", async () => {
      const ctx = createTestContext();
      // Use cms.api.collections.content directly

      const richContent = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Hello World" }],
          },
        ],
      };

      const created = await setup.cms.api.collections.content.create(
        {
          id: crypto.randomUUID(),
          title: "Test",
          richContent,
        },
        ctx,
      );

      expect(created.richContent).toEqual(richContent);
    });

    it("handles null rich text", async () => {
      const ctx = createTestContext();
      // Use cms.api.collections.content directly

      const created = await setup.cms.api.collections.content.create(
        {
          id: crypto.randomUUID(),
          title: "Test",
          richContent: null,
        },
        ctx,
      );

      expect(created.richContent).toBeNull();
    });

    it("preserves complex nested structures", async () => {
      const ctx = createTestContext();
      // Use cms.api.collections.content directly

      const complex: JsonValue = {
        blocks: [
          { type: "heading", level: 1, text: "Title" },
          { type: "paragraph", text: "Content" },
          {
            type: "list",
            items: ["Item 1", "Item 2"],
          },
        ],
        metadata: { version: 1 },
      };

      const created = await setup.cms.api.collections.content.create(
        {
          id: crypto.randomUUID(),
          title: "Test",
          richContent: complex,
        },
        ctx,
      );

      expect(created.richContent).toEqual(complex);
    });
  });

  describe("checkbox field (boolean)", () => {
    it("stores and retrieves boolean true", async () => {
      const ctx = createTestContext();
      // Use cms.api.collections.content directly

      const created = await setup.cms.api.collections.content.create(
        {
          id: crypto.randomUUID(),
          title: "Test",
          isPublished: true,
        },
        ctx,
      );

      expect(created.isPublished).toBe(true);
    });

    it("stores and retrieves boolean false", async () => {
      const ctx = createTestContext();
      // Use cms.api.collections.content directly

      const created = await setup.cms.api.collections.content.create(
        {
          id: crypto.randomUUID(),
          title: "Test",
          isPublished: false,
        },
        ctx,
      );

      expect(created.isPublished).toBe(false);
    });

    it("uses default value when not provided", async () => {
      const ctx = createTestContext();
      // Use cms.api.collections.content directly

      const created = await setup.cms.api.collections.content.create(
        {
          id: crypto.randomUUID(),
          title: "Test",
        },
        ctx,
      );

      expect(created.isPublished).toBe(false);
    });
  });

  describe("number field (integer)", () => {
    it("stores and retrieves integers", async () => {
      const ctx = createTestContext();
      // Use cms.api.collections.content directly

      const created = await setup.cms.api.collections.content.create(
        {
          id: crypto.randomUUID(),
          title: "Test",
          viewCount: 42,
        },
        ctx,
      );

      expect(created.viewCount).toBe(42);
    });

    it("handles zero", async () => {
      const ctx = createTestContext();
      // Use cms.api.collections.content directly

      const created = await setup.cms.api.collections.content.create(
        {
          id: crypto.randomUUID(),
          title: "Test",
          viewCount: 0,
        },
        ctx,
      );

      expect(created.viewCount).toBe(0);
    });

    it("handles negative numbers", async () => {
      const ctx = createTestContext();
      // Use cms.api.collections.content directly

      const created = await setup.cms.api.collections.content.create(
        {
          id: crypto.randomUUID(),
          title: "Test",
          viewCount: -5,
        },
        ctx,
      );

      expect(created.viewCount).toBe(-5);
    });

    it("uses default value", async () => {
      const ctx = createTestContext();
      // Use cms.api.collections.content directly

      const created = await setup.cms.api.collections.content.create(
        {
          id: crypto.randomUUID(),
          title: "Test",
        },
        ctx,
      );

      expect(created.viewCount).toBe(0);
    });
  });

  describe("timestamp field", () => {
    it("stores and retrieves dates", async () => {
      const ctx = createTestContext();
      // Use cms.api.collections.content directly

      const now = new Date();

      const created = await setup.cms.api.collections.content.create(
        {
          id: crypto.randomUUID(),
          title: "Test",
          publishedAt: now,
        },
        ctx,
      );

      expect(created.publishedAt).toBeInstanceOf(Date);
      expect(created.publishedAt?.getTime()).toBeCloseTo(now.getTime(), -3);
    });

    it("handles null timestamps", async () => {
      const ctx = createTestContext();
      // Use cms.api.collections.content directly

      const created = await setup.cms.api.collections.content.create(
        {
          id: crypto.randomUUID(),
          title: "Test",
          publishedAt: null,
        },
        ctx,
      );

      expect(created.publishedAt).toBeNull();
    });

    it("handles ISO string dates", async () => {
      const ctx = createTestContext();
      // Use cms.api.collections.content directly

      const isoDate = "2024-01-01T12:00:00Z";

      const created = await setup.cms.api.collections.content.create(
        {
          id: crypto.randomUUID(),
          title: "Test",
          publishedAt: new Date(isoDate),
        },
        ctx,
      );

      expect(created.publishedAt).toBeInstanceOf(Date);
    });
  });

  describe("field updates", () => {
    it("updates single field", async () => {
      const ctx = createTestContext();
      // Use cms.api.collections.content directly

      const created = await setup.cms.api.collections.content.create(
        {
          id: crypto.randomUUID(),
          title: "Original Title",
          viewCount: 0,
        },
        ctx,
      );

      await setup.cms.api.collections.content.update(
        {
          where: { id: created.id },
          data: { viewCount: 100 },
        },
        ctx,
      );

      const updated = await setup.cms.api.collections.content.findOne(
        { where: { id: created.id } },
        ctx,
      );
      expect(updated?.viewCount).toBe(100);
      expect(updated?.title).toBe("Original Title"); // unchanged
    });

    it("updates multiple fields", async () => {
      const ctx = createTestContext();
      // Use cms.api.collections.content directly

      const created = await setup.cms.api.collections.content.create(
        {
          id: crypto.randomUUID(),
          title: "Original",
          isPublished: false,
          viewCount: 0,
        },
        ctx,
      );

      await setup.cms.api.collections.content.update(
        {
          where: { id: created.id },
          data: {
            title: "Updated",
            isPublished: true,
            viewCount: 50,
          },
        },
        ctx,
      );

      const updated = await setup.cms.api.collections.content.findOne(
        { where: { id: created.id } },
        ctx,
      );
      expect(updated?.title).toBe("Updated");
      expect(updated?.isPublished).toBe(true);
      expect(updated?.viewCount).toBe(50);
    });

    it("clears optional field with null", async () => {
      const ctx = createTestContext();
      // Use cms.api.collections.content directly

      const created = await setup.cms.api.collections.content.create(
        {
          id: crypto.randomUUID(),
          title: "Test",
          description: "Initial description",
        },
        ctx,
      );

      await setup.cms.api.collections.content.update(
        {
          where: { id: created.id },
          data: { description: null },
        },
        ctx,
      );

      const updated = await setup.cms.api.collections.content.findOne(
        { where: { id: created.id } },
        ctx,
      );
      expect(updated?.description).toBeNull();
    });
  });
});
