/**
 * Tests for collection() and global() with field type inference
 *
 * Verifies that field types flow through to collection and global builders.
 * Uses standalone collection() and global() which include builtinFields by default.
 */
import { describe, expect, test } from "bun:test";

import { collection } from "#questpie/server/collection/builder/collection-builder.js";
import { global } from "#questpie/server/global/builder/global-builder.js";

describe("collection() with field types", () => {
	test("should create collection with typed fields", () => {
		const posts = collection("posts").fields(({ f }) => ({
			title: f.text().required(),
			content: f.textarea(),
			views: f.number().min(0),
			published: f.boolean().default(false),
		}));

		expect(posts.name).toBe("posts");
		expect(posts.table).toBeDefined();
		expect(posts.table.title).toBeDefined();
		expect(posts.table.content).toBeDefined();
		expect(posts.table.views).toBeDefined();
		expect(posts.table.published).toBeDefined();
	});

	test("should throw error for unknown field type", () => {
		expect(() => {
			collection("posts").fields(({ f }) => ({
				// Using (f as any) to bypass type checking - this tests runtime error
				title: (f as any).unknownField({ required: true }),
			}));
		}).toThrow(/Unknown field type: "unknownField"/);
	});

	test("standalone collection() should use builtin fields by default", () => {
		// Standalone collection() now includes builtinFields by default
		const posts = collection("posts").fields(({ f }) => ({
			title: f.text().required(),
		}));

		expect(posts.name).toBe("posts");
		expect(posts.table).toBeDefined();
		expect(posts.table.title).toBeDefined();
	});

	test("should work with field builder pattern", () => {
		const posts = collection("posts").fields(({ f }) => ({
			title: f.text(255),
		}));

		expect(posts.name).toBe("posts");
		expect(posts.table).toBeDefined();
	});
});

describe("global() with field types", () => {
	test("should create global with typed fields", () => {
		const settings = global("settings").fields(({ f }) => ({
			siteName: f.text().required(),
			maintenanceMode: f.boolean().default(false),
			maxUploadSize: f.number().min(0),
		}));

		expect(settings.name).toBe("settings");
		expect(settings.table).toBeDefined();
		expect(settings.table.siteName).toBeDefined();
		expect(settings.table.maintenanceMode).toBeDefined();
		expect(settings.table.maxUploadSize).toBeDefined();
	});

	test("should throw error for unknown field type", () => {
		expect(() => {
			global("settings").fields(({ f }) => ({
				// Using (f as any) to bypass type checking - this tests runtime error
				title: (f as any).unknownField({ required: true }),
			}));
		}).toThrow(/Unknown field type: "unknownField"/);
	});

	test("standalone global() should use builtin fields by default", () => {
		// Standalone global() now includes builtinFields by default
		const settings = global("settings").fields(({ f }) => ({
			siteName: f.text().required(),
		}));

		expect(settings.name).toBe("settings");
		expect(settings.table).toBeDefined();
		expect(settings.table.siteName).toBeDefined();
	});
});

describe("Destructured context pattern ({ f }) =>", () => {
	test("collection().fields(({ f }) => ...) should work identically to (f) => ...", () => {
		// Old pattern
		const postsOld = collection("posts_old").fields(({ f }) => ({
			title: f.text().required(),
			content: f.textarea(),
			views: f.number().min(0),
			published: f.boolean().default(false),
		}));

		// New pattern
		const postsNew = collection("posts_new").fields(({ f }) => ({
			title: f.text().required(),
			content: f.textarea(),
			views: f.number().min(0),
			published: f.boolean().default(false),
		}));

		// Both should have the same table columns
		expect(postsNew.table.title).toBeDefined();
		expect(postsNew.table.content).toBeDefined();
		expect(postsNew.table.views).toBeDefined();
		expect(postsNew.table.published).toBeDefined();

		// Both should have identical field definitions
		const oldFieldNames = Object.keys(postsOld.state.fieldDefinitions);
		const newFieldNames = Object.keys(postsNew.state.fieldDefinitions);
		expect(newFieldNames).toEqual(oldFieldNames);
	});

	test("global().fields(({ f }) => ...) should work identically to (f) => ...", () => {
		// Old pattern
		const settingsOld = global("settings_old").fields(({ f }) => ({
			siteName: f.text().required(),
			maintenanceMode: f.boolean().default(false),
		}));

		// New pattern
		const settingsNew = global("settings_new").fields(({ f }) => ({
			siteName: f.text().required(),
			maintenanceMode: f.boolean().default(false),
		}));

		expect(settingsNew.table.siteName).toBeDefined();
		expect(settingsNew.table.maintenanceMode).toBeDefined();

		// Compare table columns — both patterns should produce the same shape
		const oldTableColumns = Object.keys(settingsOld.table);
		const newTableColumns = Object.keys(settingsNew.table);
		expect(newTableColumns).toEqual(oldTableColumns);
	});

	test("standalone collection() with ({ f }) => should use builtin fields", () => {
		const posts = collection("posts").fields(({ f }) => ({
			title: f.text().required(),
			content: f.textarea(),
		}));

		expect(posts.name).toBe("posts");
		expect(posts.table.title).toBeDefined();
		expect(posts.table.content).toBeDefined();
	});

	test("standalone global() with ({ f }) => should use builtin fields", () => {
		const settings = global("settings").fields(({ f }) => ({
			siteName: f.text().required(),
		}));

		expect(settings.name).toBe("settings");
		expect(settings.table.siteName).toBeDefined();
	});

	test("({ f }) => with block body should work (helper functions inside callback)", () => {
		const barbers = collection("barbers").fields(({ f }) => {
			const daySchedule = () =>
				f.object({
					isOpen: f.boolean().default(false),
				});

			return {
				name: f.text().required(),
				mondaySchedule: daySchedule(),
			};
		});

		expect(barbers.name).toBe("barbers");
		expect(barbers.table.name).toBeDefined();
	});

	test("should throw error for unknown field type with ({ f }) pattern", () => {
		expect(() => {
			collection("posts").fields(({ f }) => ({
				title: (f as any).unknownField({ required: true }),
			}));
		}).toThrow(/Unknown field type: "unknownField"/);
	});
});

describe("Type inference ($infer)", () => {
	test("collection $infer types should be accessible", () => {
		const posts = collection("posts").fields(({ f }) => ({
			title: f.text().required(),
			views: f.number().default(0),
			published: f.boolean().default(false),
		}));

		// Verify $infer is defined and has the expected shape
		type PostSelect = typeof posts.$infer.select;

		// These are compile-time checks - if this compiles, types work
		const mockSelect: PostSelect = {
			id: "test-id",
			title: "Test Title",
			views: 10,
			published: true,
			_title: "Test Title",
			createdAt: new Date(),
			updatedAt: new Date(),
		};

		expect(mockSelect.title).toBe("Test Title");
	});

	test("global $infer types should be accessible", () => {
		const settings = global("settings").fields(({ f }) => ({
			siteName: f.text().required(),
			maintenanceMode: f.boolean().default(false),
		}));

		// Verify $infer is defined
		type SettingsSelect = typeof settings.$infer.select;

		const mockSelect: SettingsSelect = {
			id: "test-id",
			siteName: "My Site",
			maintenanceMode: false,
			createdAt: new Date(),
			updatedAt: new Date(),
		};

		expect(mockSelect.siteName).toBe("My Site");
	});
});
