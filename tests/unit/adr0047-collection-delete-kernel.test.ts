import { expect, test } from "bun:test";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");

async function compileDeleteFixture(root: string) {
	await writeFile(
		join(root, "src/deletable-records.ts"),
		`import { codec, constraint, defineCollection, definePolicy, field, operation, policy } from "questpie";

import { defineMutation } from "#questpie/app";

export const deletableRecords = defineCollection({
	name: "deletableRecords",
	fields: {
		id: field.uuid({ nullable: false, default: "randomUuid", server: true, immutable: true }),
		label: field.text({ nullable: false, server: false, immutable: false }),
	},
	constraints: { primary: constraint.primaryKey({ fields: ["id"] }) },
});

export const deletableRecordPolicy = definePolicy(deletableRecords, {
	name: "deletableRecords.default",
	create: {
		admit: policy.authenticated(),
		candidate: ({ candidate }) => candidate.id.equal(candidate.id),
	},
	update: {
		admit: policy.authenticated(),
		rows: ({ current }) => current.id.equal(current.id),
		candidate: ({ candidate, current }) => candidate.id.equal(current.id),
	},
	delete: {
		admit: policy.authenticated(),
		rows: ({ current }) => current.id.equal(current.id),
	},
	fields: {
		create: ({ candidate }) => ({
			id: candidate.id.equal(candidate.id),
			label: candidate.label.equal(candidate.label),
		}),
		update: ({ current }) => ({
			id: current.id.equal(current.id),
			label: current.label.equal(current.label),
		}),
	},
});

export const deleteRecord = defineMutation({
	name: "deletableRecords.deleteRecord",
	input: codec.object({ id: codec.uuid() }),
	output: codec.object({ deleted: codec.boolean() }),
	policy: policy.authenticated(),
	errors: {
		recordUnavailable: operation.error({
			code: "RECORD_UNAVAILABLE",
			status: 404,
		}),
	},
	handler: async ({ input, ctx }) => {
		const deleted = await ctx.data.deletableRecords.delete({
			key: { id: input.id },
		});
		return { deleted: deleted !== null };
	},
});
	`,
	);
	return compileApplication({ applicationRoot: root });
}

test("gives a named Mutation a Collection delete kernel operation", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "questpie-adr0047-delete-"));
	try {
		await cp(fixtureRoot, temporary, { recursive: true });
		const compilation = await compileDeleteFixture(temporary);

		const programs = JSON.parse(
			compilation.generatedFiles["collection-operation-programs.json"] ??
				"null",
		);
		const deleteProgram = programs.operations.find(
			(program: { identity: string }) =>
				program.identity ===
				"mutation:__collectionKernel.deletableRecords.delete",
		);
		expect(deleteProgram).toMatchObject({
			identity: "mutation:__collectionKernel.deletableRecords.delete",
			kind: "mutation",
			mode: "writeTransaction",
			target: "collection:deletableRecords",
			member: "delete",
			keyFields: [["id"]],
			callerInputFields: [],
			requiredCallerInputFields: [],
			trustedValueFields: [],
			requiredTrustedValueFields: [],
			outputCardinality: "optionalOne",
		});

		const postgresPlans = JSON.parse(
			compilation.generatedFiles["postgres-collection-operation-plans.json"] ??
				"null",
		);
		const deletePlan = postgresPlans.plans.find(
			(plan: { identity: string }) =>
				plan.identity === "mutation:__collectionKernel.deletableRecords.delete",
		);
		expect(deletePlan).toBeDefined();
		expect(deletePlan.member).toBe("delete");
		expect(deletePlan.write.sql).toContain("DELETE FROM");
		expect(deletePlan.write.sql).toContain("RETURNING");
		expect(/\bFOR\s+UPDATE\b/i.test(deletePlan.lock.sql)).toBe(true);
		// authorized-or-absent: the DELETE joins against the same fresh
		// row-scope Policy check that gates the CTE, so a Policy-denied row
		// and a missing row both delete nothing.
		expect(deletePlan.write.sql).toContain(deletePlan.currentPolicy.sql);

		// The named Mutation's handler calling ctx.data.deletableRecords.delete
		// type-checked against the generated contract: compileApplication runs
		// a real TypeScript check of application code against the generated
		// declarations, so a successful compile is itself the proof that
		// `delete` is visible and correctly typed on ctx.data.
		expect(compilation.generatedFiles["manifest.json"]).toBeDefined();
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
});
