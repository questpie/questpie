/**
 * Unified Relation Field Tests
 *
 * Tests for the unified f.relation() API in .fields()
 */

import { describe, expect, test } from "bun:test";
import { pgTable, varchar } from "drizzle-orm/pg-core";
import { createFieldBuilderFromDefs } from "#questpie/server/fields/builder.js";
import { defaultFields } from "#questpie/server/fields/builtin/index.js";
import type { RelationFieldMetadata } from "#questpie/server/fields/types.js";

// Mock tables for testing
const usersTable = pgTable("users", {
  id: varchar("id", { length: 36 }).primaryKey(),
});

const postsTable = pgTable("posts", {
  id: varchar("id", { length: 36 }).primaryKey(),
});

const tagsTable = pgTable("tags", {
  id: varchar("id", { length: 36 }).primaryKey(),
});

const postTagsTable = pgTable("post_tags", {
  postId: varchar("post_id", { length: 36 }),
  tagId: varchar("tag_id", { length: 36 }),
});

// Mock collections
const mockUsers = { name: "users", table: usersTable };
const mockPosts = { name: "posts", table: postsTable };
const mockTags = { name: "tags", table: tagsTable };
const mockPostTags = { name: "postTags", table: postTagsTable };

describe("Unified Relation Field", () => {
  // Create a callable proxy from plain field defs
  const fields = createFieldBuilderFromDefs(defaultFields);

  test("belongsTo relation is created correctly", () => {
    const relationField = fields.relation({
      to: () => mockUsers as any,
      required: true,
    });

    // Verify it's a field definition
    expect(relationField).toBeDefined();
    expect(typeof relationField.toColumn).toBe("function");
    expect(typeof relationField.toZodSchema).toBe("function");
    expect(typeof relationField.getMetadata).toBe("function");

    // belongsTo creates a column (FK)
    const column = relationField.toColumn("author");
    expect(column).not.toBeNull();
  });

  test("hasMany relation has no column", () => {
    const relationField = fields.relation({
      to: () => mockPosts as any,
      hasMany: true,
      foreignKey: "authorId",
    });

    expect(relationField).toBeDefined();

    // hasMany has no column
    const column = relationField.toColumn("posts");
    expect(column).toBeNull();
  });

  test("manyToMany relation has no column", () => {
    const relationField = fields.relation({
      to: () => mockTags as any,
      hasMany: true,
      through: () => mockPostTags as any,
      sourceField: "postId",
      targetField: "tagId",
    });

    expect(relationField).toBeDefined();

    // manyToMany has no column
    const column = relationField.toColumn("tags");
    expect(column).toBeNull();
  });

  test("multiple relation creates jsonb column", () => {
    const relationField = fields.relation({
      to: () => mockUsers as any,
      multiple: true,
    });

    expect(relationField).toBeDefined();

    // multiple creates a jsonb column
    const column = relationField.toColumn("assignees");
    expect(column).not.toBeNull();
  });

  test("relation field metadata is correct", () => {
    const relationField = fields.relation({
      to: () => mockUsers as any,
      label: "Author",
      required: true,
    });

    const metadata = relationField.getMetadata();
    expect(metadata.type).toBe("relation");

    // Type guard to narrow to RelationFieldMetadata
    function isRelationMetadata(
      md: typeof metadata,
    ): md is RelationFieldMetadata {
      return md.type === "relation";
    }

    if (isRelationMetadata(metadata)) {
      // When using a callback that can be resolved (no circular ref),
      // targetCollection is resolved immediately to the collection name
      expect(metadata.targetCollection).toBe("users");
      expect(metadata.relationType).toBe("belongsTo");
      // The original config is stored for runtime resolution
      expect(metadata._toConfig).toBeDefined();
    }
    expect(metadata.required).toBe(true);
  });

  test("relation generates correct Zod schema", () => {
    // belongsTo: required
    const requiredRelation = fields.relation({
      to: () => mockUsers as any,
      required: true,
    });
    const requiredSchema = requiredRelation.toZodSchema();
    expect(requiredSchema).toBeDefined();

    // belongsTo: optional
    const optionalRelation = fields.relation({
      to: () => mockUsers as any,
    });
    const optionalSchema = optionalRelation.toZodSchema();
    expect(optionalSchema).toBeDefined();

    // hasMany
    const hasManyRelation = fields.relation({
      to: () => mockPosts as any,
      hasMany: true,
      foreignKey: "authorId",
    });
    const hasManySchema = hasManyRelation.toZodSchema();
    expect(hasManySchema).toBeDefined();
  });

  test("morphTo (polymorphic) creates type and id columns", () => {
    const relationField = fields.relation({
      to: {
        users: () => mockUsers as any,
        posts: () => mockPosts as any,
      },
      required: true,
    });

    expect(relationField).toBeDefined();

    // morphTo creates multiple columns (type + id)
    const columns = relationField.toColumn("subject");
    expect(Array.isArray(columns)).toBe(true);
    expect(columns).toHaveLength(2);
  });

  test("onDelete option is captured in metadata", () => {
    const relationField = fields.relation({
      to: () => mockUsers as any,
      required: true,
      onDelete: "cascade",
    });

    const metadata = relationField.getMetadata() as RelationFieldMetadata;
    expect(metadata.onDelete).toBe("cascade");
  });

  test("relationName option is captured in metadata", () => {
    const relationField = fields.relation({
      to: () => mockUsers as any,
      relationName: "authorRelation",
    });

    const metadata = relationField.getMetadata() as RelationFieldMetadata;
    expect(metadata.relationName).toBe("authorRelation");
  });
});
