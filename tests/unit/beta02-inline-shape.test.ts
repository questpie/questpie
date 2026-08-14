import { describe, expect, test } from "bun:test";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { compileApplication, createCommittedSeed } from "@questpie/compiler";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");

describe("BETA-02 inline shapes", () => {
	test("projects each nested leaf as one independently addressable column", async () => {
		const temporary = await mkdtemp(join(tmpdir(), "questpie-inline-"));
		try {
			await cp(fixtureRoot, temporary, { recursive: true });
			await writeFile(
				join(temporary, "src/inline-shape.ts"),
				`import { constraint, defineCollection, field, index, shape } from "questpie";

export const customers = defineCollection({
	name: "customers",
	fields: {
		id: field.uuid(),
		address: shape.inline({ fields: {
			city: field.text({ maxLength: 160 }),
			geo: shape.inline({ fields: {
				latitude: field.numeric({ precision: 8, scale: 5 }),
				longitude: field.numeric({ precision: 8, scale: 5 }),
			} }),
		} }),
	},
	constraints: {
		primary: constraint.primaryKey({ fields: ["id"] }),
		city: constraint.unique({ fields: [["address", "city"]] }),
	},
	indexes: { location: index({ fields: [
		{ field: ["address", "geo", "latitude"], order: "desc", nulls: "first" },
		["address", "geo", "longitude"],
	] }) },
});
`,
			);
			const compilation = await compileApplication({
				applicationRoot: temporary,
			});
			const schema = JSON.parse(
				compilation.generatedFiles["schema-projection.json"] ?? "null",
			);
			const customers = schema.collections.find(
				(value: { identity: string }) =>
					value.identity === "collection:customers",
			);
			expect(
				customers.fields.map(
					(field: {
						identity: string;
						path: string[];
						postgresName: string;
					}) => ({
						identity: field.identity,
						path: field.path,
						postgresName: field.postgresName,
					}),
				),
			).toEqual([
				{
					identity: "collection:customers/field:address/field:city",
					path: ["address", "city"],
					postgresName: "address_city",
				},
				{
					identity:
						"collection:customers/field:address/field:geo/field:latitude",
					path: ["address", "geo", "latitude"],
					postgresName: "address_geo_latitude",
				},
				{
					identity:
						"collection:customers/field:address/field:geo/field:longitude",
					path: ["address", "geo", "longitude"],
					postgresName: "address_geo_longitude",
				},
				{
					identity: "collection:customers/field:id",
					path: ["id"],
					postgresName: "id",
				},
			]);
			expect(
				customers.constraints.find(
					(value: { identity: string }) =>
						value.identity === "collection:customers/constraint:city",
				)?.fields,
			).toEqual(["collection:customers/field:address/field:city"]);
			expect(customers.indexes[0].fields).toEqual([
				{
					field: "collection:customers/field:address/field:geo/field:latitude",
					order: "desc",
					nulls: "first",
					operatorClass: "typeDefault",
					collation: null,
				},
				{
					field: "collection:customers/field:address/field:geo/field:longitude",
					order: "asc",
					nulls: "last",
					operatorClass: "typeDefault",
					collation: null,
				},
			]);
			expect(compilation.generatedFiles["app.ts"]).toContain(
				'readonly "address": Readonly<{ readonly "city": string; readonly "geo": Readonly<{ readonly "latitude": string; readonly "longitude": string; }>; }>;',
			);
			const committed = createCommittedSeed({
				definition: {
					name: "customers.demo.v1",
					steps: [
						{
							kind: "insert",
							collection: "collection:customers",
							values: {
								id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0",
								address: {
									city: "Bratislava",
									geo: {
										latitude: "48.14860",
										longitude: "17.10770",
									},
								},
							},
						},
					],
				},
				schema,
			});
			expect(committed.steps[0]?.values?.map((value) => value.field)).toEqual([
				"collection:customers/field:address/field:city",
				"collection:customers/field:address/field:geo/field:latitude",
				"collection:customers/field:address/field:geo/field:longitude",
				"collection:customers/field:id",
			]);
			expect(() =>
				createCommittedSeed({
					definition: {
						name: "customers.invalid.v1",
						steps: [
							{
								kind: "insert",
								collection: "collection:customers",
								values: {
									id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0",
									"address.city": "Bratislava",
								},
							},
						],
					},
					schema,
				}),
			).toThrow(/QP-SEED-003/);
		} finally {
			await rm(temporary, { recursive: true });
		}
	});

	test("rejects an empty inline shape during structural compilation", async () => {
		const temporary = await mkdtemp(join(tmpdir(), "questpie-inline-empty-"));
		try {
			await cp(fixtureRoot, temporary, { recursive: true });
			await writeFile(
				join(temporary, "src/inline-empty.ts"),
				`import { constraint, defineCollection, field, shape } from "questpie";

export const invalid = defineCollection({
	name: "invalid-inline",
	fields: { id: field.uuid(), empty: shape.inline({ fields: {} }) },
	constraints: { primary: constraint.primaryKey({ fields: ["id"] }) },
});
`,
			);
			await expect(
				compileApplication({ applicationRoot: temporary }),
			).rejects.toThrow(/QP-SCHEMA-001/);
		} finally {
			await rm(temporary, { recursive: true });
		}
	});
});
