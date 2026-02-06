import { describe, expect, it } from "bun:test";
import {
  extractNestedLocalizationSchema,
  extractNestedLocalizationSchemas,
} from "../../src/server/collection/crud/shared/field-extraction.js";
import {
  autoSplitNestedI18n,
  splitByNestedSchema,
} from "../../src/server/collection/crud/shared/nested-i18n-split.js";
import { defaultFields } from "../../src/server/fields/builtin/defaults.js";
import { questpie } from "../../src/server/index.js";

/**
 * Unit tests for nested localization schema extraction and splitting.
 */

const q = questpie({ name: "unit-test" }).fields(defaultFields);

describe("extractNestedLocalizationSchema", () => {
  it("returns null for non-localized object field", () => {
    const collection = q.collection("test").fields((f) => ({
      profile: f.object({
        fields: {
          name: f.text({ required: true }),
          age: f.number(),
        },
      }),
    }));

    const fieldDef = collection.state.fieldDefinitions!.profile;
    const schema = extractNestedLocalizationSchema(fieldDef);
    expect(schema).toBeNull();
  });

  it("extracts schema for object with localized nested field", () => {
    const collection = q.collection("test").fields((f) => ({
      profile: f.object({
        fields: {
          name: f.text({ required: true }),
          description: f.text({ localized: true }),
        },
      }),
    }));

    const fieldDef = collection.state.fieldDefinitions!.profile;
    const schema = extractNestedLocalizationSchema(fieldDef);
    expect(schema).toEqual({ description: true });
  });

  it("extracts schema for deeply nested localized fields", () => {
    const collection = q.collection("test").fields((f) => ({
      workingHours: f.object({
        fields: {
          monday: f.object({
            fields: {
              isOpen: f.boolean(),
              note: f.text({ localized: true }),
            },
          }),
          tuesday: f.object({
            fields: {
              isOpen: f.boolean(),
              note: f.text({ localized: true }),
            },
          }),
        },
      }),
    }));

    const fieldDef = collection.state.fieldDefinitions!.workingHours;
    const schema = extractNestedLocalizationSchema(fieldDef);
    expect(schema).toEqual({
      monday: { note: true },
      tuesday: { note: true },
    });
  });

  it("extracts schema for array with localized item fields", () => {
    const collection = q.collection("test").fields((f) => ({
      links: f.array({
        of: f.object({
          fields: {
            platform: f.text({ required: true }),
            description: f.text({ localized: true }),
          },
        }),
      }),
    }));

    const fieldDef = collection.state.fieldDefinitions!.links;
    const schema = extractNestedLocalizationSchema(fieldDef);
    expect(schema).toEqual({
      _item: { description: true },
    });
  });

  it("returns null for array without localized fields", () => {
    const collection = q.collection("test").fields((f) => ({
      links: f.array({
        of: f.object({
          fields: {
            platform: f.text({ required: true }),
            url: f.text(),
          },
        }),
      }),
    }));

    const fieldDef = collection.state.fieldDefinitions!.links;
    const schema = extractNestedLocalizationSchema(fieldDef);
    expect(schema).toBeNull();
  });

  it("extracts schema for mixed nested structure", () => {
    const collection = q.collection("test").fields((f) => ({
      content: f.object({
        fields: {
          title: f.text({ localized: true }),
          settings: f.object({
            fields: {
              theme: f.text(),
              greeting: f.text({ localized: true }),
            },
          }),
          items: f.array({
            of: f.object({
              fields: {
                name: f.text(),
                label: f.text({ localized: true }),
              },
            }),
          }),
        },
      }),
    }));

    const fieldDef = collection.state.fieldDefinitions!.content;
    const schema = extractNestedLocalizationSchema(fieldDef);
    expect(schema).toEqual({
      title: true,
      settings: { greeting: true },
      items: { _item: { label: true } },
    });
  });
});

describe("extractNestedLocalizationSchemas", () => {
  it("extracts schemas for all JSONB fields in collection", () => {
    const collection = q.collection("test").fields((f) => ({
      name: f.text({ required: true }),
      bio: f.text({ localized: true }), // Top-level localized - not nested
      metadata: f.object({
        fields: {
          views: f.number(),
          lastNote: f.text({ localized: true }),
        },
      }),
      tags: f.array({
        of: f.object({
          fields: {
            name: f.text(),
            description: f.text({ localized: true }),
          },
        }),
      }),
    }));

    const schemas = extractNestedLocalizationSchemas(
      collection.state.fieldDefinitions!,
    );

    // bio is top-level localized, not nested - should not be in schemas
    expect(schemas).toEqual({
      metadata: { lastNote: true },
      tags: { _item: { description: true } },
    });
  });

  it("returns empty object for collection without nested localized fields", () => {
    const collection = q.collection("simple").fields((f) => ({
      name: f.text({ required: true }),
      title: f.text({ localized: true }), // Top-level only
    }));

    const schemas = extractNestedLocalizationSchemas(
      collection.state.fieldDefinitions!,
    );

    expect(schemas).toEqual({});
  });
});

