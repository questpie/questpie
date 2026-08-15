import { describe, expect, test } from "bun:test";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { compileApplication, createCommittedSeed } from "@questpie/compiler";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");

describe("BETA-02 foundational Fields", () => {
	test("projects bigint, numeric, date, and literal defaults exactly", async () => {
		const temporary = await mkdtemp(join(tmpdir(), "questpie-fields-"));
		try {
			await cp(fixtureRoot, temporary, { recursive: true });
			await writeFile(
				join(temporary, "src/foundational-fields.ts"),
				`import { constraint, defineCollection, field } from "questpie";

export const measurements = defineCollection({
	name: "measurements",
	fields: {
		id: field.bigint({ minimum: "0", maximum: "9223372036854775807" }),
		amount: field.numeric({ precision: 12, scale: 4 }),
		day: field.date({ nullable: true }),
		label: field.text({ default: "now" }),
		enabled: field.boolean({ default: true }),
		position: field.integer({ default: 0 }),
		observedAt: field.timestamp({ withTimezone: true }),
	},
	constraints: { primary: constraint.primaryKey({ fields: ["id"] }) },
});
`,
			);
			const compilation = await compileApplication({
				applicationRoot: temporary,
			});
			const schema = JSON.parse(
				compilation.generatedFiles["schema-projection.json"] ?? "null",
			);
			const manifest = JSON.parse(
				compilation.generatedFiles["manifest.json"] ?? "null",
			);
			const collection = schema.collections.find(
				(value: { identity: string }) =>
					value.identity === "collection:measurements",
			);

			expect(collection.fields).toEqual([
				expect.objectContaining({
					identity: "collection:measurements/field:amount",
					path: ["amount"],
					type: { kind: "numeric", precision: 12, scale: 4 },
					default: null,
				}),
				expect.objectContaining({
					identity: "collection:measurements/field:day",
					path: ["day"],
					type: { kind: "date" },
					nullable: true,
				}),
				expect.objectContaining({
					identity: "collection:measurements/field:enabled",
					default: { kind: "literal", value: true },
				}),
				expect.objectContaining({
					identity: "collection:measurements/field:id",
					type: {
						kind: "bigint",
						minimum: "0",
						maximum: "9223372036854775807",
					},
				}),
				expect.objectContaining({
					identity: "collection:measurements/field:label",
					default: { kind: "literal", value: "now" },
				}),
				expect.objectContaining({
					identity: "collection:measurements/field:observedAt",
					type: { kind: "timestamp", withTimezone: true },
				}),
				expect.objectContaining({
					identity: "collection:measurements/field:position",
					default: { kind: "literal", value: 0 },
				}),
			]);
			expect(
				collection.constraints.filter((value: { identity: string }) =>
					value.identity.startsWith("collection:measurements/field:id/"),
				),
			).toEqual([
				expect.objectContaining({
					identity: "collection:measurements/field:id/invariant:maximum",
					expression: expect.objectContaining({
						right: {
							kind: "literal",
							value: "9223372036854775807",
						},
					}),
				}),
				expect.objectContaining({
					identity: "collection:measurements/field:id/invariant:minimum",
					expression: expect.objectContaining({
						right: { kind: "literal", value: "0" },
					}),
				}),
			]);

			const dataCollection = manifest.data.collections.find(
				(value: { identity: string }) =>
					value.identity === "collection:measurements",
			);
			expect(dataCollection.fields).toEqual(
				collection.fields.map(
					(field: {
						identity: string;
						path: string[];
						type: unknown;
						nullable: boolean;
						default: unknown;
					}) => ({
						identity: field.identity,
						path: field.path,
						codec: field.type,
						nullable: field.nullable,
						hasDefault: field.default !== null,
					}),
				),
			);
			expect(compilation.generatedFiles["app.ts"]).toContain(
				'readonly "amount": string; readonly "day": string | null; readonly "enabled": boolean; readonly "id": string; readonly "label": string; readonly "observedAt": string; readonly "position": number;',
			);
			const definition = (id: unknown, position?: unknown) => ({
				name: "measurements.demo.v1",
				steps: [
					{
						kind: "insert",
						collection: "collection:measurements",
						values: {
							id,
							amount: "1.0000",
							observedAt: "2026-08-15T12:00:00.000Z",
							...(position === undefined ? {} : { position }),
						},
					},
				],
			});
			expect(() =>
				createCommittedSeed({ definition: definition("-1"), schema }),
			).toThrow(/field:id violates its bigint bounds/);
			expect(() =>
				createCommittedSeed({
					definition: definition("1", 2_147_483_648),
					schema,
				}),
			).toThrow(/field:position is outside PostgreSQL integer/);
		} finally {
			await rm(temporary, { recursive: true });
		}
	});
});
