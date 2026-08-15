import { describe, expect, test } from "bun:test";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

import { fieldContract } from "../../packages/compiler/src/schema/field-contract";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");

describe("BETA-02 Field contract validation", () => {
	test("rejects invalid scalar and embedded options before artifact emission", async () => {
		const temporary = await mkdtemp(join(tmpdir(), "questpie-field-invalid-"));
		try {
			await cp(fixtureRoot, temporary, { recursive: true });
			const candidates = [
				["numeric scale", "field.numeric({ precision: 4, scale: 5 })"],
				["bigint lexical form", "field.bigint({ minimum: '01' })"],
				["bigint range", "field.bigint({ maximum: '9223372036854775808' })"],
				["integer order", "field.integer({ minimum: 10, maximum: 9 })"],
				["text order", "field.text({ minLength: 10, maxLength: 9 })"],
				[
					"array lower limit",
					"field.array({ items: value.text({ nullable: false }), maximumItems: 0 })",
				],
				[
					"array upper limit",
					"field.array({ items: value.text({ nullable: false }), maximumItems: 1001 })",
				],
				[
					"embedded member key",
					"field.object({ properties: { 'not-valid': value.text({ nullable: false }) } })",
				],
			] as const;
			for (const [label, definition] of candidates) {
				await writeFile(
					join(temporary, "src/invalid-field.ts"),
					`import { constraint, defineCollection, field, value } from "questpie";
export const invalid = defineCollection({
	name: "invalidField",
	fields: { id: field.uuid(), candidate: ${definition} },
	constraints: { primary: constraint.primaryKey({ fields: ["id"] }) },
});
`,
				);
				await expect(
					compileApplication({ applicationRoot: temporary }),
					label,
				).rejects.toMatchObject({
					code: "QP-SCHEMA-001",
					diagnosticClass: "invalidDefinition",
				});
			}
		} finally {
			await rm(temporary, { recursive: true });
		}
	});

	test("rejects unreachable or cyclic structural values defensively", () => {
		for (const candidate of [
			{ scalar: "unknown", nullable: false, default: null, options: {} },
			{
				kind: "field",
				scalar: "uuid",
				nullable: "yes",
				default: null,
				postgresName: null,
				options: {},
			},
			{
				kind: "field",
				scalar: "timestamp",
				nullable: false,
				default: null,
				postgresName: null,
				options: { withTimezone: "yes" },
			},
			{
				kind: "field",
				scalar: "uuid",
				nullable: false,
				default: null,
				postgresName: null,
				options: { unknown: true },
			},
			{
				kind: "field",
				scalar: "object",
				nullable: false,
				default: null,
				postgresName: null,
				options: { properties: null },
			},
			{
				kind: "field",
				scalar: "date",
				nullable: false,
				default: "2026-08-15",
				postgresName: null,
				options: {},
			},
			{
				kind: "field",
				scalar: "bigint",
				nullable: false,
				default: "1",
				postgresName: null,
				options: { minimum: null, maximum: null },
			},
			{
				kind: "field",
				scalar: "json",
				nullable: false,
				default: { kind: "json", value: null },
				postgresName: null,
				options: {},
			},
		])
			expect(() => fieldContract(["candidate"], candidate)).toThrow(
				/QP-SCHEMA-001/,
			);

		let nested: Record<string, unknown> = {
			kind: "text",
			nullable: false,
			options: {},
		};
		for (let depth = 0; depth < 9; depth += 1)
			nested = {
				kind: "array",
				nullable: false,
				options: { items: nested, maximumItems: 1 },
			};
		expect(() =>
			fieldContract(["candidate"], {
				kind: "field",
				scalar: "array",
				nullable: false,
				default: null,
				postgresName: null,
				options: { items: nested, maximumItems: 1 },
			}),
		).toThrow(/QP-SCHEMA-001/);

		const cyclic: Record<string, unknown> = {
			kind: "object",
			nullable: false,
			options: { properties: {} },
		};
		(
			cyclic.options as { properties: Record<string, unknown> }
		).properties.self = cyclic;
		expect(() =>
			fieldContract(["candidate"], {
				kind: "field",
				scalar: "object",
				nullable: false,
				default: null,
				postgresName: null,
				options: { properties: { nested: cyclic } },
			}),
		).toThrow(/QP-SCHEMA-001/);
	});
});
