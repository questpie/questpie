import { expect, test } from "bun:test";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");

const GUARDED_RECORDS_SOURCE = `import { codec, collection, constraint, defineCollection, definePolicy, field, operation, policy } from "questpie";

import { defineMutation } from "#questpie/app";

export const guardedRecords = defineCollection({
	name: "guardedRecords",
	fields: {
		id: field.uuid({ nullable: false, default: "randomUuid", server: true, immutable: true }),
		label: field.text({ nullable: false, server: false, immutable: false }),
		locked: field.boolean({ nullable: false, default: false, server: false, immutable: false }),
	},
	issues: {
		cannotDeleteLocked: collection.issue(),
	},
	lifecycle: {
		validate: ({ current, issues }) => {
			if (current !== null && current.locked) throw issues.cannotDeleteLocked();
		},
	},
	constraints: { primary: constraint.primaryKey({ fields: ["id"] }) },
});

export const guardedRecordPolicy = definePolicy(guardedRecords, {
	name: "guardedRecords.default",
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
		update: ({ current }) => ({
			id: current.id.equal(current.id),
			label: current.label.equal(current.label),
			locked: current.locked.equal(current.locked),
		}),
	},
});
`;

function mutationSource(mapped: boolean) {
	return `import { codec, operation, policy } from "questpie";

import { defineMutation } from "#questpie/app";

export const ${mapped ? "mappedDelete" : "unmappedDelete"} = defineMutation({
	name: "guardedRecords.${mapped ? "mappedDelete" : "unmappedDelete"}",
	input: codec.object({ id: codec.uuid() }),
	output: codec.object({ deleted: codec.boolean() }),
	policy: policy.authenticated(),
	${
		mapped
			? `errors: {
		cannotDeleteLocked: operation.error({ code: "CANNOT_DELETE_LOCKED", status: 409 }),
	},
	issueMappings: {
		guardedRecords: { cannotDeleteLocked: "cannotDeleteLocked" },
	},`
			: `errors: {},`
	}
	handler: async ({ input, ctx }) => {
		const deleted = await ctx.data.guardedRecords.delete({ key: { id: input.id } });
		return { deleted: deleted !== null };
	},
});
`;
}

async function compileFixture(root: string, mapped: boolean) {
	await writeFile(join(root, "src/guarded-records.ts"), GUARDED_RECORDS_SOURCE);
	await writeFile(
		join(root, "src/guarded-records-mutation.ts"),
		mutationSource(mapped),
	);
	return compileApplication({ applicationRoot: root });
}

test("F1/F2: a mapping-less Mutation does not compile against ctx.data.<collection>.delete when the Collection has a lifecycle", async () => {
	const temporary = await mkdtemp(
		join(tmpdir(), "questpie-adr0047-f1f2-unmapped-"),
	);
	try {
		await cp(fixtureRoot, temporary, { recursive: true });
		await expect(compileFixture(temporary, false)).rejects.toThrow();
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}, 30_000);

test("F1/F2: an issue-mapped Mutation compiles and its kernel delete carries the lifecycle program (currentValidation present)", async () => {
	const temporary = await mkdtemp(
		join(tmpdir(), "questpie-adr0047-f1f2-mapped-"),
	);
	try {
		await cp(fixtureRoot, temporary, { recursive: true });
		const compilation = await compileFixture(temporary, true);
		const programs = JSON.parse(
			compilation.generatedFiles["collection-operation-programs.json"] ??
				"null",
		);
		const deleteProgram = programs.operations.find(
			(program: { identity: string }) =>
				program.identity ===
				"mutation:__collectionKernel.guardedRecords.delete",
		);
		expect(deleteProgram.lifecycleProgramDigest).toEqual(
			expect.stringMatching(/^[0-9a-f]{64}$/),
		);
		const postgresPlans = JSON.parse(
			compilation.generatedFiles["postgres-collection-operation-plans.json"] ??
				"null",
		);
		const deletePlan = postgresPlans.plans.find(
			(plan: { identity: string }) =>
				plan.identity === "mutation:__collectionKernel.guardedRecords.delete",
		);
		expect(deletePlan.currentValidation).toBeDefined();
		expect(deletePlan.currentValidation.sql).toContain("SELECT");
		expect(deletePlan.currentValidation.sql).not.toContain("DELETE");
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}, 30_000);
