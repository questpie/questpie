import { expect, test } from "bun:test";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");

test("rejects empty, missing, structural, and JSON-backed B-tree terms before projection", async () => {
	for (const hostile of [
		{
			fields: "[]",
			diagnostic:
				/QP-SCHEMA-001 invalidDefinition: .*\/index:hostile requires at least one Field/,
		},
		{
			fields: '["missing"] as any',
			diagnostic:
				/QP-SCHEMA-003 invalidReference: .*\/index:hostile references unknown .*\/field:missing/,
		},
		{
			fields: '["address"] as any',
			diagnostic:
				/QP-SCHEMA-003 invalidReference: .*\/index:hostile references unknown .*\/field:address/,
		},
		{
			fields: '["metadata"]',
			diagnostic:
				/QP-SCHEMA-003 invalidReference: .*\/index:hostile cannot index JSON-backed .*\/field:metadata/,
		},
		{
			fields: '["preferences"]',
			diagnostic:
				/QP-SCHEMA-003 invalidReference: .*\/index:hostile cannot index JSON-backed .*\/field:preferences/,
		},
	] as const) {
		const temporary = await mkdtemp(join(tmpdir(), "questpie-bad-index-"));
		try {
			await cp(fixtureRoot, temporary, { recursive: true });
			await writeFile(
				join(temporary, "src/invalid-index.ts"),
				`import { constraint, defineCollection, field, index, shape, value } from "questpie";

export const invalidIndex = defineCollection({
	name: "invalidIndex",
	fields: {
		id: field.uuid(),
		address: shape.inline({ fields: { city: field.text() } }),
		metadata: field.json(),
		preferences: field.object({ properties: {
			locale: value.text({ nullable: false }),
		} }),
	},
	constraints: { primary: constraint.primaryKey({ fields: ["id"] }) },
	indexes: { hostile: index({ fields: ${hostile.fields} }) },
});
`,
			);
			await expect(
				compileApplication({ applicationRoot: temporary }),
			).rejects.toThrow(hostile.diagnostic);
		} finally {
			await rm(temporary, { recursive: true });
		}
	}
});

test("rejects empty, missing, and structural key Constraint fields before projection", async () => {
	for (const hostile of [
		{
			constraint:
				'primary: constraint.primaryKey({ fields: [] }), valid: constraint.unique({ fields: ["id"] })',
			diagnostic:
				/QP-SCHEMA-001 invalidDefinition: .*\/constraint:primary requires at least one Field/,
		},
		{
			constraint:
				'primary: constraint.primaryKey({ fields: ["id"] }), hostile: constraint.unique({ fields: [] })',
			diagnostic:
				/QP-SCHEMA-001 invalidDefinition: .*\/constraint:hostile requires at least one Field/,
		},
		{
			constraint:
				'primary: constraint.primaryKey({ fields: ["id"] }), hostile: constraint.unique({ fields: ["missing"] as any })',
			diagnostic:
				/QP-SCHEMA-003 invalidReference: .*\/constraint:hostile references unknown .*\/field:missing/,
		},
		{
			constraint:
				'primary: constraint.primaryKey({ fields: ["address"] as any })',
			diagnostic:
				/QP-SCHEMA-003 invalidReference: .*\/constraint:primary references unknown .*\/field:address/,
		},
	] as const) {
		const temporary = await mkdtemp(join(tmpdir(), "questpie-bad-key-"));
		try {
			await cp(fixtureRoot, temporary, { recursive: true });
			await writeFile(
				join(temporary, "src/invalid-key.ts"),
				`import { constraint, defineCollection, field, shape } from "questpie";

export const invalidKey = defineCollection({
	name: "invalidKey",
	fields: {
		id: field.uuid(),
		address: shape.inline({ fields: { city: field.text() } }),
	},
	constraints: { ${hostile.constraint} },
});
`,
			);
			await expect(
				compileApplication({ applicationRoot: temporary }),
			).rejects.toThrow(hostile.diagnostic);
		} finally {
			await rm(temporary, { recursive: true });
		}
	}
});

test("rejects collisions in PostgreSQL's schema relation namespace", async () => {
	for (const hostile of [
		{
			members: `
export const collisionTable = defineCollection({
	name: "collisionTable",
	postgres: { name: "shared_relation" },
	fields: { id: field.uuid() },
	constraints: { primary: constraint.primaryKey({ fields: ["id"] }) },
});
export const collisionIndex = defineCollection({
	name: "collisionIndex",
	fields: { id: field.uuid() },
	constraints: { primary: constraint.primaryKey({ fields: ["id"] }) },
	indexes: { shared: index({ fields: ["id"], postgres: { name: "shared_relation" } }) },
});`,
		},
		{
			members: `
export const firstKey = defineCollection({
	name: "firstKey",
	fields: { id: field.uuid() },
	constraints: { primary: constraint.primaryKey({ fields: ["id"], postgres: { name: "shared_key" } }) },
});
export const secondKey = defineCollection({
	name: "secondKey",
	fields: { id: field.uuid() },
	constraints: { primary: constraint.primaryKey({ fields: ["id"], postgres: { name: "shared_key" } }) },
});`,
		},
	] as const) {
		const temporary = await mkdtemp(join(tmpdir(), "questpie-name-collision-"));
		try {
			await cp(fixtureRoot, temporary, { recursive: true });
			await writeFile(
				join(temporary, "src/relation-name-collision.ts"),
				`import { constraint, defineCollection, field, index } from "questpie";
${hostile.members}
`,
			);
			await expect(
				compileApplication({ applicationRoot: temporary }),
			).rejects.toThrow(
				/QP-SCHEMA-006 physicalNameCollision: .* share shared_/,
			);
		} finally {
			await rm(temporary, { recursive: true });
		}
	}
});
