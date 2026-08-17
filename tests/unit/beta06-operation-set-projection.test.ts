import { expect, test } from "bun:test";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

import { digest } from "../../packages/compiler/src/canonical";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");

test("lowers an unbranded Collection Operation Set to exact P3 programs", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "questpie-operation-set-"));
	try {
		await cp(fixtureRoot, temporary, { recursive: true });
		await rm(join(temporary, "src/message-publish.ts"));
		await rm(join(temporary, "src/message-published.ts"));
		await rm(join(temporary, "src/message-record-delivery.ts"));
		await writeFile(
			join(temporary, "src/message-operations.ts"),
			`import { defineCollectionOperations, mutation } from "questpie";

import { channelMessagePage } from "./message-page";
import { messagePolicy } from "./message-policy";
import { messages } from "./messages";

export const messageOperations = defineCollectionOperations(messages, {
	name: "messages",
	policy: messagePolicy,
	network: true,
	list: { data: channelMessagePage },
	get: { select: { id: true, body: true, createdAt: true } },
	create: {
		input: ["channelId", "body"],
		normalize: ({ input }) => ({
			body: {
				kind: "normalizedValue",
				transform: "trim",
				source: input.body,
			} as never,
		}),
		values: ({ principal, tenant, operationTime }) => ({
			channelId: mutation.overwrite(tenant.id),
			authorMembershipId: mutation.overwrite(principal.id),
			createdAt: mutation.overwrite(operationTime),
		}),
		select: { id: true, channelId: true, body: true, createdAt: true },
	},
	update: {
		input: ["body"],
		normalize: ({ input }) => ({
			body: {
				kind: "normalizedValue",
				transform: "trimIfPresent",
				source: input.body,
			} as never,
		}),
		values: ({ operationTime }) => ({
			createdAt: mutation.overwrite(operationTime),
		}),
		select: { id: true, body: true, createdAt: true },
	},
	delete: { select: { id: true } },
});
`,
		);

		const compilation = await compileApplication({
			applicationRoot: temporary,
			outputDirectory: join(temporary, ".questpie/generated"),
		});
		const sets = JSON.parse(
			compilation.generatedFiles["collection-operation-set-projections.json"] ??
				"null",
		);
		const normalizers = JSON.parse(
			compilation.generatedFiles["field-normalizer-programs.json"] ?? "null",
		);
		const values = JSON.parse(
			compilation.generatedFiles["server-value-programs.json"] ?? "null",
		);
		const programs = JSON.parse(
			compilation.generatedFiles["collection-operation-programs.json"] ??
				"null",
		);
		const postgresPlans = JSON.parse(
			compilation.generatedFiles["postgres-collection-operation-plans.json"] ??
				"null",
		);

		expect(sets).toEqual({
			format: "questpie.collection-operation-set-projections",
			version: 1,
			sets: [
				{
					artifact: "questpie.collection-operation-set-projection",
					version: 1,
					authoringIdentity: null,
					target: "collection:messages",
					name: "messages",
					network: true,
					children: [
						["list", "query", "readSnapshot"],
						["get", "query", "readSnapshot"],
						["create", "mutation", "writeTransaction"],
						["update", "mutation", "writeTransaction"],
						["delete", "mutation", "writeTransaction"],
					].map(([member, kind, mode]) => ({
						member,
						identity: `${kind}:messages.${member}`,
						owner: `${kind}:messages.${member}`,
						kind,
						mode,
						engine: "operationEngine:v1",
						policy: "policy:messages.default",
						inputCodec: `operation:messages.${member}:input`,
						outputCodec: `operation:messages.${member}:output`,
						errors: [],
						exposure: { direct: true, network: true },
						limits:
							kind === "query"
								? {
										inputBytes: 65_536,
										resultBytes: 1_048_576,
										rowsRead: 10_000,
										durationMilliseconds: 5_000,
									}
								: {
										inputBytes: 65_536,
										resultBytes: 1_048_576,
										rowsWritten: 100,
										durationMilliseconds: 5_000,
									},
						observation: "operationEngine:v1",
						executableSlot: `slot:${kind}:messages.${member}:generated`,
						origin: `src/message-operations.ts#messageOperations.${member}`,
					})),
				},
			],
		});
		expect(normalizers).toEqual({
			format: "questpie.field-normalizer-programs",
			version: 1,
			programs: [
				{
					artifact: "questpie.field-normalizer-program",
					version: 1,
					target: "collection:messages",
					operation: "create",
					steps: [
						{
							target: ["body"],
							expression: { kind: "trim", source: ["body"] },
						},
					],
					capabilities: [],
				},
				{
					artifact: "questpie.field-normalizer-program",
					version: 1,
					target: "collection:messages",
					operation: "update",
					steps: [
						{
							target: ["body"],
							expression: { kind: "trimIfPresent", source: ["body"] },
						},
					],
					capabilities: [],
				},
			],
		});
		expect(values).toEqual({
			format: "questpie.server-value-programs",
			version: 1,
			programs: [
				{
					artifact: "questpie.server-value-program",
					version: 1,
					target: "collection:messages",
					operation: "create",
					assignments: [
						{
							target: ["channelId"],
							mode: "overwrite",
							source: ["tenant", "id"],
						},
						{
							target: ["authorMembershipId"],
							mode: "overwrite",
							source: ["principal", "id"],
						},
						{
							target: ["createdAt"],
							mode: "overwrite",
							source: ["operationTime"],
						},
					],
					capabilities: [],
				},
				{
					artifact: "questpie.server-value-program",
					version: 1,
					target: "collection:messages",
					operation: "update",
					assignments: [
						{
							target: ["createdAt"],
							mode: "overwrite",
							source: ["operationTime"],
						},
					],
					capabilities: [],
				},
			],
		});
		expect(programs).toMatchObject({
			format: "questpie.collection-operation-programs",
			version: 1,
		});
		expect(programs.operations[0].normalizerProgramDigest).toBe(
			digest("questpie-field-normalizer-program-v1", normalizers.programs[0]),
		);
		expect(programs.operations[0].serverValueProgramDigest).toBe(
			digest("questpie-server-value-program-v1", values.programs[0]),
		);
		expect(programs.operations[0]).toMatchObject({
			identity: "mutation:messages.create",
			kind: "mutation",
			mode: "writeTransaction",
			target: "collection:messages",
			member: "create",
			policy: "policy:messages.default",
			keyFields: [],
			callerInputFields: [["channelId"], ["body"]],
			selectedFieldPaths: [["id"], ["channelId"], ["body"], ["createdAt"]],
			outputCardinality: "one",
		});
		expect(programs.operations).toHaveLength(5);
		expect(
			programs.operations.map(
				(program: { identity: string }) => program.identity,
			),
		).toEqual([
			"mutation:messages.create",
			"mutation:messages.delete",
			"mutation:messages.update",
			"query:messages.get",
			"query:messages.list",
		]);
		expect(programs.operations.at(-1)).toMatchObject({
			identity: "query:messages.list",
			dataQuery: {
				format: "questpie.data-query-template",
				version: 1,
				from: "collection:messages",
			},
			dataQueryDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
		});
		expect(postgresPlans).toMatchObject({
			format: "questpie.postgres-collection-operation-plans",
			version: 1,
			plans: [
				expect.objectContaining({
					identity: "mutation:messages.create",
					member: "create",
				}),
				expect.objectContaining({
					identity: "query:messages.get",
					member: "get",
				}),
			],
		});
		const originMap = JSON.parse(
			compilation.generatedFiles["origin-map.json"] ?? "null",
		);
		const manifest = JSON.parse(
			compilation.generatedFiles["manifest.json"] ?? "null",
		);
		expect(
			manifest.composition.resources
				.filter((resource: { identity: string }) =>
					[
						"mutation:messages.create",
						"mutation:messages.delete",
						"mutation:messages.update",
						"query:messages.get",
						"query:messages.list",
					].includes(resource.identity),
				)
				.map((resource: { identity: string }) => resource.identity),
		).toEqual([
			"mutation:messages.create",
			"mutation:messages.delete",
			"mutation:messages.update",
			"query:messages.get",
			"query:messages.list",
		]);
		const createOrigin = originMap.resources.find(
			(resource: { identity: string }) =>
				resource.identity === "mutation:messages.create",
		);
		expect(createOrigin).toMatchObject({
			identity: "mutation:messages.create",
			establishedAt: {
				kind: "collectionOperationSetMember",
				packageId: null,
				path: "src/message-operations.ts",
				exportName: "messageOperations",
				member: "create",
				span: expect.any(Object),
				declaredAt: null,
			},
			augmentations: [],
			members: [],
		});
		const setOrigin = originMap.structuralPlans.find(
			(candidate: { kind: string }) =>
				candidate.kind === "collectionOperationSet",
		);
		expect(setOrigin.establishedAt).toMatchObject({
			path: "src/message-operations.ts",
			exportName: "messageOperations",
			span: expect.any(Object),
		});
		expect(setOrigin.members).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					identity: "mutation:messages.create",
					member: "create",
					span: expect.any(Object),
				}),
			]),
		);
		const explain = JSON.parse(
			compilation.generatedFiles["collection-operation-explain.json"] ?? "null",
		);
		expect(explain.resources).toContainEqual(
			expect.objectContaining({
				identity: "mutation:messages.create",
				owner: "mutation:messages.create",
				origin: "src/message-operations.ts#messageOperations.create",
				executable: {
					kind: "frameworkGenerated",
					slot: "slot:mutation:messages.create:generated",
					program: "mutation:messages.create",
				},
				program: expect.objectContaining({
					target: "collection:messages",
					policy: "policy:messages.default",
					member: "create",
				}),
			}),
		);
		const runtimeBuild = JSON.parse(
			compilation.generatedFiles["runtime-build.json"] ?? "null",
		);
		expect(
			runtimeBuild.inventory
				.filter((entry: { path: string }) =>
					[
						"collection-operation-explain.json",
						"collection-operation-programs.json",
						"collection-operation-set-projections.json",
						"field-normalizer-programs.json",
						"postgres-collection-operation-plans.json",
						"server-value-programs.json",
					].includes(entry.path),
				)
				.map((entry: { path: string }) => entry.path),
		).toEqual([
			"collection-operation-explain.json",
			"collection-operation-programs.json",
			"collection-operation-set-projections.json",
			"field-normalizer-programs.json",
			"postgres-collection-operation-plans.json",
			"server-value-programs.json",
		]);
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
});

