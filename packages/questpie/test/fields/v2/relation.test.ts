/**
 * Field V2 — Relation + Upload Field Tests
 *
 * Tests all 6 relation variants and upload fields.
 */

import { describe, expect, it } from "bun:test";

import {
	relation,
	upload,
} from "#questpie/server/modules/core/fields/index.js";
import { Field } from "#questpie/server/fields/field-class.js";

// ============================================================================
// BelongsTo (default)
// ============================================================================

describe("relation() — belongsTo", () => {
	it("creates a belongsTo relation by default", () => {
		const f = relation("users");
		expect(f).toBeInstanceOf(Field);
		expect(f._state.type).toBe("relation");
		expect(f._state.to).toBe("users");
	});

	it("generates a varchar(36) column", () => {
		const col = relation("users").toColumn("authorId") as any;
		expect(col).toBeDefined();
		expect(col).not.toBeNull();
	});

	it("generates UUID schema", () => {
		const schema = relation("users").required().toZodSchema();
		expect(
			schema.safeParse("550e8400-e29b-41d4-a716-446655440000").success,
		).toBe(true);
		expect(schema.safeParse("not-a-uuid").success).toBe(false);
	});

	it("nullable by default", () => {
		const schema = relation("users").toZodSchema();
		expect(schema.safeParse(null).success).toBe(true);
	});

	it(".required() makes column notNull", () => {
		const f = relation("users").required();
		expect(f._state.notNull).toBe(true);

		const col = f.toColumn("authorId") as any;
		expect(col.config?.notNull ?? col.isNotNull).toBe(true);
	});

	it(".onDelete() sets referential action", () => {
		const f = relation("users").onDelete("cascade");
		expect(f._state.onDelete).toBe("cascade");
	});

	it(".onUpdate() sets referential action", () => {
		const f = relation("users").onUpdate("restrict");
		expect(f._state.onUpdate).toBe("restrict");
	});

	it(".relationName() sets disambiguation name", () => {
		const f = relation("users").relationName("author");
		expect(f._state.relationName).toBe("author");
	});

	it("has belongsTo operators (eq, ne, in, notIn, is, isNot)", () => {
		const ops = relation("users").getOperators();
		expect(ops.column.eq).toBeDefined();
		expect(ops.column.ne).toBeDefined();
		expect(ops.column.in).toBeDefined();
		expect(ops.column.is).toBeDefined();
		expect(ops.column.isNot).toBeDefined();
	});

	it("getMetadata() returns relation metadata", () => {
		const meta = relation("users").required().getMetadata() as any;
		expect(meta.type).toBe("relation");
		expect(meta.relationType).toBe("belongsTo");
		expect(meta.targetCollection).toBe("users");
		expect(meta.required).toBe(true);
	});
});

// ============================================================================
// HasMany
// ============================================================================

describe("relation().hasMany()", () => {
	it("creates a hasMany relation", () => {
		const f = relation("posts").hasMany({ foreignKey: "authorId" });
		expect(f._state.hasMany).toBe(true);
		expect(f._state.foreignKey).toBe("authorId");
	});

	it("has no column (virtual)", () => {
		const f = relation("posts").hasMany({ foreignKey: "authorId" });
		expect(f._state.virtual).toBe(true);
		expect(f.toColumn("posts")).toBeNull();
	});

	it("has toMany operators (some, none, every, count)", () => {
		const ops = relation("posts")
			.hasMany({ foreignKey: "authorId" })
			.getOperators();
		expect(ops.column.some).toBeDefined();
		expect(ops.column.none).toBeDefined();
		expect(ops.column.every).toBeDefined();
		expect(ops.column.count).toBeDefined();
	});

	it("getMetadata() returns hasMany metadata", () => {
		const meta = relation("posts")
			.hasMany({ foreignKey: "authorId" })
			.getMetadata() as any;
		expect(meta.relationType).toBe("hasMany");
		expect(meta.foreignKey).toBe("authorId");
	});
});

// ============================================================================
// ManyToMany
// ============================================================================

describe("relation().manyToMany()", () => {
	it("creates a manyToMany relation", () => {
		const f = relation("tags").manyToMany({
			through: "post_tags",
			sourceField: "postId",
			targetField: "tagId",
		});
		expect(f._state.hasMany).toBe(true);
		expect(f._state.through).toBe("post_tags");
		expect(f._state.sourceField).toBe("postId");
		expect(f._state.targetField).toBe("tagId");
	});

	it("has no column (virtual)", () => {
		const f = relation("tags").manyToMany({ through: "post_tags" });
		expect(f._state.virtual).toBe(true);
		expect(f.toColumn("tags")).toBeNull();
	});

	it("has toMany operators", () => {
		const ops = relation("tags")
			.manyToMany({ through: "post_tags" })
			.getOperators();
		expect(ops.column.some).toBeDefined();
		expect(ops.column.none).toBeDefined();
	});

	it("getMetadata() returns manyToMany metadata", () => {
		const meta = relation("tags")
			.manyToMany({
				through: "post_tags",
				sourceField: "postId",
				targetField: "tagId",
			})
			.getMetadata() as any;
		expect(meta.relationType).toBe("manyToMany");
		expect(meta.through).toBe("post_tags");
		expect(meta.sourceField).toBe("postId");
		expect(meta.targetField).toBe("tagId");
	});
});

