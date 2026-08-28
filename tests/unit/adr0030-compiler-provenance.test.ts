import { expect, test } from "bun:test";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { compileApplication, createMigrationPlan } from "@questpie/compiler";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");

async function compileProvenanceFixture(
	root: string,
	provenance: Readonly<{ immutable: boolean; server: boolean }>,
) {
	await writeFile(
		join(root, "src/provenance-records.ts"),
		`import { constraint, defineCollection, field } from "questpie";

export const provenanceRecords = defineCollection({
	name: "provenanceRecords",
	fields: {
		id: field.uuid({ nullable: false, default: "randomUuid", server: ${provenance.server}, immutable: ${provenance.immutable} }),
		label: field.text({ nullable: false, server: false, immutable: false }),
	},
	constraints: { primary: constraint.primaryKey({ fields: ["id"] }) },
});
`,
	);
	return compileApplication({ applicationRoot: root });
}

test("projects Field provenance into Data Contract without physical schema drift", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "questpie-adr0030-compiler-"));
	try {
		await cp(fixtureRoot, temporary, { recursive: true });
		const callerOwned = await compileProvenanceFixture(temporary, {
			immutable: false,
			server: false,
		});
		const serverOwned = await compileProvenanceFixture(temporary, {
			immutable: true,
			server: true,
		});

		const callerSchema = callerOwned.generatedFiles["schema-projection.json"]!;
		const serverSchema = serverOwned.generatedFiles["schema-projection.json"]!;
		expect(serverSchema).toBe(callerSchema);
		expect(
			createMigrationPlan({
				baseMigration: "000001_provenance-baseline",
				baseSchema: JSON.parse(callerSchema),
				targetSchema: JSON.parse(serverSchema),
				slug: "change-field-provenance",
			}),
		).toEqual({ status: "noChanges" });

		const data = JSON.parse(serverOwned.generatedFiles["manifest.json"]!).data;
		const collection = data.collections.find(
			(value: { identity: string }) =>
				value.identity === "collection:provenanceRecords",
		);
		expect(collection.fields).toEqual([
			expect.objectContaining({
				path: ["id"],
				immutable: true,
				server: true,
			}),
			expect.objectContaining({
				path: ["label"],
				immutable: false,
				server: false,
			}),
		]);

		const app = serverOwned.generatedFiles["app.ts"]!;
		expect(app).toContain(
			'readonly "id": DataFieldDescriptor<"collection:provenanceRecords/field:id",',
		);
		expect(app).toContain(
			'DataFieldDescriptor<"collection:provenanceRecords/field:id", Readonly<{ readonly "kind": "uuid"; }>, string, false, true, true, true>',
		);
		expect(app).toContain(
			'readonly insert: Readonly<{ readonly "label": string; }>; readonly update: Readonly<{ readonly "label"?: string; }>;',
		);
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
}, 20_000);
