import { describe, expect, it } from "bun:test";

import { resolveKnownPreviewPath } from "#questpie/admin/client/preview/paths";

const collectionSchema = {
	fields: {
		title: { metadata: { type: "text" } },
		seo: {
			metadata: {
				type: "object",
				nestedFields: {
					title: { type: "text" },
					tags: {
						type: "array",
						nestedFields: {
							label: { type: "text" },
						},
					},
				},
			},
		},
		body: { metadata: { type: "richText" } },
		content: { metadata: { type: "blocks" } },
	},
} as any;

const blocks = {
	hero: {
		fields: {
			heading: { metadata: { type: "text" } },
			copy: { metadata: { type: "richText" } },
			settings: {
				metadata: {
					type: "object",
					nestedFields: {
						eyebrow: { type: "text" },
					},
				},
			},
		},
	},
} as any;

const values = {
	content: {
		_tree: [{ id: "block-a", type: "hero", children: [] }],
		_values: {
			"block-a": {
				heading: "Hello",
				copy: { type: "doc", content: [{ type: "paragraph" }] },
				settings: { eyebrow: "New" },
			},
		},
	},
};

describe("resolveKnownPreviewPath", () => {
	it("accepts known scalar fields", () => {
		expect(resolveKnownPreviewPath("title", { schema: collectionSchema })).toBe(
			"title",
		);
	});

	it("accepts known nested object and array item fields", () => {
		expect(
			resolveKnownPreviewPath("seo.title", { schema: collectionSchema }),
		).toBe("seo.title");
		expect(
			resolveKnownPreviewPath("seo.tags.0.label", {
				schema: collectionSchema,
			}),
		).toBe("seo.tags.0.label");
	});

	it("accepts rich text internals under a known rich text field", () => {
		expect(
			resolveKnownPreviewPath("body.content.0.content.0.text", {
				schema: collectionSchema,
			}),
		).toBe("body.content.0.content.0.text");
	});

	it("accepts known block value fields using the block id type", () => {
		expect(
			resolveKnownPreviewPath("content._values.block-a.heading", {
				schema: collectionSchema,
				blocks,
				values,
			}),
		).toBe("content._values.block-a.heading");
		expect(
			resolveKnownPreviewPath("content._values.block-a.settings.eyebrow", {
				schema: collectionSchema,
				blocks,
				values,
			}),
		).toBe("content._values.block-a.settings.eyebrow");
	});

	it("rejects unknown or unsafe paths", () => {
		expect(
			resolveKnownPreviewPath("unknown", { schema: collectionSchema }),
		).toBeUndefined();
		expect(
			resolveKnownPreviewPath("content._values.block-a.missing", {
				schema: collectionSchema,
				blocks,
				values,
			}),
		).toBeUndefined();
		expect(
			resolveKnownPreviewPath("__proto__.polluted", {
				schema: collectionSchema,
			}),
		).toBeUndefined();
	});
});
