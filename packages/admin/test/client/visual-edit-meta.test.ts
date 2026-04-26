/**
 * VisualEdit metadata resolver tests
 */

import { describe, expect, it } from "bun:test";

import type { FieldInstance } from "#questpie/admin/client/builder/field/field";
import {
	buildStrategyMap,
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

	it("surfaces the inspector component reference from client options", () => {
		const inspector = { type: "rich-text-inspector", props: {} } as const;
		const meta = resolveVisualEditMeta({
			fieldDef: fieldInstance("text", {
				admin: { visualEdit: { inspector } },
			}),
			fieldSchema: { metadata: { type: "text" } },
		});
		expect(meta?.inspector).toBe(inspector);
	});

	it("surfaces the inspector component reference from server schema", () => {
		const inspector = {
			type: "rich-text-inspector",
			props: { variant: "compact" },
		} as const;
		const meta = resolveVisualEditMeta({
			fieldDef: fieldInstance("text"),
			fieldSchema: {
				admin: { visualEdit: { inspector } },
				metadata: { type: "text" },
			},
		});
		expect(meta?.inspector).toBe(inspector);
	});

	it("server inspector override wins over client", () => {
		const clientInspector = { type: "client-inspector", props: {} } as const;
		const serverInspector = { type: "server-inspector", props: {} } as const;
		const meta = resolveVisualEditMeta({
			fieldDef: fieldInstance("text", {
				admin: { visualEdit: { inspector: clientInspector } },
			}),
			fieldSchema: {
				admin: { visualEdit: { inspector: serverInspector } },
				metadata: { type: "text" },
			},
		});
		expect(meta?.inspector).toBe(serverInspector);
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

describe("buildStrategyMap", () => {
	it("returns an empty map when fields is undefined", () => {
		expect(buildStrategyMap({ fields: undefined, schema: undefined })).toEqual(
			{},
		);
	});

	it("returns an empty map when fields is empty", () => {
		expect(buildStrategyMap({ fields: {}, schema: undefined })).toEqual({});
	});

	it("resolves the strategy for every field", () => {
		const map = buildStrategyMap({
			fields: {
				title: fieldInstance("text"),
				author: fieldInstance("relation"),
				cover: fieldInstance("upload"),
				body: fieldInstance("blocks"),
			},
			schema: undefined,
		});
		expect(map).toEqual({
			title: "patch",
			author: "refresh",
			cover: "refresh",
			body: "refresh",
		});
	});

	it("honours per-field visualEdit.patchStrategy overrides", () => {
		const map = buildStrategyMap({
			fields: {
				title: fieldInstance("text", {
					admin: { visualEdit: { patchStrategy: "deferred" } },
				}),
				author: fieldInstance("relation", {
					admin: { visualEdit: { patchStrategy: "patch" } },
				}),
			},
			schema: undefined,
		});
		expect(map).toEqual({ title: "deferred", author: "patch" });
	});

	it("threads the schema through to resolvePatchStrategy (server wins)", () => {
		const map = buildStrategyMap({
			fields: {
				title: fieldInstance("text", {
					admin: { visualEdit: { patchStrategy: "patch" } },
				}),
			},
			schema: {
				fields: {
					title: {
						admin: { visualEdit: { patchStrategy: "refresh" } },
					} as any,
				},
			},
		});
		expect(map.title).toBe("refresh");
	});
});
