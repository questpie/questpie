/**
 * groupFieldsForDocument tests
 */

import { describe, expect, it } from "bun:test";

import type { FieldInstance } from "#questpie/admin/client/builder/field/field";
import {
	DEFAULT_DOCUMENT_GROUP_KEY,
	groupFieldsForDocument,
	hasExplicitGroups,
} from "#questpie/admin/client/components/visual-edit/group-fields";

function field(
	name: string,
	options: Record<string, unknown> = {},
): FieldInstance {
	return Object.freeze({
		name,
		component: () => null,
		"~options": options,
	}) as unknown as FieldInstance;
}

describe("groupFieldsForDocument — empty", () => {
	it("returns no groups when fields is empty", () => {
		const result = groupFieldsForDocument({ fields: {} });
		expect(result).toEqual([]);
	});
});

describe("groupFieldsForDocument — default group", () => {
	it("puts every field with no metadata in the default group, preserving order", () => {
		const result = groupFieldsForDocument({
			fields: {
				title: field("text"),
				slug: field("text"),
				body: field("richText"),
			},
		});

		expect(result).toHaveLength(1);
		expect(result[0]!.key).toBe(DEFAULT_DOCUMENT_GROUP_KEY);
		expect(result[0]!.fields.map((f) => f.name)).toEqual([
			"title",
			"slug",
			"body",
		]);
	});
});

describe("groupFieldsForDocument — explicit groups", () => {
	it("groups by visualEdit.group, preserving first-seen group order", () => {
		const result = groupFieldsForDocument({
			fields: {
				title: field("text", {
					admin: { visualEdit: { group: "content" } },
				}),
				ogImage: field("upload", {
					admin: { visualEdit: { group: "seo" } },
				}),
				body: field("richText", {
					admin: { visualEdit: { group: "content" } },
				}),
				slug: field("text"),
			},
		});

		expect(result.map((g) => g.key)).toEqual([
			"content",
			"seo",
			DEFAULT_DOCUMENT_GROUP_KEY,
		]);
		expect(result[0]!.fields.map((f) => f.name)).toEqual([
			"title",
			"body",
		]);
		expect(result[1]!.fields.map((f) => f.name)).toEqual(["ogImage"]);
		expect(result[2]!.fields.map((f) => f.name)).toEqual(["slug"]);
	});

	it("falls back to BaseAdminMeta.group when visualEdit doesn't set group", () => {
		const result = groupFieldsForDocument({
			fields: {
				title: field("text", { admin: { group: "content" } }),
				slug: field("text", { admin: { group: "seo" } }),
			},
		});
		expect(result.map((g) => g.key)).toEqual(["content", "seo"]);
	});

	it("prefers visualEdit.group over admin.group", () => {
		const result = groupFieldsForDocument({
			fields: {
				title: field("text", {
					admin: { group: "content", visualEdit: { group: "seo" } },
				}),
			},
		});
		expect(result.map((g) => g.key)).toEqual(["seo"]);
	});
});

describe("groupFieldsForDocument — sorting within group", () => {
	it("sorts by visualEdit.order ascending, ties fall back to insertion order", () => {
		const result = groupFieldsForDocument({
			fields: {
				a: field("text", {
					admin: { visualEdit: { group: "g", order: 3 } },
				}),
				b: field("text", { admin: { visualEdit: { group: "g" } } }),
				c: field("text", {
					admin: { visualEdit: { group: "g", order: 1 } },
				}),
				d: field("text", {
					admin: { visualEdit: { group: "g", order: 1 } },
				}),
			},
		});

		expect(result.map((g) => g.key)).toEqual(["g"]);
		// c and d both order=1, c first by insertion; then a (3); then b (no order = MAX)
		expect(result[0]!.fields.map((f) => f.name)).toEqual([
			"c",
			"d",
			"a",
			"b",
		]);
	});

	it("falls back to admin.order when visualEdit.order is unset", () => {
		const result = groupFieldsForDocument({
			fields: {
				a: field("text", { admin: { order: 2 } }),
				b: field("text", { admin: { order: 1 } }),
			},
		});
		expect(result[0]!.fields.map((f) => f.name)).toEqual(["b", "a"]);
	});
});

describe("groupFieldsForDocument — hidden", () => {
	it("drops fields with visualEdit.hidden === true", () => {
		const result = groupFieldsForDocument({
			fields: {
				title: field("text"),
				secret: field("text", {
					admin: { visualEdit: { hidden: true } },
				}),
			},
		});
		expect(result[0]!.fields.map((f) => f.name)).toEqual(["title"]);
	});

	it("keeps fields with reactive hidden — they evaluate at render time", () => {
		const result = groupFieldsForDocument({
			fields: {
				maybe: field("text", {
					admin: { visualEdit: { hidden: () => true } },
				}),
			},
		});
		expect(result[0]!.fields.map((f) => f.name)).toEqual(["maybe"]);
	});

	it("keeps fields with hidden === false", () => {
		const result = groupFieldsForDocument({
			fields: {
				title: field("text", {
					admin: { visualEdit: { hidden: false } },
				}),
			},
		});
		expect(result[0]!.fields.map((f) => f.name)).toEqual(["title"]);
	});
});

describe("hasExplicitGroups", () => {
	it("returns false when only default group is present", () => {
		const groups = groupFieldsForDocument({
			fields: { a: field("text"), b: field("text") },
		});
		expect(hasExplicitGroups(groups)).toBe(false);
	});

	it("returns true when at least one non-default group exists", () => {
		const groups = groupFieldsForDocument({
			fields: {
				a: field("text", { admin: { visualEdit: { group: "seo" } } }),
				b: field("text"),
			},
		});
		expect(hasExplicitGroups(groups)).toBe(true);
	});
});

describe("groupFieldsForDocument — schema overrides", () => {
	it("server visualEdit metadata wins over client", () => {
		const result = groupFieldsForDocument({
			fields: {
				title: field("text", {
					admin: { visualEdit: { group: "client" } },
				}),
			},
			schema: {
				fields: {
					title: {
						admin: { visualEdit: { group: "server" } },
					} as any,
				},
			} as any,
		});
		expect(result.map((g) => g.key)).toEqual(["server"]);
	});
});
