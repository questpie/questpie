import { expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
		await rm(join(temporary, "src/delivery-action.ts"));
		const messagesPath = join(temporary, "src/messages.ts");
		const messagesSource = await readFile(messagesPath, "utf8");
		const lifecycleStart = messagesSource.indexOf("\n\tissues:");
		const lifecycleEnd = messagesSource.indexOf(
			"\n\tconstraints:",
			lifecycleStart,
		);
		if (lifecycleStart < 0 || lifecycleEnd < 0)
			throw new TypeError("fixture Message lifecycle boundary is missing");
		await writeFile(
			messagesPath,
			messagesSource.slice(0, lifecycleStart) +
				messagesSource.slice(lifecycleEnd),
		);
		const policyPath = join(temporary, "src/message-policy.ts");
		const policySource = await readFile(policyPath, "utf8");
		await writeFile(
			policyPath,
			policySource
				.replace(
					"\tcreate: {",
					`\tupdate: {
\t\tadmit: policy.authenticated(),
\t\trows: ({ current }) => current.id.equal(current.id),
\t\tcandidate: ({ candidate, current }) => candidate.id.equal(current.id),
\t},
\tcreate: {`,
				)
				.replace(
					"\tfields: {\n\t\tcreate:",
					"\tfields: {\n\t\tupdate: ({ current }) => ({ body: current.id.equal(current.id) }),\n\t\tcreate:",
				),
		);
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
		input: ["body"],
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
		const adapters = JSON.parse(
			compilation.generatedFiles["collection-operation-adapters.json"] ??
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
		const collectionPrograms = programs.operations.filter(
			(program: { target: string }) => program.target === "collection:messages",
		);
		const createAdapter = adapters.adapters.find(
			(adapter: { identity: string }) =>
				adapter.identity === "mutation:messages.create",
		);
		expect(createAdapter.normalizerProgramDigest).toBe(
			digest("questpie-field-normalizer-program-v1", normalizers.programs[0]),
		);
		expect(createAdapter.serverValueProgramDigest).toBe(
			digest("questpie-server-value-program-v1", values.programs[0]),
		);
		expect(createAdapter).toMatchObject({
			identity: "mutation:messages.create",
			target: "collection:messages",
			member: "create",
			kernelIdentity: "mutation:__collectionKernel.messages.create",
			keyFields: [],
			callerInputFields: [["body"]],
			selectedFieldPaths: [["id"], ["channelId"], ["body"], ["createdAt"]],
			outputCardinality: "one",
		});
		expect(
			adapters.adapters.find(
				(adapter: { identity: string }) =>
					adapter.identity === "mutation:messages.update",
			),
		).toMatchObject({
			kernelIdentity: "mutation:__collectionKernel.messages.update",
			callerInputFields: [["body"]],
		});
		expect(collectionPrograms).toHaveLength(5);
		expect(
			collectionPrograms.map(
				(program: { identity: string }) => program.identity,
			),
		).toEqual([
			"mutation:__collectionKernel.messages.create",
			"mutation:__collectionKernel.messages.update",
			"mutation:messages.delete",
			"query:messages.get",
			"query:messages.list",
		]);
		expect(collectionPrograms.at(-1)).toMatchObject({
			identity: "query:messages.list",
			dataQuery: {
				format: "questpie.data-query-template",
				version: 1,
				from: "collection:messages",
			},
			dataQueryDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
		});
		expect({
			...postgresPlans,
			plans: postgresPlans.plans.filter(
				(plan: { target: string }) => plan.target === "collection:messages",
			),
		}).toMatchObject({
			format: "questpie.postgres-collection-operation-plans",
			version: 1,
			plans: [
				expect.objectContaining({
					identity: "mutation:__collectionKernel.messages.create",
					member: "create",
				}),
				expect.objectContaining({
					identity: "mutation:__collectionKernel.messages.update",
					member: "update",
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
						"collection-operation-adapters.json",
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
			"collection-operation-adapters.json",
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

test("lowers an authorized Collection update into the PostgreSQL runtime artifact", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "questpie-operation-update-"));
	try {
		await cp(
			resolve(import.meta.dir, "../../fixtures/team-support-desk"),
			temporary,
			{ recursive: true },
		);
		const compilation = await compileApplication({
			applicationRoot: temporary,
			outputDirectory: join(temporary, ".questpie/generated"),
		});
		const postgresPlans = JSON.parse(
			compilation.generatedFiles["postgres-collection-operation-plans.json"] ??
				"null",
		) as Readonly<{
			plans: readonly Readonly<{
				identity: string;
				member: string;
				fieldAuthority: Readonly<{
					checks: readonly Readonly<{ sql: string }>[];
				}>;
			}>[];
		}>;
		const operationPrograms = JSON.parse(
			compilation.generatedFiles["collection-operation-programs.json"] ??
				"null",
		) as Readonly<{
			operations: readonly Readonly<{
				identity: string;
				callerInputFields: readonly (readonly string[])[];
				trustedValueFields: readonly (readonly string[])[];
				requiredTrustedValueFields: readonly (readonly string[])[];
			}>[];
		}>;

		expect(
			postgresPlans.plans.find(
				({ identity }) =>
					identity === "mutation:__collectionKernel.tickets.update",
			),
		).toMatchObject({
			identity: "mutation:__collectionKernel.tickets.update",
			member: "update",
		});
		const ticketCreatePlan = postgresPlans.plans.find(
			({ identity }) =>
				identity === "mutation:__collectionKernel.tickets.create",
		);
		expect(ticketCreatePlan).toBeDefined();
		for (const check of ticketCreatePlan?.fieldAuthority.checks ?? []) {
			expect(check.sql).not.toContain(
				'"qp_candidate"."requester_membership_id"',
			);
		}
		const commentCreatePlan = postgresPlans.plans.find(
			({ identity }) =>
				identity === "mutation:__collectionKernel.comments.create",
		);
		expect(commentCreatePlan).toBeDefined();
		for (const check of commentCreatePlan?.fieldAuthority.checks ?? []) {
			expect(check.sql).not.toContain('"qp_candidate"."author_membership_id"');
		}
		expect(
			operationPrograms.operations.find(
				({ identity }) =>
					identity === "mutation:__collectionKernel.tickets.create",
			),
		).toMatchObject({
			callerInputFields: [
				["assigneeMembershipId"],
				["description"],
				["priority"],
				["reference"],
				["summary"],
				["teamId"],
			],
			trustedValueFields: [
				["assigneeMembershipId"],
				["closedAt"],
				["createdAt"],
				["description"],
				["id"],
				["lastSlaFollowUpAt"],
				["organizationId"],
				["priority"],
				["reference"],
				["requesterMembershipId"],
				["status"],
				["summary"],
				["teamId"],
				["updatedAt"],
			],
			requiredTrustedValueFields: [
				["organizationId"],
				["requesterMembershipId"],
			],
		});
		expect(
			operationPrograms.operations.find(
				({ identity }) =>
					identity === "mutation:__collectionKernel.comments.create",
			),
		).toMatchObject({
			callerInputFields: [["body"], ["ticketId"]],
			trustedValueFields: [
				["authorMembershipId"],
				["body"],
				["createdAt"],
				["id"],
				["kind"],
				["ticketId"],
			],
			requiredTrustedValueFields: [["authorMembershipId"]],
		});
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
});

test("rejects unbound Fields, open values, and ordinary Resource collisions", async () => {
	const hostiles = [
		{
			name: "server-caller-input",
			source: `import { defineCollectionOperations } from "questpie";
import { messagePolicy } from "./message-policy";
import { messages } from "./messages";
export const hostile = defineCollectionOperations(messages, {
	name: "messages",
	policy: messagePolicy,
	create: { input: ["body"], select: { id: true } },
});`,
			fieldPatch: [
				"body: field.text({ nullable: false, minLength: 1, maxLength: 8_192 })",
				"body: field.text({ nullable: false, minLength: 1, maxLength: 8_192, server: true })",
			],
			diagnostic: /cannot expose server Field body as caller input/,
		},
		{
			name: "immutable-update-input",
			source: `import { defineCollectionOperations } from "questpie";
import { messagePolicy } from "./message-policy";
import { messages } from "./messages";
export const hostile = defineCollectionOperations(messages, {
	name: "messages",
	policy: messagePolicy,
	update: { input: ["body"], select: { id: true } },
});`,
			fieldPatch: [
				"body: field.text({ nullable: false, minLength: 1, maxLength: 8_192 })",
				"body: field.text({ nullable: false, minLength: 1, maxLength: 8_192, immutable: true })",
			],
			diagnostic: /cannot expose immutable Field body as update caller input/,
		},
		{
			name: "static-overlap",
			source: `import { defineCollectionOperations, mutation } from "questpie";
import { messagePolicy } from "./message-policy";
import { messages } from "./messages";
export const hostile = defineCollectionOperations(messages, {
	name: "messages",
	policy: messagePolicy,
	create: {
		input: ["body"],
		values: ({ principal }) => ({ body: mutation.overwrite(principal.id) }),
		select: { id: true },
	},
});`,
			diagnostic:
				/cannot assign one Field through caller input and static server values/,
		},
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
			if ("fieldPatch" in hostile) {
				const messagesPath = join(temporary, "src/messages.ts");
				const source = await readFile(messagesPath, "utf8");
				await writeFile(
					messagesPath,
					source.replace(hostile.fieldPatch[0], hostile.fieldPatch[1]),
				);
			}
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
