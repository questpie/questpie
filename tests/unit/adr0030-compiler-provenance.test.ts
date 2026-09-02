import { expect, test } from "bun:test";
import { cp, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
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
		`import { constraint, defineCollection, definePolicy, field, policy } from "questpie";

export const provenanceRecords = defineCollection({
	name: "provenanceRecords",
	fields: {
		id: field.uuid({ nullable: false, default: "randomUuid", server: ${provenance.server}, immutable: ${provenance.immutable} }),
		label: field.text({ nullable: false, server: false, immutable: false }),
	},
	constraints: { primary: constraint.primaryKey({ fields: ["id"] }) },
});

export const provenanceRecordPolicy = definePolicy(provenanceRecords, {
	name: "provenanceRecords.default",
	create: {
		admit: policy.authenticated(),
		candidate: ({ candidate }) => candidate.id.equal(candidate.id),
	},
	update: {
		admit: policy.authenticated(),
		rows: ({ current }) => current.id.equal(current.id),
		candidate: ({ candidate, current }) => candidate.id.equal(current.id),
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

test("generates an internal create/update kernel without publishing Collection Resources", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "questpie-adr0030-kernel-"));
	try {
		await cp(fixtureRoot, temporary, { recursive: true });
		const keptSources = new Set([
			"channels.ts",
			"companies.ts",
			"execution.ts",
			"memberships.ts",
			"message-events.ts",
			"message-operations.ts",
			"message-page.ts",
			"message-policy.ts",
			"messages.ts",
			"spaces.ts",
		]);
		for (const entry of await readdir(join(temporary, "src")))
			if (!keptSources.has(entry))
				await rm(join(temporary, "src", entry), { recursive: true });
		const compilation = await compileProvenanceFixture(temporary, {
			immutable: true,
			server: true,
		});

		const programs = JSON.parse(
			compilation.generatedFiles["collection-operation-programs.json"]!,
		) as Readonly<{
			operations: readonly Readonly<{
				identity: string;
				target: string;
				member: string;
			}>[];
		}>;
		const plans = JSON.parse(
			compilation.generatedFiles["postgres-collection-operation-plans.json"]!,
		) as Readonly<{
			plans: readonly Readonly<{
				identity: string;
				target: string;
				member: string;
				lifecycle: readonly string[];
			}>[];
		}>;
		const kernelPrograms = programs.operations.filter(
			({ target }) => target === "collection:provenanceRecords",
		);
		const kernelPlans = plans.plans.filter(
			({ target }) => target === "collection:provenanceRecords",
		);

		expect(kernelPrograms.map(({ member }) => member).sort()).toEqual([
			"create",
			"update",
		]);
		expect(kernelPlans.map(({ member }) => member).sort()).toEqual([
			"create",
			"update",
		]);
		for (const plan of kernelPlans)
			expect(plan.lifecycle).toEqual(
				expect.arrayContaining([
					"completeCandidateValidation",
					"candidatePolicy",
				]),
			);

		const app = compilation.generatedFiles["app.ts"]!;
		const mutationData = app.slice(
			app.indexOf("export interface GeneratedMutationData"),
			app.indexOf("export interface GeneratedQueries"),
		);
		expect(mutationData).toContain('readonly "provenanceRecords":');
		expect(mutationData).toContain("readonly create:");
		expect(mutationData).toContain("readonly update:");
		const runtimeApplication =
			compilation.generatedFiles["internal/application.js"]!;
		expect(runtimeApplication).toContain(
			'JSON.parse(artifactFiles["collection-operation-programs.json"])',
		);
		expect(runtimeApplication).toContain(
			'JSON.parse(artifactFiles["postgres-collection-operation-plans.json"])',
		);

		const automaticIdentities = new Set([
			...kernelPrograms.map(({ identity }) => identity),
			"mutation:provenanceRecords.create",
			"mutation:provenanceRecords.update",
		]);
		const manifest = JSON.parse(compilation.generatedFiles["manifest.json"]!);
		const operationContracts = JSON.parse(
			compilation.generatedFiles["operation-contracts.json"]!,
		);
		const http = JSON.parse(
			compilation.generatedFiles["operation-http-contract.json"]!,
		);
		for (const resources of [
			manifest.composition.resources,
			operationContracts.operations,
			http.operations,
		] as const)
			expect(
				resources.filter(({ identity }: { identity: string }) =>
					automaticIdentities.has(identity),
				),
			).toEqual([]);
		expect(compilation.generatedFiles["client.ts"]).not.toContain(
			"provenanceRecords.create",
		);
		expect(compilation.generatedFiles["client.ts"]).not.toContain(
			"provenanceRecords.update",
		);
		const projections = JSON.parse(
			compilation.generatedFiles["collection-operation-set-projections.json"]!,
		) as Readonly<{
			sets: readonly Readonly<{ target: string }>[];
		}>;
		expect(
			projections.sets.filter(
				({ target }) => target === "collection:provenanceRecords",
			),
		).toEqual([]);
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
}, 20_000);

test("keeps default mutable update Fields available to caller and trusted lanes", async () => {
	const temporary = await mkdtemp(
		join(tmpdir(), "questpie-adr0030-update-lanes-"),
	);
	try {
		await cp(fixtureRoot, temporary, { recursive: true });
		const compilation = await compileProvenanceFixture(temporary, {
			immutable: true,
			server: true,
		});
		const programs = JSON.parse(
			compilation.generatedFiles["collection-operation-programs.json"]!,
		) as Readonly<{
			operations: readonly Readonly<{
				identity: string;
				callerInputFields: readonly (readonly string[])[];
				trustedValueFields: readonly (readonly string[])[];
			}>[];
		}>;
		const update = programs.operations.find(
			({ identity }) =>
				identity === "mutation:__collectionKernel.provenanceRecords.update",
		);

		expect(update).toBeDefined();
		expect(update?.callerInputFields).toContainEqual(["label"]);
		expect(update?.trustedValueFields).toContainEqual(["label"]);
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
}, 20_000);

test("keeps ctx.data and its SQL kernel invariant when an Operation Set pins input and output", async () => {
	const temporary = await mkdtemp(
		join(tmpdir(), "questpie-adr0030-kernel-adapter-"),
	);
	try {
		await cp(fixtureRoot, temporary, { recursive: true });
		const keptSources = new Set([
			"channels.ts",
			"companies.ts",
			"execution.ts",
			"memberships.ts",
			"message-events.ts",
			"message-operations.ts",
			"message-page.ts",
			"message-policy.ts",
			"messages.ts",
			"spaces.ts",
		]);
		for (const entry of await readdir(join(temporary, "src")))
			if (!keptSources.has(entry))
				await rm(join(temporary, "src", entry), { recursive: true });

		const withoutSet = await compileProvenanceFixture(temporary, {
			immutable: true,
			server: true,
		});
		await writeFile(
			join(temporary, "src/provenance-operations.ts"),
			`import { defineCollectionOperations } from "questpie";

import { provenanceRecordPolicy, provenanceRecords } from "./provenance-records";

export const provenanceRecordOperations = defineCollectionOperations(
	provenanceRecords,
	{
		name: "provenanceRecords",
		policy: provenanceRecordPolicy,
		create: { input: [], select: { id: true } },
		update: { input: [], select: { id: true } },
	},
);
`,
		);
		const withSet = await compileApplication({ applicationRoot: temporary });

		const targetMembers = (bytes: string, member: "operations" | "plans") =>
			JSON.parse(bytes)[member].filter(
				({ target }: { target: string }) =>
					target === "collection:provenanceRecords",
			);
		const mutationData = (app: string) =>
			app
				.slice(
					app.indexOf("export interface GeneratedMutationData"),
					app.indexOf("export interface GeneratedQueries"),
				)
				.split("\n")
				.find((line) => line.includes('readonly "provenanceRecords":'));

		expect(
			targetMembers(
				withSet.generatedFiles["collection-operation-programs.json"]!,
				"operations",
			),
		).toEqual(
			targetMembers(
				withoutSet.generatedFiles["collection-operation-programs.json"]!,
				"operations",
			),
		);
		expect(
			targetMembers(
				withSet.generatedFiles["postgres-collection-operation-plans.json"]!,
				"plans",
			),
		).toEqual(
			targetMembers(
				withoutSet.generatedFiles["postgres-collection-operation-plans.json"]!,
				"plans",
			),
		);
		expect(mutationData(withSet.generatedFiles["app.ts"]!)).toBe(
			mutationData(withoutSet.generatedFiles["app.ts"]!),
		);
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
}, 20_000);
