import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
	compileApplication,
	CompilerDiagnosticError,
} from "@questpie/compiler";

const fixtureRoot = resolve(
	import.meta.dir,
	"../../fixtures/team-support-desk",
);
const collaborationRoot = resolve(
	import.meta.dir,
	"../../fixtures/collaboration",
);

test("derives transitive issue reachability from lowered nested writes and terminates cycles", async () => {
	const temporary = await mkdtemp(
		join(resolve(import.meta.dir, "../.."), ".tmp-adr0031-nested-writes-"),
	);
	try {
		await cp(fixtureRoot, temporary, { recursive: true });
		await rm(join(temporary, "src/labels/operations.ts"));
		await rm(join(temporary, "src/memberships/operations.ts"));
		await rm(join(temporary, "src/teams/operations.ts"));
		const labelsPath = join(temporary, "src/labels.ts");
		await writeFile(
			labelsPath,
			(await readFile(labelsPath, "utf8"))
				.replace(
					'import { constraint, defineCollection, field, index, relation } from "questpie";',
					'import { collection, constraint, defineCollection, field, index, relation } from "questpie";',
				)
				.replace(
					"\tconstraints: {",
					`\tissues: { unreachable: collection.issue() },
\tlifecycle: {
\t\tvalidate: ({ issues }) => { throw issues.unreachable(); },
\t},
\tconstraints: {`,
				),
		);
		const ticketsPath = join(temporary, "src/tickets.ts");
		await writeFile(
			ticketsPath,
			(await readFile(ticketsPath, "utf8")).replace(
				"\t\tvalidate: ({ candidate, issues }) => {",
				`\t\t// @ts-expect-error LIFE-02 proves compiler reachability before LIFE-05 projects the authoring type.
\t\tafterWrite: async ({ ctx, row }: { ctx: { data: { labels: { update(input: unknown): Promise<void> }; memberships: { update(input: unknown): Promise<void> } } }; row: { organizationId: string; requesterMembershipId: string } }) => {
\t\t\tif (false) await ctx.data.labels.update({ key: { id: row.organizationId }, patch: { name: "unreachable" } });
\t\t\tawait ctx.data.memberships.update({ patch: { status: "active" }, key: { id: row.requesterMembershipId } });
\t\t\treturn;
\t\t\tawait ctx.data.labels.update({ key: { id: row.organizationId }, patch: { name: "also-unreachable" } });
\t\t},
\t\tvalidate: ({ candidate, issues }) => {`,
			),
		);
		const membershipsPath = join(temporary, "src/memberships.ts");
		await writeFile(
			membershipsPath,
			(await readFile(membershipsPath, "utf8")).replace(
				"\tconstraints: {",
				`\tlifecycle: {
\t\t// @ts-expect-error LIFE-02 proves compiler reachability before LIFE-05 projects the authoring type.
\t\tafterWrite: async ({ ctx, row }: { ctx: { data: { teams: { update(input: unknown): Promise<void> } } }; row: { id: string } }) => {
\t\t\tawait ctx.data.teams.update({ key: { id: row.id }, patch: { routingStatus: "active" } });
\t\t},
\t},
\tconstraints: {`,
			),
		);
		const teamsPath = join(temporary, "src/teams.ts");
		let teamsSource = await readFile(teamsPath, "utf8");

		const compiled = await compileApplication({ applicationRoot: temporary });
		const programs = JSON.parse(
			compiled.generatedFiles["collection-lifecycle-programs.json"]!,
		) as Readonly<{
			programs: readonly Readonly<{
				bindings: Readonly<{
					collection: string;
					capabilities: Readonly<
						Record<string, Readonly<{ identity: string }>>
					>;
				}>;
				phases: Readonly<Record<string, readonly unknown[]>>;
			}>[];
		}>;
		const compiledTickets = programs.programs.find(
			(program) => program.bindings.collection === "collection:tickets",
		)!;
		expect(compiledTickets.bindings.capabilities).toEqual({
			"data.memberships.update": {
				argumentKeys: ["key.id", "patch.status"],
				identity: "mutation:__collectionKernel.memberships.update",
				kind: "write",
			},
		});
		expect(JSON.stringify(compiledTickets.phases.afterWrite)).not.toContain(
			"mutation:__collectionKernel.labels.update",
		);
		await writeFile(
			ticketsPath,
			(await readFile(ticketsPath, "utf8")).replace(
				'{ patch: { status: "active" }, key: { id: row.requesterMembershipId } }',
				'{ key: { id: row.requesterMembershipId }, patch: { status: "active" } }',
			),
		);
		const reordered = await compileApplication({ applicationRoot: temporary });
		const reorderedTickets = (
			JSON.parse(
				reordered.generatedFiles["collection-lifecycle-programs.json"]!,
			) as typeof programs
		).programs.find(
			(program) => program.bindings.collection === "collection:tickets",
		)!;
		expect(reorderedTickets.bindings.capabilities).toEqual(
			compiledTickets.bindings.capabilities,
		);
		expect(reorderedTickets.phases.afterWrite).toEqual(
			compiledTickets.phases.afterWrite,
		);

		teamsSource = teamsSource
			.replace(
				'import { constraint, defineCollection, field, index, relation } from "questpie";',
				'import { collection, constraint, defineCollection, field, index, relation } from "questpie";',
			)
			.replace(
				"\tconstraints: {",
				`\tissues: { invalidRoute: collection.issue() },
\tlifecycle: {
\t\tvalidate: ({ issues }) => {
\t\t\tif (false) throw issues.invalidRoute();
\t\t\tthrow issues.invalidRoute();
\t\t},
\t\t// @ts-expect-error LIFE-02 proves compiler reachability before LIFE-05 projects the authoring type.
\t\tafterWrite: async ({ ctx, row }: { ctx: { data: { tickets: { update(input: unknown): Promise<void> } } }; row: { id: string } }) => {
\t\t\tawait ctx.data.tickets.update({ patch: { summary: "cycle" }, key: { id: row.id } });
\t\t},
\t},
\tconstraints: {`,
			);
		const issueOffset = teamsSource.lastIndexOf("throw issues.invalidRoute");
		const issuePrefix = teamsSource.slice(0, issueOffset);
		const issueLines = issuePrefix.split("\n");
		const issueOrigin = {
			module: "src/teams.ts",
			line: issueLines.length,
			column: issueLines.at(-1)!.length + 1,
		};
		await writeFile(teamsPath, teamsSource);
		await expect(
			compileApplication({ applicationRoot: temporary }),
		).rejects.toMatchObject({
			code: "QP-COMPOSE-027",
			diagnosticClass: "missingIssueMapping",
			details: {
				phase: "validate",
				origin: issueOrigin,
				operation: "mutation:ticket.assign",
				issue: "issue:teams/invalidRoute",
				path: [
					"mutation:ticket.assign",
					"collection:tickets/create",
					"collection:memberships/update",
					"collection:teams/update",
				],
			},
		});
		await writeFile(
			ticketsPath,
			(await readFile(ticketsPath, "utf8")).replace(
				'{ key: { id: row.requesterMembershipId }, patch: { status: "active" } }',
				"{ key: {}, patch: {} }",
			),
		);
		await expect(
			compileApplication({ applicationRoot: temporary }),
		).rejects.toMatchObject({
			code: "QP-COMPOSE-026",
			diagnosticClass: "unsupportedLifecycleSyntax",
			details: { phase: "afterWrite" },
		});
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
}, 30_000);

test("requires the generated create input root for a zero-leaf input shape", async () => {
	const temporary = await mkdtemp(
		join(resolve(import.meta.dir, "../.."), ".tmp-adr0031-create-root-"),
	);
	try {
		await cp(fixtureRoot, temporary, { recursive: true });
		await writeFile(
			join(temporary, "src/optional-creates.ts"),
			`import { constraint, defineCollection, defineCollectionOperations, definePolicy, field, policy } from "questpie";

export const optionalCreates = defineCollection({
	name: "optionalCreates",
	fields: {
		id: field.uuid({ nullable: false, default: "randomUuid", server: true, immutable: true }),
	},
	constraints: { primary: constraint.primaryKey({ fields: ["id"] }) },
});
export const optionalCreatesPolicy = definePolicy(optionalCreates, {
	name: "optionalCreates.default",
	create: {
		admit: policy.authenticated(),
		candidate: ({ candidate }) => candidate.id.equal(candidate.id),
	},
});
export const optionalCreatesOperations = defineCollectionOperations(optionalCreates, {
	name: "optionalCreates",
	policy: optionalCreatesPolicy,
	create: { input: [], select: { id: true } },
});
`,
		);
		const ticketsPath = join(temporary, "src/tickets.ts");
		const valid = (await readFile(ticketsPath, "utf8")).replace(
			"\t\tvalidate: ({ candidate, issues }) => {",
			`\t\t// @ts-expect-error LIFE-02 proves compiler lowering before LIFE-05 projects the authoring type.
\t\tafterWrite: async ({ ctx }: { ctx: { data: { optionalCreates: { create(input: unknown): Promise<void> } } } }) => {
\t\t\tawait ctx.data.optionalCreates.create({ input: {} });
\t\t},
\t\tvalidate: ({ candidate, issues }) => {`,
		);
		await writeFile(ticketsPath, valid);
		const compilation = await compileApplication({
			applicationRoot: temporary,
		});
		const programs = JSON.parse(
			compilation.generatedFiles["collection-lifecycle-programs.json"]!,
		) as Readonly<{
			programs: readonly Readonly<{
				bindings: Readonly<{
					collection: string;
					capabilities: Readonly<Record<string, unknown>>;
				}>;
			}>[];
		}>;
		expect(
			programs.programs.find(
				(program) => program.bindings.collection === "collection:tickets",
			)?.bindings.capabilities,
		).toHaveProperty(["data.optionalCreates.create"]);

		await writeFile(
			ticketsPath,
			valid.replace(
				"optionalCreates.create({ input: {} })",
				"optionalCreates.create({})",
			),
		);
		await expect(
			compileApplication({ applicationRoot: temporary }),
		).rejects.toMatchObject({
			code: "QP-COMPOSE-026",
			diagnosticClass: "unsupportedLifecycleSyntax",
			details: { phase: "afterWrite" },
		});
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
}, 30_000);

test("lowers one bounded Policy-aware check read from a generated get capability", async () => {
	const temporary = await mkdtemp(
		join(resolve(import.meta.dir, "../.."), ".tmp-adr0031-check-read-"),
	);
	try {
		await cp(fixtureRoot, temporary, { recursive: true });
		const ticketsPath = join(temporary, "src/tickets.ts");
		await writeFile(
			ticketsPath,
			(await readFile(ticketsPath, "utf8")).replace(
				"\t\tvalidate: ({ candidate, issues }) => {",
				`\t\t// @ts-expect-error LIFE-03 projects the exact generated check Context.
\t\tcheck: async ({ candidate, ctx, issues }: { candidate: { teamId: string }; ctx: { data: { teams: { get(input: unknown): Promise<{ id: string; routingStatus: string } | null> } } }; issues: { invalidReference(): Error } }) => {
\t\t\tconst team = await ctx.data.teams.get({ key: { id: candidate.teamId }, select: { routingStatus: true, id: true } });
\t\t\tif (team === null || team.routingStatus !== "active") throw issues.invalidReference();
\t\t},
\t\tvalidate: ({ candidate, issues }) => {`,
			),
		);
		const compilation = await compileApplication({
			applicationRoot: temporary,
		});
		const programs = JSON.parse(
			compilation.generatedFiles["collection-lifecycle-programs.json"]!,
		) as Readonly<{
			programs: readonly Readonly<{
				bindings: Readonly<{
					collection: string;
					capabilities: Readonly<Record<string, unknown>>;
				}>;
				phases: Readonly<Record<string, readonly unknown[]>>;
			}>[];
		}>;
		const tickets = programs.programs.find(
			(program) => program.bindings.collection === "collection:tickets",
		)!;
		expect(tickets.bindings.capabilities).toEqual({
			"data.teams.get": {
				argumentKeys: ["key.id", "select.id", "select.routingStatus"],
				cardinality: "one",
				first: true,
				identity: "query:teams.get",
				kind: "read",
				maxRows: 1,
			},
		});
		expect(tickets.phases.check).toEqual([
			expect.objectContaining({
				op: "const",
				value: expect.objectContaining({
					op: "capability",
					capability: "read",
					identity: "query:teams.get",
				}),
			}),
			expect.objectContaining({ op: "if" }),
		]);
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
}, 30_000);

test("rejects unbounded, detached, write, and inexact check capabilities", async () => {
	for (const [authored, diagnosticClass] of [
		[
			`check: ({ candidate }) => { return candidate; },`,
			"unsupportedLifecycleSyntax",
		],
		[
			`check: async ({ ctx }) => { ctx.data.teams.get({ key: { id: "00000000-0000-4000-8000-000000000001" }, select: { id: true } }); },`,
			"unsupportedLifecycleSyntax",
		],
		[
			`check: async ({ ctx }) => { const team = await ctx.data.teams.update({ key: { id: "00000000-0000-4000-8000-000000000001" }, patch: { name: "forbidden" } }); return team; },`,
			"unsupportedLifecycleCapability",
		],
		[
			`check: async ({ ctx }) => { const team = await ctx.data.teams.get({ key: { id: "00000000-0000-4000-8000-000000000001" }, select: { missing: true } }); return team; },`,
			"unsupportedLifecycleSyntax",
		],
		[
			`check: async ({ ctx }) => { const rows = await Promise.all([ctx.data.teams.get({ key: { id: "00000000-0000-4000-8000-000000000001" }, select: { id: true } })]); return rows; },`,
			"unsupportedLifecycleCapability",
		],
	] as const) {
		const temporary = await mkdtemp(
			join(resolve(import.meta.dir, "../.."), ".tmp-adr0031-check-hostile-"),
		);
		try {
			await cp(fixtureRoot, temporary, { recursive: true });
			const ticketsPath = join(temporary, "src/tickets.ts");
			await writeFile(
				ticketsPath,
				(await readFile(ticketsPath, "utf8")).replace(
					"\t\tvalidate: ({ candidate, issues }) => {",
					`\t\t${authored}\n\t\tvalidate: ({ candidate, issues }) => {`,
				),
			);
			await expect(
				compileApplication({ applicationRoot: temporary }),
			).rejects.toMatchObject({
				code: "QP-COMPOSE-026",
				diagnosticClass,
				details: { phase: "check" },
			});
		} finally {
			await rm(temporary, { force: true, recursive: true });
		}
	}
}, 30_000);

test("bounds dense cyclic issue reachability through the compiler seam", async () => {
	const temporary = await mkdtemp(
		join(resolve(import.meta.dir, "../.."), ".tmp-adr0031-dense-cycle-"),
	);
	try {
		await cp(fixtureRoot, temporary, { recursive: true });
		const count = 11;
		const dataType = Array.from(
			{ length: count },
			(_, index) => `dense${index}: { update(input: unknown): Promise<void> }`,
		).join("; ");
		const definitions = Array.from({ length: count }, (_, index) => {
			const calls = Array.from({ length: count }, (_, target) => target)
				.filter((target) => target !== index)
				.map(
					(target) =>
						`\t\tawait ctx.data.dense${target}.update({ key: { id: row.id }, patch: { note: "touch" } });`,
				)
				.join("\n");
			return `export const dense${index} = defineCollection({
\tname: "dense${index}",
\tfields: {
\t\tid: field.uuid({ nullable: false, default: "randomUuid", server: true, immutable: true }),
\t\tnote: field.text({ nullable: true }),
\t},
\tlifecycle: {
\t\t// @ts-expect-error LIFE-02 proves compiler reachability before LIFE-05 projects the authoring type.
\t\tafterWrite: async ({ ctx, row }: { ctx: { data: { ${dataType} } }; row: { id: string } }) => {
${calls}
\t\t},
\t},
\tconstraints: { primary: constraint.primaryKey({ fields: ["id"] }) },
});`;
		}).join("\n\n");
		const operations = Array.from(
			{ length: count },
			(_, index) => `
export const dense${index}Policy = definePolicy(dense${index}, {
	name: "dense${index}.default",
	update: {
		admit: policy.authenticated(),
		rows: ({ current }) => current.id.equal(current.id),
		candidate: ({ candidate, current }) => candidate.id.equal(current.id),
	},
	fields: {
		update: ({ current }) => ({ note: current.id.equal(current.id) }),
	},
});
export const dense${index}Operations = defineCollectionOperations(dense${index}, {
\tname: "dense${index}",
\tpolicy: dense${index}Policy,
\tupdate: { input: ["note"], select: { id: true, note: true } },
});`,
		).join("\n");
		await writeFile(
			join(temporary, "src/dense-lifecycle.ts"),
			`import { constraint, defineCollection, defineCollectionOperations, definePolicy, field, policy } from "questpie";\n\n${definitions}\n${operations}\n`,
		);
		const startedAt = performance.now();
		const compilation = await compileApplication({
			applicationRoot: temporary,
		});
		expect(performance.now() - startedAt).toBeLessThan(20_000);
		const programs = JSON.parse(
			compilation.generatedFiles["collection-lifecycle-programs.json"]!,
		) as Readonly<{ programs: readonly unknown[] }>;
		expect(programs.programs).toHaveLength(count + 1);
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
}, 30_000);

test("compiles Team Support Desk lifecycle authoring without retaining callbacks", async () => {
	const compilation = await compileApplication({
		applicationRoot: fixtureRoot,
	});
	const committedSchema = await readFile(
		join(fixtureRoot, ".questpie/generated/schema-projection.json"),
		"utf8",
	);
	expect(compilation.generatedFiles["schema-projection.json"]).toBe(
		committedSchema,
	);

	const artifactBytes =
		compilation.generatedFiles["collection-lifecycle-programs.json"]!;
	const artifacts = JSON.parse(artifactBytes) as Readonly<{
		format: string;
		version: number;
		programs: readonly Readonly<{
			format: string;
			interpreter: string;
			runtimeBuild: string;
			digest: string;
			bindings: Readonly<{
				collection: string;
				issues: Readonly<Record<string, string>>;
				operations: readonly string[];
			}>;
			phases: Readonly<Record<string, readonly unknown[]>>;
		}>[];
	}>;
	expect(artifacts.format).toBe("questpie.collection-lifecycle-programs");
	expect(artifacts.version).toBe(1);
	const tickets = artifacts.programs.find(
		(program) => program.bindings.collection === "collection:tickets",
	);
	expect(tickets).toEqual(
		expect.objectContaining({
			format: "questpie.lifecycle-program.v1",
			interpreter: "questpie.lifecycle-interpreter.v1",
			runtimeBuild: expect.stringMatching(/^[a-f0-9]{64}$/),
			digest: expect.stringMatching(/^[a-f0-9]{64}$/),
		}),
	);
	expect(tickets?.bindings.issues).toEqual({
		invalidReference: "issue:tickets/invalidReference",
	});
	expect(tickets?.bindings.operations).toContain("mutation:ticket.create");
	expect(tickets?.phases.normalize.length).toBeGreaterThan(0);
	expect(tickets?.phases.validate.length).toBeGreaterThan(0);
	expect(tickets?.phases.check).toEqual([]);
	expect(tickets?.phases.afterWrite).toEqual([]);
	expect(artifactBytes).not.toContain("=>");
	expect(artifactBytes).not.toContain(
		"AUTHORED_LIFECYCLE_CALLBACK_MUST_NOT_SHIP",
	);
	expect(compilation.generatedFiles["internal/application.js"]).not.toContain(
		"AUTHORED_LIFECYCLE_CALLBACK_MUST_NOT_SHIP",
	);
	const envelopeDigest = createHash("sha256")
		.update("questpie.collection-lifecycle-programs-v1\0")
		.update(artifactBytes)
		.digest("hex");
	expect(compilation.generatedFiles["internal/application.js"]).toContain(
		envelopeDigest,
	);

	const kernels = JSON.parse(
		compilation.generatedFiles["collection-operation-programs.json"]!,
	) as Readonly<{
		operations: readonly Readonly<{
			target: string;
			member: string;
			lifecycleProgramDigest: string | null;
		}>[];
	}>;
	expect(
		kernels.operations
			.filter(
				({ target, member }) =>
					target === "collection:tickets" &&
					(member === "create" || member === "update"),
			)
			.map(({ member, lifecycleProgramDigest }) => ({
				member,
				lifecycleProgramDigest,
			})),
	).toEqual([
		{ member: "create", lifecycleProgramDigest: tickets?.digest },
		{ member: "update", lifecycleProgramDigest: tickets?.digest },
	]);
	const runtimeBuild = JSON.parse(
		compilation.generatedFiles["runtime-build.json"]!,
	) as Readonly<{
		compilerRuntimeBuildDigest: string;
		inventory: readonly Readonly<{ path: string; digest: string }>[];
	}>;
	expect(tickets?.runtimeBuild).toBe(runtimeBuild.compilerRuntimeBuildDigest);
	expect(runtimeBuild.inventory).toContainEqual(
		expect.objectContaining({
			path: "collection-lifecycle-programs.json",
		}),
	);
	const postgresPlans = JSON.parse(
		compilation.generatedFiles["postgres-collection-operation-plans.json"]!,
	) as Readonly<{
		plans: readonly Readonly<{
			target: string;
			member: string;
			candidateValidation?: Readonly<{
				parameters: readonly Readonly<{ kind: string }>[];
			}>;
			write: Readonly<{
				parameters: readonly Readonly<{ kind: string }>[];
			}>;
		}>[];
	}>;
	const createPlan = postgresPlans.plans.find(
		({ target, member }) =>
			target === "collection:tickets" && member === "create",
	)!;
	expect(createPlan.candidateValidation).toBeDefined();
	expect(createPlan.write.parameters).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ kind: "candidateValue" }),
		]),
	);
	const operationContracts = JSON.parse(
		compilation.generatedFiles["operation-contracts.json"]!,
	) as Readonly<{
		operations: readonly Readonly<{
			identity: string;
			issueMappings?: Readonly<
				Record<string, Readonly<Record<string, string>>>
			>;
		}>[];
	}>;
	expect(
		operationContracts.operations.find(
			({ identity }) => identity === "mutation:ticket.create",
		)?.issueMappings,
	).toEqual({
		"collection:tickets": {
			"issue:tickets/invalidReference": "invalidTicket",
		},
	});

	const app = compilation.generatedFiles["app.ts"]!;
	expect(app).toContain('readonly "invalidReference": "invalidTicket";');
	expect(app).toContain(
		'issueMappings?: GeneratedMutations[Name]["issueMappings"]',
	);
}, 30_000);

