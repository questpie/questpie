import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
	compileApplication,
	createCommittedSeed,
	orderCommittedSeeds,
	verifyCommittedSeed,
} from "@questpie/compiler";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");
const compilation = compileApplication({ applicationRoot: fixtureRoot });

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
		for (const [name, bytes] of Object.entries(committed.files))
			expect(await readFile(resolve(artifactRoot, name), "utf8")).toBe(bytes);
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
		expect(() =>
			orderCommittedSeeds([{ ...committed, dependencies: ["seed:missing"] }]),
		).toThrow(/QP-SEED-001/);
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
