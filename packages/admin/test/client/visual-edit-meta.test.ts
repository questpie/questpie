/**
 * VisualEdit metadata resolver tests
 */

import { describe, expect, it } from "bun:test";

import type { FieldInstance } from "#questpie/admin/client/builder/field/field";
import {
	defaultPatchStrategy,
	resolvePatchStrategy,
	resolveVisualEditMeta,
} from "#questpie/admin/client/components/visual-edit/visual-edit-meta";

function fieldInstance(
	name: string,
	options: Record<string, unknown> = {},
): FieldInstance {
	return Object.freeze({
		name,
		component: () => null,
		"~options": options,
	}) as unknown as FieldInstance;
}

describe("resolveVisualEditMeta", () => {
	it("returns undefined when no source has visualEdit", () => {
		expect(
			resolveVisualEditMeta({
				fieldDef: fieldInstance("text"),
				fieldSchema: { metadata: { type: "text" } },
			}),
		).toBeUndefined();
	});

	it("prefers schema metadata over field-instance options", () => {
		const meta = resolveVisualEditMeta({
			fieldDef: fieldInstance("text", {
				admin: { visualEdit: { patchStrategy: "deferred" } },
			}),
			fieldSchema: {
				admin: { visualEdit: { patchStrategy: "patch" } },
				metadata: { type: "text" },
			},
		});
		expect(meta?.patchStrategy).toBe("patch");
	});

	it("falls back to field-instance options", () => {
		const meta = resolveVisualEditMeta({
			fieldDef: fieldInstance("text", {
				admin: { visualEdit: { group: "seo", order: 2 } },
			}),
			fieldSchema: { metadata: { type: "text" } },
		});
		expect(meta?.group).toBe("seo");
		expect(meta?.order).toBe(2);
	});
});

describe("defaultPatchStrategy", () => {
	it("returns 'patch' for scalar text fields", () => {
		expect(
			defaultPatchStrategy({
				fieldDef: fieldInstance("text"),
				fieldSchema: { metadata: { type: "text" } },
			}),
		).toBe("patch");
	});

	it("returns 'refresh' for relation fields", () => {
		expect(
			defaultPatchStrategy({
				fieldSchema: { metadata: { type: "relation" } },
			}),
		).toBe("refresh");
	});

	it("returns 'refresh' for upload fields", () => {
		expect(
			defaultPatchStrategy({
				fieldSchema: { metadata: { type: "upload" } },
			}),
		).toBe("refresh");
	});

	it("returns 'refresh' for blocks fields", () => {
		expect(
			defaultPatchStrategy({
				fieldSchema: { metadata: { type: "blocks" } },
			}),
		).toBe("refresh");
	});

	it("returns 'refresh' when the field declares a server compute handler", () => {
		expect(
			defaultPatchStrategy({
				fieldDef: fieldInstance("text", {
					admin: { compute: { handler: () => "x" } },
				}),
				fieldSchema: { metadata: { type: "text" } },
			}),
		).toBe("refresh");
	});

	it("falls back to field-instance name when schema is absent", () => {
		expect(
			defaultPatchStrategy({
				fieldDef: fieldInstance("relation"),
			}),
		).toBe("refresh");
	});
});

describe("resolvePatchStrategy", () => {
	it("honours an explicit visualEdit.patchStrategy override", () => {
		expect(
			resolvePatchStrategy({
				fieldDef: fieldInstance("text", {
					admin: { visualEdit: { patchStrategy: "refresh" } },
				}),
				fieldSchema: { metadata: { type: "text" } },
			}),
		).toBe("refresh");

		expect(
			resolvePatchStrategy({
				fieldDef: fieldInstance("relation", {
					admin: { visualEdit: { patchStrategy: "patch" } },
				}),
				fieldSchema: { metadata: { type: "relation" } },
			}),
		).toBe("patch");
	});

	it("falls back to the type-driven default when no override", () => {
		expect(
			resolvePatchStrategy({
				fieldDef: fieldInstance("text"),
				fieldSchema: { metadata: { type: "text" } },
			}),
		).toBe("patch");

		expect(
			resolvePatchStrategy({
				fieldDef: fieldInstance("relation"),
				fieldSchema: { metadata: { type: "relation" } },
			}),
		).toBe("refresh");
	});
});
