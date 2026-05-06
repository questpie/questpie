import { describe, expect, it } from "bun:test";

import { autoExpandFields } from "../../src/client/utils/auto-expand-fields";
import { computeDefaultColumns } from "../../src/client/views/collection/columns";

const fields = {
	title: { name: "text" },
	summary: { name: "textarea" },
	body: { name: "richText" },
	image: { name: "upload", "~options": { relationName: "image" } },
	author: { name: "relation", "~options": { relationName: "author" } },
	status: { name: "select" },
	featured: { name: "boolean" },
	slug: { name: "text" },
	extra: { name: "text" },
	createdAt: { name: "datetime" },
} as any;

const meta = {
	title: { type: "field", fieldName: "title" },
	timestamps: true,
	relations: ["image", "author"],
} as any;

describe("table performance defaults", () => {
	it("keeps auto-generated table defaults compact", () => {
		expect(computeDefaultColumns(fields, { meta })).toEqual([
			"title",
			"summary",
			"status",
			"featured",
			"slug",
			"createdAt",
		]);
	});

	it("keeps explicit list columns intact", () => {
		expect(
			computeDefaultColumns(fields, {
				meta,
				configuredColumns: ["image", "author"],
			}),
		).toEqual(["title", "image", "author"]);
	});

	it("only expands relation data for visible columns", () => {
		expect(
			autoExpandFields({
				fields,
				visibleColumns: ["title", "author"],
				relations: meta.relations,
			}),
		).toEqual({ author: true });
	});

	it("still honors explicit relation expansions", () => {
		expect(
			autoExpandFields({
				fields,
				list: { with: ["image"] },
				visibleColumns: ["title"],
				relations: meta.relations,
			}),
		).toEqual({ image: true });
	});
});
