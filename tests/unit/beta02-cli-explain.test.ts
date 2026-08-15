import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import {
	explainCommittedMigration,
	explainCommittedSeed,
	explainMigrationApply,
	loadCommittedMigration,
	loadCommittedSeed,
	renderCliExplanation,
} from "@questpie/compiler";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");

describe("BETA-02 CLI explanations", () => {
	test("renders canonical migration facts as human and JSON goldens", async () => {
		const migration = await loadCommittedMigration(
			resolve(fixtureRoot, "questpie/migrations/000001_create-collaboration"),
		);
		const explanation = explainCommittedMigration(migration);
		expect(renderCliExplanation(explanation, "human")).toMatchSnapshot();
		expect(renderCliExplanation(explanation, "json")).toMatchSnapshot();

		const applied = explainMigrationApply({
			status: "alreadyApplied",
			applied: [],
			head: migration.identity,
			fingerprintDigest:
				"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		});
		expect(renderCliExplanation(applied, "human")).toMatchSnapshot();
		expect(renderCliExplanation(applied, "json")).toMatchSnapshot();

		const failed = explainMigrationApply({
			status: "failed",
			exitCode: 5,
			applied: [migration.identity],
			failed: "000002_add-delivery-state",
			remaining: ["000003_add-delivery-attempts"],
			diagnostic: { sqlstate: "57014" },
		});
		expect(renderCliExplanation(failed, "human")).toMatchSnapshot();
		expect(renderCliExplanation(failed, "json")).toMatchSnapshot();
	});

	test("renders the immutable Seed graph from committed bytes", async () => {
		const seed = await loadCommittedSeed(
			resolve(fixtureRoot, "questpie/seeds/collaboration.demo.v1"),
		);
		const explanation = explainCommittedSeed(seed);
		expect(renderCliExplanation(explanation, "human")).toMatchSnapshot();
		expect(renderCliExplanation(explanation, "json")).toMatchSnapshot();
	});
});
