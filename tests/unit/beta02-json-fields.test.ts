import { describe, expect, test } from "bun:test";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { compileApplication, createCommittedSeed } from "@questpie/compiler";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");

describe("BETA-02 JSON-backed Fields", () => {
	test("projects closed embedded codecs and tagged open JSON", async () => {
		const temporary = await mkdtemp(join(tmpdir(), "questpie-json-fields-"));
		try {
			await cp(fixtureRoot, temporary, { recursive: true });
			await writeFile(
				join(temporary, "src/json-fields.ts"),
				`import { constraint, defineCollection, field, value } from "questpie";

export const profiles = defineCollection({
	name: "profiles",
	fields: {
		id: field.uuid({ nullable: false }),
		preferences: field.object({ nullable: false, properties: {
			locale: value.text({ nullable: false, maxLength: 16 }),
			marketingEmail: value.boolean({ nullable: true }),
			aliases: value.array({
				nullable: false,
				items: value.text({ nullable: false }),
				maximumItems: 10,
			}),
		} }),
		tags: field.array({
			nullable: false,
			items: value.text({ nullable: false }),
			maximumItems: 100,
		}),
		metadata: field.json({ nullable: true }),
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
					value.identity === "collection:profiles",
			);

			expect(collection.fields).toEqual([
				expect.objectContaining({
					identity: "collection:profiles/field:id",
					type: { kind: "uuid" },
				}),
				expect.objectContaining({
					identity: "collection:profiles/field:metadata",
					type: { kind: "json" },
					nullable: true,
				}),
				expect.objectContaining({
					identity: "collection:profiles/field:preferences",
					type: {
						kind: "object",
						properties: [
							{
								key: "aliases",
								codec: {
									kind: "array",
									nullable: false,
									maximumItems: 10,
									items: {
										kind: "text",
										nullable: false,
										minLength: null,
										maxLength: null,
										collation: "questpie.binary",
									},
								},
							},
							{
								key: "locale",
								codec: {
									kind: "text",
									nullable: false,
									minLength: null,
									maxLength: 16,
									collation: "questpie.binary",
								},
							},
							{
								key: "marketingEmail",
								codec: { kind: "boolean", nullable: true },
							},
						],
					},
				}),
				expect.objectContaining({
					identity: "collection:profiles/field:tags",
					type: {
						kind: "array",
						maximumItems: 100,
						items: {
							kind: "text",
							nullable: false,
							minLength: null,
							maxLength: null,
							collation: "questpie.binary",
						},
					},
				}),
			]);
			const dataCollection = manifest.data.collections.find(
				(value: { identity: string }) =>
					value.identity === "collection:profiles",
			);
			expect(dataCollection.fields[2].codec).toEqual(collection.fields[2].type);
			expect(compilation.generatedFiles["app.ts"]).toContain(
				'readonly "metadata": TaggedJsonValue | null;',
			);
			expect(compilation.generatedFiles["app.ts"]).toContain(
				'readonly "preferences": Readonly<{ readonly "aliases": ReadonlyArray<string>; readonly "locale": string; readonly "marketingEmail": boolean | null; }>;',
			);

			const seedDefinition = (preferences: unknown, metadata: unknown) => ({
				name: "profiles.demo.v1",
				steps: [
					{
						kind: "insert",
						collection: "collection:profiles",
						values: {
							id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0",
							preferences,
							tags: ["owner"],
							metadata,
						},
					},
				],
			});
			const committed = createCommittedSeed({
				definition: seedDefinition(
					{
						locale: "sk",
						marketingEmail: null,
						aliases: ["domo"],
					},
					{ kind: "json", value: null },
				),
				schema,
			});
			expect(committed.steps[0]?.values?.slice(-3)).toEqual([
				{
					field: "collection:profiles/field:metadata",
					value: { kind: "json", value: null },
				},
				{
					field: "collection:profiles/field:preferences",
					value: {
						kind: "json",
						value: {
							aliases: ["domo"],
							locale: "sk",
							marketingEmail: null,
						},
					},
				},
				{
					field: "collection:profiles/field:tags",
					value: { kind: "json", value: ["owner"] },
				},
			]);
			expect(() =>
				createCommittedSeed({
					definition: seedDefinition(
						{ locale: "sk", aliases: [] },
						{ kind: "json", value: null },
					),
					schema,
				}),
			).toThrow(/QP-SEED-003/);
			expect(() =>
				createCommittedSeed({
					definition: seedDefinition(
						{
							locale: "sk",
							marketingEmail: true,
							aliases: [],
						},
						{ arbitrary: true },
					),
					schema,
				}),
			).toThrow(/QP-SEED-003/);
		} finally {
			await rm(temporary, { recursive: true });
		}
	});
});
