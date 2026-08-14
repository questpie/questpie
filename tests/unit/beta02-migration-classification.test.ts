import { expect, test } from "bun:test";
import { resolve } from "node:path";

import { compileApplication, createMigrationPlan } from "@questpie/compiler";

test("returns noChanges without producing Migration Plan bytes", async () => {
	const compilation = await compileApplication({
		applicationRoot: resolve(import.meta.dir, "../../fixtures/collaboration"),
	});
	const schema = JSON.parse(
		compilation.generatedFiles["schema-projection.json"] ?? "null",
	);

	const result = createMigrationPlan({
		baseSchema: schema,
		targetSchema: structuredClone(schema),
		baseMigration: "000001_create-collaboration",
		slug: "unchanged",
	});

	expect(result).toEqual({ status: "noChanges" });
	expect("plan" in result).toBe(false);
	expect("digest" in result).toBe(false);
});
