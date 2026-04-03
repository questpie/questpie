import { describe, expect, it } from "bun:test";

import {
	extractNestedLocalizationSchema,
	extractNestedLocalizationSchemas,
} from "../../src/server/collection/crud/shared/field-extraction.js";
import { splitByNestedSchema } from "../../src/server/collection/crud/shared/nested-i18n-split.js";
import { collection } from "../../src/exports/index.js";

/**
 * Unit tests for nested localization schema extraction and splitting.
 */

describe("extractNestedLocalizationSchema", () => {
	it("returns null for non-localized object field", () => {
		const col = collection("test").fields(({ f }) => ({
			profile: f.object({
				name: f.text().required(),
				age: f.number(),
			}),
		}));

		const fieldDef = col.state.fieldDefinitions!.profile;
		const schema = extractNestedLocalizationSchema(fieldDef);
		expect(schema).toBeNull();
	});

	it("extracts schema for object with localized nested field", () => {
		const col = collection("test").fields(({ f }) => ({
			profile: f.object({
				name: f.text().required(),
				description: f.text().localized(),
			}),
		}));

		const fieldDef = col.state.fieldDefinitions!.profile;
		const schema = extractNestedLocalizationSchema(fieldDef);
		expect(schema).toEqual({ description: true });
	});

	it("extracts schema for deeply nested localized fields", () => {
		const col = collection("test").fields(({ f }) => ({
			workingHours: f.object({
				monday: f.object({
					isOpen: f.boolean(),
					note: f.text().localized(),
				}),
				tuesday: f.object({
					isOpen: f.boolean(),
					note: f.text().localized(),
				}),
			}),
		}));

		const fieldDef = col.state.fieldDefinitions!.workingHours;
		const schema = extractNestedLocalizationSchema(fieldDef);
		expect(schema).toEqual({
			monday: { note: true },
			tuesday: { note: true },
		});
	});

	it("extracts schema for array with localized item fields", () => {
		const col = collection("test").fields(({ f }) => ({
			links: f
				.object({
					platform: f.text().required(),
					description: f.text().localized(),
				})
				.array(),
		}));

		const fieldDef = col.state.fieldDefinitions!.links;
		const schema = extractNestedLocalizationSchema(fieldDef);
		expect(schema).toEqual({
			_item: { description: true },
		});
	});

	it("returns null for array without localized fields", () => {
		const col = collection("test").fields(({ f }) => ({
			links: f
				.object({
					platform: f.text().required(),
					url: f.text(),
				})
				.array(),
		}));

		const fieldDef = col.state.fieldDefinitions!.links;
		const schema = extractNestedLocalizationSchema(fieldDef);
		expect(schema).toBeNull();
	});

	it("extracts schema for mixed nested structure", () => {
		const col = collection("test").fields(({ f }) => ({
			content: f.object({
				title: f.text().localized(),
				settings: f.object({
					theme: f.text(),
					greeting: f.text().localized(),
				}),
				items: f
					.object({
						name: f.text(),
						label: f.text().localized(),
					})
					.array(),
			}),
		}));

		const fieldDef = col.state.fieldDefinitions!.content;
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
		const col = collection("test").fields(({ f }) => ({
			name: f.text().required(),
			bio: f.text().localized(), // Top-level localized - not nested
			metadata: f.object({
				views: f.number(),
				lastNote: f.text().localized(),
			}),
			tags: f
				.object({
					name: f.text(),
					description: f.text().localized(),
				})
				.array(),
		}));

		const schemas = extractNestedLocalizationSchemas(
			col.state.fieldDefinitions!,
		);

		// bio is top-level localized, not nested - should not be in schemas
		expect(schemas).toEqual({
			metadata: { lastNote: true },
			tags: { _item: { description: true } },
		});
	});

	it("returns empty object for collection without nested localized fields", () => {
		const col = collection("simple").fields(({ f }) => ({
			name: f.text().required(),
			title: f.text().localized(), // Top-level only
		}));

		const schemas = extractNestedLocalizationSchemas(
			col.state.fieldDefinitions!,
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

	it("splits blocks data with _blocks schema", () => {
		const schema = {
			_blocks: {
				hero: { title: true, subtitle: true },
				text: { content: true },
			},
		} as const;

		const data = {
			_tree: [
				{ id: "block-1", type: "hero", children: [] },
				{ id: "block-2", type: "text", children: [] },
				{ id: "block-3", type: "image", children: [] }, // No schema for this
			],
			_values: {
				"block-1": {
					title: "Hero Title",
					subtitle: "Hero Subtitle",
					alignment: "center",
				},
				"block-2": { content: "Some text content" },
				"block-3": { url: "/image.jpg" },
			},
		};

		const result = splitByNestedSchema(data, schema);

		expect(result.structure).toEqual({
			_tree: data._tree,
			_values: {
				"block-1": {
					title: { $i18n: true },
					subtitle: { $i18n: true },
					alignment: "center",
				},
				"block-2": { content: { $i18n: true } },
				"block-3": { url: "/image.jpg" }, // Unchanged
			},
		});
		expect(result.i18nValues).toEqual({
			_values: {
				"block-1": { title: "Hero Title", subtitle: "Hero Subtitle" },
				"block-2": { content: "Some text content" },
			},
		});
	});
});
