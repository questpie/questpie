import { expect, test } from "bun:test";
import { resolve } from "node:path";

import {
	compileApplication,
	loadCommittedSeed,
	orderCommittedSeeds,
	verifyCommittedSeed,
} from "@questpie/compiler";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");

test("commits immutable membership evidence as a follow-up Seed", async () => {
	const compilation = await compileApplication({
		applicationRoot: fixtureRoot,
	});
	const ordered = orderCommittedSeeds(compilation.committedSeeds);

	expect(ordered.map(({ identity }) => identity)).toEqual([
		"seed:collaboration.demo.v1",
		"seed:collaboration.authorization.v1",
	]);
	const followUp = ordered.find(
		({ identity }) => identity === "seed:collaboration.authorization.v1",
	);
	if (!followUp) throw new Error("expected the BETA-04 follow-up Seed");
	expect(followUp.dependencies).toEqual(["seed:collaboration.demo.v1"]);
	expect(followUp.steps).toEqual([
		expect.objectContaining({
			kind: "update",
			collection: "collection:memberships",
			key: expect.arrayContaining([
				expect.objectContaining({
					field: "collection:memberships/field:scopeKey",
					value: "company",
				}),
			]),
			values: expect.arrayContaining([
				expect.objectContaining({
					field: "collection:memberships/field:role",
					value: "admin",
				}),
				expect.objectContaining({
					field: "collection:memberships/field:status",
					value: "active",
				}),
			]),
		}),
	]);
	expect(() => verifyCommittedSeed(followUp)).not.toThrow();
	expect(
		await loadCommittedSeed(
			resolve(fixtureRoot, "questpie/seeds/collaboration.authorization.v1"),
		),
	).toEqual(followUp);
});
