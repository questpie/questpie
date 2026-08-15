import { describe, expect, test } from "bun:test";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
	compileApplication,
	CompilerDiagnosticError,
	createCommittedSeed,
	loadCommittedSeed,
	orderCommittedSeeds,
	validateCommittedSeedSchema,
	verifyCommittedSeed,
} from "@questpie/compiler";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");
const compilation = compileApplication({ applicationRoot: fixtureRoot });

function caught(action: () => void): unknown {
	try {
		action();
	} catch (error) {
		return error;
	}
	throw new Error("expected action to throw");
}

describe("BETA-02 committed Seeds", () => {
	test("commits the collaboration graph as one immutable Seed", async () => {
		const compiled = await compilation;
		const [committed] = compiled.committedSeeds;
		expect(committed).toBeDefined();
		if (!committed) throw new Error("compiled collaboration Seed is missing");
		expect(committed.identity).toBe("seed:collaboration.demo.v1");
		expect(committed.steps.map((step) => step.collection)).toEqual([
			"collection:companies",
			"collection:spaces",
			"collection:channels",
			"collection:memberships",
			"collection:messages",
		]);
		expect(Object.keys(committed.files).sort()).toEqual([
			"checksum.sha256",
			"seed.json",
			"steps.json",
		]);
		const artifactRoot = resolve(
			fixtureRoot,
			"questpie/seeds/collaboration.demo.v1",
		);
		expect(await loadCommittedSeed(artifactRoot)).toEqual(committed);
		expect(() => verifyCommittedSeed(committed)).not.toThrow();
		expect(orderCommittedSeeds([committed])).toEqual([committed]);

		const tampered = {
			...committed,
			files: {
				...committed.files,
				"steps.json": `${committed.files["steps.json"]} `,
			},
		};
		expect(() => verifyCommittedSeed(tampered)).toThrow(/QP-SEED-004/);
		const extraFile = {
			...committed,
			files: { ...committed.files, "callback.ts": "export default () => 1" },
		};
		expect(() => verifyCommittedSeed(extraFile)).toThrow(/QP-SEED-004/);
		const incompatibleSchema = structuredClone(
			JSON.parse(compiled.generatedFiles["schema-projection.json"] ?? "null"),
		);
		const companies = incompatibleSchema.collections.find(
			(collection: { identity: string }) =>
				collection.identity === "collection:companies",
		);
		companies.fields = companies.fields.filter(
			(field: { identity: string }) =>
				field.identity !== "collection:companies/field:name",
		);
		expect(
			caught(() => validateCommittedSeedSchema(committed, incompatibleSchema)),
		).toMatchObject({
			code: "QP-SEED-003",
			diagnosticClass: "seedTargetMismatch",
		});
		expect(() =>
			orderCommittedSeeds([{ ...committed, dependencies: ["seed:missing"] }]),
		).toThrow(/QP-SEED-001/);
	});

	test("rejects an invalid diagnostic code and class pair at runtime", () => {
		expect(
			() =>
				new CompilerDiagnosticError(
					"QP-SEED-003",
					"seedCardinalityMismatch" as never,
					"invalid diagnostic pair",
				),
		).toThrow(/invalid diagnostic code and class pair/);
	});

	test("refuses files outside the exact three-file Seed contract", async () => {
		const temporary = await mkdtemp(join(tmpdir(), "questpie-seed-"));
		try {
			const directory = join(temporary, "collaboration.demo.v1");
			await cp(
				resolve(fixtureRoot, "questpie/seeds/collaboration.demo.v1"),
				directory,
				{ recursive: true },
			);
			await writeFile(join(directory, "callback.ts"), "throw new Error();\n");
			await expect(loadCommittedSeed(directory)).rejects.toThrow(/QP-SEED-004/);
		} finally {
			await rm(temporary, { recursive: true });
		}
	});

	test("applies the accepted scalar codecs before emitting Seed bytes", async () => {
		const compiled = await compilation;
		const schema = JSON.parse(
			compiled.generatedFiles["schema-projection.json"] ?? "null",
		);
		const definition = (id: unknown, name: unknown) => ({
			name: "collaboration.codec.v1",
			steps: [
				{
					kind: "insert",
					collection: "collection:companies",
					values: { id, name },
				},
			],
		});

		expect(() =>
			createCommittedSeed({
				definition: definition(
					"018F5F6E-5F2C-7B41-A854-3D9A6B6B61A0",
					"Questpie",
				),
				schema,
			}),
		).toThrow(/QP-SEED-003/);
		expect(() =>
			createCommittedSeed({
				definition: {
					name: "collaboration.timestamp-date.v1",
					steps: [
						{
							kind: "insert",
							collection: "collection:messages",
							values: {
								authorMembershipId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0",
								body: "hello",
								channelId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a1",
								createdAt: new Date(0),
							},
						},
					],
				},
				schema,
			}),
		).toThrow(/QP-SEED-003/);
		expect(() =>
			createCommittedSeed({
				definition: definition("018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0", ""),
				schema,
			}),
		).toThrow(/QP-SEED-003/);
		expect(() =>
			createCommittedSeed({
				definition: definition(
					"018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0",
					"e\u0301",
				),
				schema,
			}),
		).toThrow(/QP-SEED-003/);
	});
});
