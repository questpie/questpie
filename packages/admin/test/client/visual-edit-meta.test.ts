/**
 * VisualEdit metadata resolver tests
 */

import { describe, expect, it } from "bun:test";

import type { FieldInstance } from "#questpie/admin/client/builder/field/field";
import {
	buildStrategyMap,
	defaultPatchStrategy,
	resolveNestedVisualEditMeta,
	resolvePatchStrategy,
	resolveVisualEditMeta,
} from "#questpie/admin/client/components/visual-edit/visual-edit-meta";

/**
 * Construct a top-level FieldSchema-shaped object — what
 * `controller.schema.fields[name]` looks like at runtime.
 * Wraps the metadata under `.metadata`.
 */
function fieldSchema(opts: {
	type?: string;
	visualEdit?: Record<string, unknown>;
	nestedFields?: Record<string, unknown>;
}) {
	return { metadata: nestedMetadata(opts) } as any;
}

/**
 * Construct a nested FieldMetadata-shaped object — what nested
 * children look like under `metadata.nestedFields[name]`. No
 * extra `.metadata` wrap; the metadata fields are at the root.
 */
function nestedMetadata(opts: {
	type?: string;
	visualEdit?: Record<string, unknown>;
	nestedFields?: Record<string, unknown>;
}) {
	return {
		type: opts.type,
		meta: opts.visualEdit
			? { admin: { visualEdit: opts.visualEdit } }
			: undefined,
		nestedFields: opts.nestedFields,
	} as any;
}

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
			fieldSchema: fieldSchema({
				type: "text",
				visualEdit: { patchStrategy: "patch" },
			}),
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
			fieldSchema: fieldSchema({ type: "text", visualEdit: { inspector } }),
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
			fieldSchema: fieldSchema({
				type: "text",
				visualEdit: { inspector: serverInspector },
			}),
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

	it("returns 'patch' when neither schema nor fieldDef is provided", () => {
		// The patcher passes whatever it has from the resolver; if the
		// caller doesn't have either source the safest default is
		// patch (preserves V2's optimistic-update path) — refresh
		// would silently reload the iframe on every edit of the
		// orphan field.
		expect(defaultPatchStrategy({})).toBe("patch");
	});

	it("returns 'patch' when type is unknown (neither schema nor fieldDef.name match REFRESH set)", () => {
		// `fieldInstance("custom-type")` exercises the branch where
		// the `type` is truthy but not in REFRESH_FIELD_TYPES — the
		// scalar default applies.
		expect(
			defaultPatchStrategy({
				fieldDef: fieldInstance("custom-scalar"),
			}),
		).toBe("patch");
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
					title: fieldSchema({
						type: "text",
						visualEdit: { patchStrategy: "refresh" },
					}),
				},
			},
		});
		expect(map.title).toBe("refresh");
	});
});

describe("resolveNestedVisualEditMeta", () => {
	it("falls through to the top-level visualEdit when relativePath is empty", () => {
		const inspector = { type: "x", props: {} } as const;
		const meta = resolveNestedVisualEditMeta({
			fieldSchema: fieldSchema({
				type: "object",
				visualEdit: { inspector },
			}),
			relativePath: "",
		});
		expect(meta?.inspector).toBe(inspector);
	});

	it("returns the deepest nested visualEdit when present", () => {
		const outer = { type: "outer", props: {} } as const;
		const inner = { type: "inner", props: {} } as const;
		const meta = resolveNestedVisualEditMeta({
			fieldSchema: fieldSchema({
				type: "object",
				visualEdit: { inspector: outer },
				nestedFields: {
					seo: nestedMetadata({
						type: "object",
						visualEdit: { inspector: inner },
					}),
				},
			}),
			relativePath: "seo",
		});
		expect(meta?.inspector).toBe(inner);
	});

	it("returns the deepest visualEdit across multiple levels", () => {
		const inner = { type: "deep", props: {} } as const;
		const meta = resolveNestedVisualEditMeta({
			fieldSchema: fieldSchema({
				type: "object",
				nestedFields: {
					seo: nestedMetadata({
						type: "object",
						nestedFields: {
							title: nestedMetadata({
								type: "text",
								visualEdit: { inspector: inner },
							}),
						},
					}),
				},
			}),
			relativePath: "seo.title",
		});
		expect(meta?.inspector).toBe(inner);
	});

	it("falls back to a shallower override when the deeper segment has none", () => {
		const outer = { type: "outer", props: {} } as const;
		const meta = resolveNestedVisualEditMeta({
			fieldSchema: fieldSchema({
				type: "object",
				visualEdit: { inspector: outer },
				nestedFields: {
					seo: nestedMetadata({
						type: "object",
						nestedFields: {
							title: nestedMetadata({ type: "text" }),
						},
					}),
				},
			}),
			relativePath: "seo.title",
		});
		expect(meta?.inspector).toBe(outer);
	});

	it("halts the descent at numeric segments (array indices)", () => {
		const outer = { type: "outer", props: {} } as const;
		const beyond = { type: "beyond", props: {} } as const;
		const meta = resolveNestedVisualEditMeta({
			fieldSchema: fieldSchema({
				type: "array",
				visualEdit: { inspector: outer },
				nestedFields: {
					// `5` is the numeric segment that should halt walking
					"5": nestedMetadata({
						type: "object",
						visualEdit: { inspector: beyond },
					}),
				},
			}),
			relativePath: "5",
		});
		// The walk halts at the numeric segment; the overall result
		// is the top-level (outer) inspector.
		expect(meta?.inspector).toBe(outer);
	});

	it("returns undefined when neither schema nor field has visualEdit", () => {
		const meta = resolveNestedVisualEditMeta({
			fieldSchema: fieldSchema({ type: "object" }),
			relativePath: "seo.title",
		});
		expect(meta).toBeUndefined();
	});

	it("falls back to fieldDef ~options when no schema visualEdit anywhere on the path", () => {
		const inspector = { type: "x", props: {} } as const;
		const meta = resolveNestedVisualEditMeta({
			fieldDef: {
				name: "object",
				component: () => null,
				"~options": { admin: { visualEdit: { inspector } } },
			} as unknown as FieldInstance,
			fieldSchema: fieldSchema({
				type: "object",
				nestedFields: {
					seo: nestedMetadata({ type: "text" }),
				},
			}),
			relativePath: "seo",
		});
		expect(meta?.inspector).toBe(inspector);
	});
});