describe("splitByNestedSchema", () => {
  it("splits data according to simple schema", () => {
    const schema = { description: true } as const;
    const data = {
      name: "Test",
      description: "Localized description",
    };

    const result = splitByNestedSchema(data, schema);

    expect(result.structure).toEqual({
      name: "Test",
      description: { $i18n: true },
    });
    expect(result.i18nValues).toEqual({
      description: "Localized description",
    });
  });

  it("splits data with deeply nested schema", () => {
    const schema = {
      monday: { note: true },
      tuesday: { note: true },
    } as const;

    const data = {
      monday: { isOpen: true, note: "Monday note" },
      tuesday: { isOpen: false, note: "Tuesday note" },
    };

    const result = splitByNestedSchema(data, schema);

    expect(result.structure).toEqual({
      monday: { isOpen: true, note: { $i18n: true } },
      tuesday: { isOpen: false, note: { $i18n: true } },
    });
    expect(result.i18nValues).toEqual({
      monday: { note: "Monday note" },
      tuesday: { note: "Tuesday note" },
    });
  });

  it("splits array data with _item schema", () => {
    const schema = { _item: { description: true } } as const;
    const data = [
      { platform: "twitter", description: "My Twitter" },
      { platform: "facebook", description: "My Facebook" },
    ];

    const result = splitByNestedSchema(data, schema);

    expect(result.structure).toEqual([
      { platform: "twitter", description: { $i18n: true } },
      { platform: "facebook", description: { $i18n: true } },
    ]);
    expect(result.i18nValues).toEqual([
      { description: "My Twitter" },
      { description: "My Facebook" },
    ]);
  });

  it("handles null values gracefully", () => {
    const schema = { note: true } as const;

    const result = splitByNestedSchema(null, schema);

    expect(result.structure).toBeNull();
    expect(result.i18nValues).toBeNull();
  });

  it("handles missing fields in data", () => {
    const schema = { note: true, description: true } as const;
    const data = { note: "Has note" }; // description missing

    const result = splitByNestedSchema(data, schema);

    expect(result.structure).toEqual({
      note: { $i18n: true },
    });
    expect(result.i18nValues).toEqual({
      note: "Has note",
    });
  });

  it("preserves non-localized fields in structure", () => {
    const schema = { title: true } as const;
    const data = {
      id: "123",
      title: "Localized title",
      count: 42,
      nested: { foo: "bar" },
    };

    const result = splitByNestedSchema(data, schema);

    expect(result.structure).toEqual({
      id: "123",
      title: { $i18n: true },
      count: 42,
      nested: { foo: "bar" },
    });
    expect(result.i18nValues).toEqual({
      title: "Localized title",
    });
  });
});

describe("backward compatibility with $i18n wrappers", () => {
  it("autoSplitNestedI18n still works with $i18n wrappers", () => {
    const data = {
      title: { $i18n: "Localized title" },
      count: 42,
      nested: {
        description: { $i18n: "Nested localized" },
        static: "Not localized",
      },
    };

    const result = autoSplitNestedI18n(data);

    expect(result.structure).toEqual({
      title: { $i18n: true },
      count: 42,
      nested: {
        description: { $i18n: true },
        static: "Not localized",
      },
    });
    expect(result.i18nValues).toEqual({
      title: "Localized title",
      nested: {
        description: "Nested localized",
      },
    });
  });

  it("autoSplitNestedI18n works with arrays", () => {
    const data = [
      { name: { $i18n: "First" }, id: 1 },
      { name: { $i18n: "Second" }, id: 2 },
    ];

    const result = autoSplitNestedI18n(data);

    expect(result.structure).toEqual([
      { name: { $i18n: true }, id: 1 },
      { name: { $i18n: true }, id: 2 },
    ]);
    expect(result.i18nValues).toEqual([{ name: "First" }, { name: "Second" }]);
  });
});