test("rejects unbound Fields, open values, and ordinary Resource collisions", async () => {
	const hostiles = [
		{
			name: "unknown-field",
			source: `import { defineCollectionOperations } from "questpie";
import { messagePolicy } from "./message-policy";
import { messages } from "./messages";
export const hostile = defineCollectionOperations(messages, {
	name: "messages",
	policy: messagePolicy,
	get: { select: { missing: true } as any },
});`,
			diagnostic: /QP-COMPOSE-013 structuralTypeError/,
		},
		{
			name: "open-value",
			source: `import { defineCollectionOperations, mutation } from "questpie";
import { messagePolicy } from "./message-policy";
import { messages } from "./messages";
export const hostile = defineCollectionOperations(messages, {
	name: "messages",
	policy: messagePolicy,
	create: {
		input: ["body"],
		values: () => ({ body: mutation.overwrite("ambient" as any) }),
		select: { id: true },
	},
});`,
			diagnostic: /QP-COMPOSE-013 structuralTypeError/,
		},
		{
			name: "identity-collision",
			source: `import { codec, defineCollectionOperations, policy } from "questpie";
import { defineMutation } from "#questpie/app";
import { messagePolicy } from "./message-policy";
import { messages } from "./messages";
export const operations = defineCollectionOperations(messages, {
	name: "messages",
	policy: messagePolicy,
	create: { input: ["body"], select: { id: true } },
});
export const collision = defineMutation({
	name: "messages.create",
	input: codec.object({ body: codec.text() }),
	output: codec.object({ id: codec.uuid() }),
	policy: policy.authenticated(),
	handler: async () => ({ id: "00000000-0000-0000-0000-000000000000" }),
});`,
			diagnostic: /QP-COMPOSE-002 duplicateResourceIdentity/,
		},
	] as const;
	for (const hostile of hostiles) {
		const temporary = await mkdtemp(
			join(tmpdir(), `questpie-operation-set-${hostile.name}-`),
		);
		try {
			await cp(fixtureRoot, temporary, { recursive: true });
			await writeFile(
				join(temporary, "src/hostile-operations.ts"),
				hostile.source,
			);
			await expect(
				compileApplication({
					applicationRoot: temporary,
					outputDirectory: join(temporary, ".questpie/generated"),
				}),
			).rejects.toThrow(hostile.diagnostic);
		} finally {
			await rm(temporary, { force: true, recursive: true });
		}
	}
});