// ============================================================================
// Multiple (jsonb array of FKs)
// ============================================================================

describe("relation().multiple()", () => {
	it("creates a multiple relation", () => {
		const f = relation("assets").multiple();
		expect(f._state.multiple).toBe(true);
	});

	it("generates jsonb column", () => {
		const col = relation("assets").multiple().toColumn("images") as any;
		expect(col).toBeDefined();
		expect(col).not.toBeNull();
	});

	it("generates array of UUID schema", () => {
		const schema = relation("assets").multiple().required().toZodSchema();
		expect(
			schema.safeParse(["550e8400-e29b-41d4-a716-446655440000"]).success,
		).toBe(true);
		expect(schema.safeParse("not-array").success).toBe(false);
	});

	it("has multiple operators (contains, containsAll, containsAny, etc.)", () => {
		const ops = relation("assets").multiple().getOperators();
		expect(ops.column.contains).toBeDefined();
		expect(ops.column.containsAll).toBeDefined();
		expect(ops.column.containsAny).toBeDefined();
		expect(ops.column.isEmpty).toBeDefined();
	});

	it("getMetadata() returns multiple metadata", () => {
		const meta = relation("assets").multiple().getMetadata() as any;
		expect(meta.relationType).toBe("multiple");
	});
});

// ============================================================================
// MorphTo (polymorphic)
// ============================================================================

describe("relation() — morphTo", () => {
	it("creates a morphTo relation from object target", () => {
		const f = relation({ users: "users", posts: "posts" } as any);
		expect(f._state.to).toEqual({ users: "users", posts: "posts" });
	});

	it("generates schema with type + id", () => {
		const schema = relation({ users: "users", posts: "posts" } as any)
			.required()
			.toZodSchema();
		expect(
			schema.safeParse({
				type: "users",
				id: "550e8400-e29b-41d4-a716-446655440000",
			}).success,
		).toBe(true);
		expect(schema.safeParse({ type: "invalid", id: "abc" }).success).toBe(
			false,
		);
	});

	it("getMetadata() returns morphTo metadata", () => {
		const meta = relation({
			users: "users",
			posts: "posts",
		} as any).getMetadata() as any;
		expect(meta.relationType).toBe("morphTo");
		expect(meta.targetCollection).toEqual(["users", "posts"]);
	});
});

// ============================================================================
// Upload
// ============================================================================

describe("upload()", () => {
	it("creates a single upload field (belongsTo assets)", () => {
		const f = upload();
		expect(f._state.type).toBe("upload");
		expect(f._state.to).toBe("assets");
	});

	it("generates varchar(36) column for single upload", () => {
		const col = upload().toColumn("avatar") as any;
		expect(col).toBeDefined();
		expect(col).not.toBeNull();
	});

	it("generates UUID schema for single upload", () => {
		const schema = upload().required().toZodSchema();
		expect(
			schema.safeParse("550e8400-e29b-41d4-a716-446655440000").success,
		).toBe(true);
	});

	it("M2M upload has no column", () => {
		const f = upload({ through: "post_assets" });
		expect(f._state.virtual).toBe(true);
		expect(f.toColumn("gallery")).toBeNull();
	});

	it("M2M upload generates array schema", () => {
		const schema = upload({ through: "post_assets" }).toZodSchema();
		expect(
			schema.safeParse(["550e8400-e29b-41d4-a716-446655440000"]).success,
		).toBe(true);
	});

	it("supports custom target collection", () => {
		const f = upload({ to: "media" });
		expect(f._state.to).toBe("media");
	});

	it("getMetadata() includes isUpload flag", () => {
		const meta = upload().getMetadata() as any;
		expect(meta.type).toBe("relation");
		expect(meta.isUpload).toBe(true);
		expect(meta.targetCollection).toBe("assets");
		expect(meta.relationType).toBe("belongsTo");
	});

	it("M2M getMetadata() reports manyToMany", () => {
		const meta = upload({ through: "post_assets" }).getMetadata() as any;
		expect(meta.relationType).toBe("manyToMany");
		expect(meta.through).toBe("post_assets");
		expect(meta.isUpload).toBe(true);
	});
});

// ============================================================================
// Cross-cutting
// ============================================================================

describe("Relation cross-cutting", () => {
	it("chaining is immutable", () => {
		const base = relation("users");
		const required = base.required();
		const withLabel = required.label({ en: "Author" });

		expect(base._state.notNull).toBe(false);
		expect(required._state.notNull).toBe(true);
		expect(withLabel._state.label).toEqual({ en: "Author" });
		expect(required._state.label).toBeUndefined();
	});

	it("label and description work on relations", () => {
		const f = relation("users")
			.required()
			.label({ en: "Author" })
			.description({ en: "The post author" });

		expect(f._state.label).toEqual({ en: "Author" });
		expect(f._state.description).toEqual({ en: "The post author" });
	});
});