test("projects explicit issue ownership for a generated named Mutation", async () => {
	const compilation = await compileApplication({
		applicationRoot: collaborationRoot,
	});
	const contracts = JSON.parse(
		compilation.generatedFiles["operation-contracts.json"]!,
	) as Readonly<{
		operations: readonly Readonly<{
			identity: string;
			declaredErrors: Readonly<Record<string, unknown>>;
			issueMappings?: Readonly<Record<string, unknown>>;
		}>[];
	}>;
	expect(
		contracts.operations.find(
			({ identity }) => identity === "mutation:messageEvents.create",
		),
	).toMatchObject({
		declaredErrors: {
			invalidMessageEvent: {
				code: "INVALID_MESSAGE_EVENT",
				status: 422,
				payload: null,
			},
		},
		issueMappings: {
			"collection:messageEvents": {
				"issue:messageEvents/invalidKind": "invalidMessageEvent",
			},
		},
	});
}, 30_000);

test("rejects an unmapped issue-bearing generated named Mutation", async () => {
	const temporary = await mkdtemp(
		join(resolve(import.meta.dir, "../.."), ".tmp-adr0031-generated-mapping-"),
	);
	try {
		await cp(collaborationRoot, temporary, { recursive: true });
		const path = join(temporary, "src/message-operations.ts");
		const source = await readFile(path, "utf8");
		await writeFile(
			path,
			source.replace(
				/\n\t\t\tissueMappings: \{\n\t\t\t\tmessageEvents: \{ invalidKind: "invalidMessageEvent" \},\n\t\t\t\},/,
				"",
			),
		);
		await expect(
			compileApplication({ applicationRoot: temporary }),
		).rejects.toMatchObject({
			code: "QP-COMPOSE-027",
			diagnosticClass: "missingIssueMapping",
			details: {
				operation: "mutation:messageEvents.create",
				path: [
					"mutation:messageEvents.create",
					"collection:messageEvents/create",
				],
				issue: "issue:messageEvents/invalidKind",
			},
		});
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
}, 30_000);

test("reports unsupported lifecycle capture at its authored Origin", async () => {
	const temporary = await mkdtemp(
		join(resolve(import.meta.dir, "../.."), ".tmp-adr0031-origin-"),
	);
	try {
		await cp(fixtureRoot, temporary, { recursive: true });
		const path = join(temporary, "src/tickets.ts");
		const source = await readFile(path, "utf8");
		await writeFile(
			path,
			source.replace(
				/\t\tnormalize: \(\{ input \}\) =>[\s\S]*?\n\t\t\t\t: input,/,
				"\t\tnormalize: ({ input }) => crypto.randomUUID(),",
			),
		);

		try {
			await compileApplication({ applicationRoot: temporary });
			throw new Error("expected lifecycle capture diagnostic");
		} catch (error) {
			expect(error).toBeInstanceOf(CompilerDiagnosticError);
			expect(error).toMatchObject({
				code: "QP-COMPOSE-026",
				diagnosticClass: "lifecycleCapture",
				details: {
					origin: { module: "src/tickets.ts", line: 83, column: 29 },
					phase: "normalize",
				},
			});
		}
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
}, 30_000);

test("rejects an incomplete issue mapping with the complete Collection-call path", async () => {
	const temporary = await mkdtemp(
		join(resolve(import.meta.dir, "../.."), ".tmp-adr0031-reachability-"),
	);
	try {
		await cp(fixtureRoot, temporary, { recursive: true });
		const collectionPath = join(temporary, "src/tickets.ts");
		const collectionSource = await readFile(collectionPath, "utf8");
		await writeFile(
			collectionPath,
			collectionSource
				.replace(
					"\t\tinvalidReference: collection.issue(),",
					"\t\tinvalidReference: collection.issue(),\n\t\temptySummary: collection.issue(),",
				)
				.replace(
					"\t\t\t\tthrow issues.invalidReference();",
					'\t\t\t\tthrow issues.invalidReference();\n\t\t\tif (candidate.summary === "") throw issues.emptySummary();',
				),
		);
		const mutationPath = join(temporary, "src/ticket-mutations.ts");
		const mutationSource = await readFile(mutationPath, "utf8");
		let mappingIndex = 0;
		await writeFile(
			mutationPath,
			mutationSource.replace(
				/tickets: \{ invalidReference: "invalidTicket" \},/g,
				(match) =>
					mappingIndex++ === 0
						? match
						: 'tickets: { invalidReference: "invalidTicket", emptySummary: "invalidTicket" },',
			),
		);

		try {
			await compileApplication({ applicationRoot: temporary });
			throw new Error("expected missing issue mapping diagnostic");
		} catch (error) {
			expect(error).toBeInstanceOf(CompilerDiagnosticError);
			expect(error).toMatchObject({
				code: "QP-COMPOSE-027",
				diagnosticClass: "missingIssueMapping",
				details: {
					phase: "validate",
					origin: { module: "src/tickets.ts", line: 94, column: 34 },
					mappingOrigin: {
						module: "src/ticket-mutations.ts",
						line: 85,
						column: 2,
					},
					callOrigin: {
						module: "src/ticket-mutations.ts",
						line: 86,
						column: 3,
					},
					operation: "mutation:ticket.create",
					path: ["mutation:ticket.create", "collection:tickets/create"],
					issue: "issue:tickets/emptySummary",
				},
			});
			expect((error as CompilerDiagnosticError).details.rewrite).toContain(
				'emptySummary: "declaredError"',
			);
		}
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
}, 30_000);

test("uses issue mappings, not handler syntax, as Collection capability admission", async () => {
	const temporary = await mkdtemp(
		join(resolve(import.meta.dir, "../.."), ".tmp-adr0031-admission-"),
	);
	try {
		await cp(fixtureRoot, temporary, { recursive: true });
		const mutationPath = join(temporary, "src/ticket-mutations.ts");
		const source = await readFile(mutationPath, "utf8");
		await writeFile(
			mutationPath,
			source.replace(
				"\t\tconst ticket = await ctx.data.tickets.create({",
				"\t\tconst ticketData = ctx.data.tickets;\n\t\tconst ticket = await ticketData.create({",
			),
		);

		const compilation = await compileApplication({
			applicationRoot: temporary,
		});
		expect(compilation.generatedFiles["app.ts"]).toContain(
			'readonly "invalidReference": "invalidTicket";',
		);
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
}, 30_000);

test("rejects a non-identity Collection issue at its exact declaration", async () => {
	const temporary = await mkdtemp(
		join(resolve(import.meta.dir, "../.."), ".tmp-adr0031-issue-name-"),
	);
	try {
		await cp(fixtureRoot, temporary, { recursive: true });
		const path = join(temporary, "src/tickets.ts");
		const source = await readFile(path, "utf8");
		await writeFile(
			path,
			source.replace(
				"\t\tinvalidReference: collection.issue(),",
				'\t\t"bad/name": collection.issue(),',
			),
		);

		await expect(
			compileApplication({ applicationRoot: temporary }),
		).rejects.toMatchObject({
			code: "QP-COMPOSE-027",
			diagnosticClass: "invalidIssueDeclaration",
			details: {
				phase: "validate",
				origin: { module: "src/tickets.ts", line: 80, column: 3 },
				rewrite: "use an identifier-safe issue name and collection.issue()",
			},
		});
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
}, 30_000);

test("rejects unknown, borrowed, and payload-bearing issue mappings", async () => {
	for (const [label, originLine, rewrite] of [
		[
			"unknown issue",
			86,
			(source: string) =>
				source.replace(
					'tickets: { invalidReference: "invalidTicket" },',
					'tickets: { unknownIssue: "invalidTicket" },',
				),
		],
		[
			"borrowed error",
			86,
			(source: string) =>
				source.replace(
					'tickets: { invalidReference: "invalidTicket" },',
					'tickets: { invalidReference: "notDeclaredHere" },',
				),
		],
		[
			"payload-bearing error",
			92,
			(source: string) =>
				source
					.replace(
						"const transitionRejected = operation.error({",
						`const invalidWithPayload = operation.error({
	code: "INVALID_WITH_PAYLOAD",
	status: 422,
	payload: codec.object({ detail: codec.text() }),
});

const transitionRejected = operation.error({`,
					)
					.replace(
						"errors: { invalidTicket, ticketUnavailable },",
						"errors: { invalidTicket, invalidWithPayload, ticketUnavailable },",
					)
					.replace(
						'invalidReference: "invalidTicket"',
						'invalidReference: "invalidWithPayload"',
					),
		],
	] as const) {
		const temporary = await mkdtemp(
			join(resolve(import.meta.dir, "../.."), `.tmp-adr0031-${label}-`),
		);
		try {
			await cp(fixtureRoot, temporary, { recursive: true });
			const path = join(temporary, "src/ticket-mutations.ts");
			await writeFile(path, rewrite(await readFile(path, "utf8")));
			await expect(
				compileApplication({ applicationRoot: temporary }),
			).rejects.toMatchObject({
				code: "QP-COMPOSE-027",
				diagnosticClass: "invalidIssueMapping",
				details: {
					origin: {
						module: "src/ticket-mutations.ts",
						line: originLine,
						column: 14,
					},
				},
			});
		} finally {
			await rm(temporary, { force: true, recursive: true });
		}
	}
}, 30_000);

test("reports a helper-authored issue mapping at its exact key Origin", async () => {
	const temporary = await mkdtemp(
		join(resolve(import.meta.dir, "../.."), ".tmp-adr0031-helper-origin-"),
	);
	try {
		await cp(fixtureRoot, temporary, { recursive: true });
		const path = join(temporary, "src/ticket-mutations.ts");
		const source = (await readFile(path, "utf8"))
			.replace(
				"export const createTicket = defineMutation({",
				`const createIssueMappings = {
	tickets: { unknownIssue: "invalidTicket" },
};

export const createTicket = defineMutation({`,
			)
			.replace(
				`issueMappings: {
		tickets: { invalidReference: "invalidTicket" },
	},`,
				"issueMappings: createIssueMappings,",
			);
		await writeFile(path, source);
		const prefix = source.slice(0, source.indexOf("unknownIssue"));
		const lines = prefix.split("\n");
		await expect(
			compileApplication({ applicationRoot: temporary }),
		).rejects.toMatchObject({
			code: "QP-COMPOSE-027",
			diagnosticClass: "invalidIssueMapping",
			details: {
				origin: {
					module: "src/ticket-mutations.ts",
					line: lines.length,
					column: lines.at(-1)!.length + 1,
				},
			},
		});
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
}, 30_000);

test("rejects unsupported lifecycle syntax and capability at compilation", async () => {
	for (const [authored, diagnosticClass] of [
		[
			"\t\tnormalize: async ({ input }) => input,",
			"unsupportedLifecycleSyntax",
		],
		[
			"\t\tnormalize: ({ input }) => { throw input; },",
			"unsupportedLifecycleCapability",
		],
	] as const) {
		const temporary = await mkdtemp(
			join(resolve(import.meta.dir, "../.."), ".tmp-adr0031-hostile-"),
		);
		try {
			await cp(fixtureRoot, temporary, { recursive: true });
			const path = join(temporary, "src/tickets.ts");
			const source = await readFile(path, "utf8");
			await writeFile(
				path,
				source.replace(
					/\t\tnormalize: \(\{ input \}\) =>[\s\S]*?\n\t\t\t\t: input,/,
					authored,
				),
			);
			await expect(
				compileApplication({ applicationRoot: temporary }),
			).rejects.toMatchObject({ code: "QP-COMPOSE-026", diagnosticClass });
		} finally {
			await rm(temporary, { force: true, recursive: true });
		}
	}
}, 30_000);
