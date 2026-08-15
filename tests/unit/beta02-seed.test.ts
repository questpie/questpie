import { describe, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
		const committed = compiled.committedSeeds.find(
			({ identity }) => identity === "seed:collaboration.demo.v1",
		);
		expect(committed).toBeDefined();
		if (!committed) throw new Error("compiled collaboration Seed is missing");
		expect(committed.identity).toBe("seed:collaboration.demo.v1");
		expect(committed.files["checksum.sha256"]).toBe(
			"1f54d6b02406519d85f5cd9a84548bd7108b128e717fcb0a96ee0c42df08ad41\n",
		);
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

	test("commits and reloads stack-deep tagged open JSON", async () => {
		const compiled = await compilation;
		const schema = structuredClone(
			JSON.parse(compiled.generatedFiles["schema-projection.json"] ?? "null"),
		);
		const companies = schema.collections.find(
			(collection: { identity: string }) =>
				collection.identity === "collection:companies",
		);
		companies.fields.push({
			collation: null,
			default: null,
			identity: "collection:companies/field:metadata",
			nullable: false,
			path: ["metadata"],
			postgresName: "metadata",
			type: { kind: "json" },
		});
		let deepJson: unknown = "leaf";
		for (let depth = 0; depth < 20_000; depth += 1)
			deepJson = { nested: deepJson };
		const committed = createCommittedSeed({
			definition: {
				name: "collaboration.deep-json.v1",
				steps: [
					{
						kind: "insert",
						collection: "collection:companies",
						values: {
							metadata: { kind: "json", value: deepJson },
							name: "Deep JSON",
						},
					},
				],
			},
			schema,
		});
		expect(() => verifyCommittedSeed(committed)).not.toThrow();
		expect(Buffer.byteLength(committed.files["steps.json"] ?? "")).toBeLessThan(
			1_048_576,
		);

		const temporary = await mkdtemp(join(tmpdir(), "questpie-deep-json-seed-"));
		try {
			const directory = join(temporary, "collaboration.deep-json.v1");
			await mkdir(directory);
			for (const [name, bytes] of Object.entries(committed.files))
				await writeFile(join(directory, name), bytes);
			const loaded = await loadCommittedSeed(directory);
			expect(loaded.identity).toBe(committed.identity);
			expect(loaded.files).toEqual(committed.files);
		} finally {
			await rm(temporary, { recursive: true });
		}
	});

	test("rejects cyclic tagged open JSON with the registered diagnostic", async () => {
		const compiled = await compilation;
		const schema = structuredClone(
			JSON.parse(compiled.generatedFiles["schema-projection.json"] ?? "null"),
		);
		const companies = schema.collections.find(
			(collection: { identity: string }) =>
				collection.identity === "collection:companies",
		);
		companies.fields.push({
			collation: null,
			default: null,
			identity: "collection:companies/field:metadata",
			nullable: false,
			path: ["metadata"],
			postgresName: "metadata",
			type: { kind: "json" },
		});
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;

		expect(
			caught(() =>
				createCommittedSeed({
					definition: {
						name: "collaboration.cyclic-json.v1",
						steps: [
							{
								kind: "insert",
								collection: "collection:companies",
								values: {
									metadata: { kind: "json", value: cyclic },
									name: "Cyclic JSON",
								},
							},
						],
					},
					schema,
				}),
			),
		).toMatchObject({
			code: "QP-SEED-003",
			diagnosticClass: "seedTargetMismatch",
			message: expect.stringContaining("does not accept cyclic JSON values"),
		});
	});

	test("rejects negative-zero tagged open JSON with the registered diagnostic", async () => {
		const compiled = await compilation;
		const schema = structuredClone(
			JSON.parse(compiled.generatedFiles["schema-projection.json"] ?? "null"),
		);
		const companies = schema.collections.find(
			(collection: { identity: string }) =>
				collection.identity === "collection:companies",
		);
		companies.fields.push({
			collation: null,
			default: null,
			identity: "collection:companies/field:metadata",
			nullable: false,
			path: ["metadata"],
			postgresName: "metadata",
			type: { kind: "json" },
		});

		expect(
			caught(() =>
				createCommittedSeed({
					definition: {
						name: "collaboration.negative-zero-json.v1",
						steps: [
							{
								kind: "insert",
								collection: "collection:companies",
								values: {
									metadata: { kind: "json", value: -0 },
									name: "Negative-zero JSON",
								},
							},
						],
					},
					schema,
				}),
			),
		).toMatchObject({
			code: "QP-SEED-003",
			diagnosticClass: "seedTargetMismatch",
			message: expect.stringContaining("requires canonical JSON numbers"),
		});
	});

	test("rejects lone Unicode surrogates at the Seed boundary", async () => {
		const compiled = await compilation;
		const schema = structuredClone(
			JSON.parse(compiled.generatedFiles["schema-projection.json"] ?? "null"),
		);
		const companies = schema.collections.find(
			(collection: { identity: string }) =>
				collection.identity === "collection:companies",
		);
		companies.fields.push({
			collation: null,
			default: null,
			identity: "collection:companies/field:metadata",
			nullable: false,
			path: ["metadata"],
			postgresName: "metadata",
			type: { kind: "json" },
		});
		const commit = (
			value: unknown,
			name = "collaboration.unicodeJson.v1",
			dependsOn: readonly string[] = [],
			companyName = "Unicode JSON",
		) =>
			createCommittedSeed({
				definition: {
					name,
					dependsOn,
					steps: [
						{
							kind: "insert",
							collection: "collection:companies",
							values: {
								metadata: { kind: "json", value },
								name: companyName,
							},
						},
					],
				},
				schema,
			});

		expect(() =>
			commit({ emoji: "😀" }, undefined, ["seed:collaboration.base.v1"], "😀"),
		).not.toThrow();
		for (const invalid of [
			{ nested: ["\ud800"] },
			{ nested: { value: "\udc00" } },
			{ "\ud800": "value" },
			{ nested: { "\udc00": true } },
		])
			expect(caught(() => commit(invalid))).toMatchObject({
				code: "QP-SEED-003",
				diagnosticClass: "seedTargetMismatch",
				message: expect.stringContaining("lone Unicode surrogate"),
			});
		for (const invalid of [
			() => commit({}, "\ud800"),
			() => commit({}, undefined, ["seed:\udc00"]),
			() => commit({}, undefined, [], "\ud800"),
		])
			expect(caught(invalid)).toMatchObject({
				code: "QP-SEED-003",
				diagnosticClass: "seedTargetMismatch",
				message: expect.stringContaining("lone Unicode surrogate"),
			});
	});
});
