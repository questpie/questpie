import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

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

function withoutTicketCheck(source: string): string {
	const start = source.indexOf("\n\t\tcheck: async ");
	const end = source.indexOf(
		'\n\t} satisfies CollectionLifecycle<"tickets">,',
		start,
	);
	if (start < 0 || end < 0)
		throw new TypeError("fixture ticket lifecycle check boundary is missing");
	return source.slice(0, start) + source.slice(end);
}

function withTicketNormalize(source: string, authored: string): string {
	const start = source.indexOf("\n\t\tnormalize:");
	const end = source.indexOf("\n\t\tvalidate:", start);
	if (start < 0 || end < 0)
		throw new TypeError("fixture normalize boundary is missing");
	return `${source.slice(0, start)}\n${authored}${source.slice(end)}`;
}

function sourceOrigin(module: string, source: string, needle: string) {
	const index = source.indexOf(needle);
	if (index < 0) throw new TypeError(`source origin is missing: ${needle}`);
	const prefix = source.slice(0, index);
	const lines = prefix.split("\n");
	return {
		module,
		line: lines.length,
		column: lines.at(-1)!.length + 1,
	};
}

function nestedRecords(
	value: unknown,
): readonly Readonly<Record<string, unknown>>[] {
	if (!value || typeof value !== "object") return [];
	if (Array.isArray(value)) return value.flatMap(nestedRecords);
	const record = value as Readonly<Record<string, unknown>>;
	return [record, ...Object.values(record).flatMap(nestedRecords)];
}

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
			withoutTicketCheck(await readFile(ticketsPath, "utf8")).replace(
				"\t\tvalidate: ({ candidate, issues }) => {",
				`\t\t// @ts-expect-error narrowed proof-only callback contract
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
\t\t// @ts-expect-error narrowed proof-only callback contract
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
		const valid = withoutTicketCheck(
			await readFile(ticketsPath, "utf8"),
		).replace(
			"\t\tvalidate: ({ candidate, issues }) => {",
			`\t\t// @ts-expect-error narrowed proof-only callback contract
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

test("lowers bounded lifecycle reads and afterWrite writes", async () => {
	const temporary = await mkdtemp(
		join(resolve(import.meta.dir, "../.."), ".tmp-adr0031-check-read-"),
	);
	try {
		await cp(fixtureRoot, temporary, { recursive: true });
		const teamsOperationsPath = join(temporary, "src/teams/operations.ts");
		const teamsOperations = await readFile(teamsOperationsPath, "utf8");
		await writeFile(
			teamsOperationsPath,
			teamsOperations
				.replace(
					'import { teams } from "../teams";',
					'import { teams } from "../teams";\nimport { teamListPlan } from "./query-plan";',
				)
				.replace(
					"\tpolicy: teamPolicy,",
					"\tpolicy: teamPolicy,\n\tlist: { data: teamListPlan },",
				),
		);
		const teamsQueriesPath = join(temporary, "src/teams/queries.ts");
		await writeFile(
			teamsQueriesPath,
			(await readFile(teamsQueriesPath, "utf8")).replace(
				'name: "teams.list"',
				'name: "teams.browse"',
			),
		);
		await rm(join(temporary, "src/team-mutations.ts"));
		const ticketsPath = join(temporary, "src/tickets.ts");
		const sourceWithoutCheck = withoutTicketCheck(
			await readFile(ticketsPath, "utf8"),
		);
		const normalizeStart = sourceWithoutCheck.indexOf("\n\t\tnormalize:");
		const validateStart = sourceWithoutCheck.indexOf(
			"\n\t\tvalidate:",
			normalizeStart,
		);
		if (normalizeStart < 0 || validateStart < 0)
			throw new TypeError("fixture normalize boundary is missing");
		const ticketsSource = `${sourceWithoutCheck.slice(0, normalizeStart)}\n\t\tnormalize: ({ input }) => input,${sourceWithoutCheck.slice(validateStart)}`;
		await writeFile(
			ticketsPath,
			`import type { LifecycleTypeProof } from "./lifecycle-type-consumer";\nexport type TicketLifecycleTypeProof = LifecycleTypeProof;\n${ticketsSource.replace(
				"\t\tvalidate: ({ candidate, issues }) => {",
				`\t\tcheck: async ({ candidate, ctx, issues }) => {
\t\t\tconst team = await ctx.data.teams.get({ key: { id: candidate.teamId }, select: { routingStatus: true, id: true } });
\t\t\tif (team === null || team.routingStatus !== "active") throw issues.invalidReference();
\t\t},
\t\tafterWrite: async ({ ctx, row }) => {
\t\t\tif (ctx.callId === "" || ctx.now > ctx.now) return;
\t\t\tconst team = await ctx.data.teams.get({ key: { id: row.teamId }, select: { routingStatus: true, id: true } });
\t\t\tif (team !== null) await ctx.data.teams.update({ key: { id: team.id }, patch: { routingStatus: "active" } });
\t\t\tconst listedTeams = await ctx.data.teams.list({ organizationId: row.organizationId, first: 2, after: null });
\t\t\tfor (const listedTeam of listedTeams) await ctx.data.teams.update({ key: { id: listedTeam.id }, patch: { routingStatus: "active" } });
\t\t\tawait ctx.jobs.ticket.slaFollowUp.accept({ input: { organizationId: row.organizationId, ticketId: row.id, reference: row.reference, summary: row.summary, dueAt: ctx.now }, idempotencyKey: ctx.callId });
\t\t},
\t\tvalidate: ({ candidate, issues }) => {`,
			)}`,
		);
		await writeFile(
			join(temporary, "src/lifecycle-type-consumer.ts"),
			`import type { CollectionLifecycle } from "#questpie/app";

const check: NonNullable<CollectionLifecycle<"tickets">["check"]> = async ({ candidate, ctx, issues, now }) => {
	candidate.teamId satisfies string;
	now satisfies Date;
	const team = await ctx.data.teams.get({ key: { id: candidate.teamId }, select: { id: true, routingStatus: true } });
	team satisfies Readonly<{ id: string; routingStatus: string }> | null;
	// @ts-expect-error a generated lifecycle get requires at least one selected Field
	await ctx.data.teams.get({ key: { id: candidate.teamId }, select: {} });
	throw issues.invalidReference();
};
void check;
const afterWrite: NonNullable<CollectionLifecycle<"tickets">["afterWrite"]> = async ({ row, previous, ctx }) => {
	ctx.now satisfies Date;
	ctx.callId satisfies string;
	const team = await ctx.data.teams.get({ key: { id: row.teamId }, select: { id: true } });
	team satisfies Readonly<{ id: string }> | null;
	const listedTeams = await ctx.data.teams.list({ organizationId: row.organizationId, first: 2, after: null });
	listedTeams satisfies ReadonlyArray<Readonly<{ id: string; organizationId: string; name: string; routingStatus: string }>>;
	for (const listedTeam of listedTeams) listedTeam.id satisfies string;
	// @ts-expect-error a generated lifecycle list requires an explicit first
	await ctx.data.teams.list({ organizationId: row.organizationId, after: null });
	await ctx.data.teams.update({ key: { id: row.teamId }, patch: { routingStatus: "active" } });
	const accepted = await ctx.jobs.ticket.slaFollowUp.accept({ input: { organizationId: row.organizationId, ticketId: row.id, reference: row.reference, summary: row.summary, dueAt: ctx.now }, idempotencyKey: ctx.callId });
	accepted.resource satisfies "job:ticket.slaFollowUp";
	previous satisfies typeof row | null;
};
void afterWrite;
// @ts-expect-error check Context has no Service capability
declare const noServices: Parameters<NonNullable<CollectionLifecycle<"tickets">["check"]>>[0]["ctx"]["services"];
// @ts-expect-error only generated bounded get Operations are present
declare const noWrites: Parameters<NonNullable<CollectionLifecycle<"tickets">["check"]>>[0]["ctx"]["data"]["teams"]["update"];
// @ts-expect-error Collection without a generated get is absent
declare const noComments: Parameters<NonNullable<CollectionLifecycle<"tickets">["check"]>>[0]["ctx"]["data"]["comments"];
// @ts-expect-error check is always asynchronous
const synchronousCheck: NonNullable<CollectionLifecycle<"tickets">["check"]> = () => {};
void synchronousCheck;
// @ts-expect-error afterWrite has no Service capability
declare const noAfterWriteServices: Parameters<NonNullable<CollectionLifecycle<"tickets">["afterWrite"]>>[0]["ctx"]["services"];
// @ts-expect-error afterWrite has no Action capability
declare const noAfterWriteActions: Parameters<NonNullable<CollectionLifecycle<"tickets">["afterWrite"]>>[0]["ctx"]["actions"];
// @ts-expect-error afterWrite has no Request capability
declare const noAfterWriteRequest: Parameters<NonNullable<CollectionLifecycle<"tickets">["afterWrite"]>>[0]["ctx"]["request"];
// @ts-expect-error afterWrite has no Route capability
declare const noAfterWriteRoute: Parameters<NonNullable<CollectionLifecycle<"tickets">["afterWrite"]>>[0]["ctx"]["route"];
// @ts-expect-error afterWrite has no raw SQL capability
declare const noAfterWriteSql: Parameters<NonNullable<CollectionLifecycle<"tickets">["afterWrite"]>>[0]["ctx"]["sql"];
// @ts-expect-error afterWrite has no raw transaction capability
declare const noAfterWriteTransaction: Parameters<NonNullable<CollectionLifecycle<"tickets">["afterWrite"]>>[0]["ctx"]["transaction"];
export type LifecycleTypeProof = typeof check;
`,
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
					jobs: readonly string[];
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
			"data.teams.list": {
				argumentKeys: ["after", "first", "organizationId"],
				cardinality: "many",
				first: false,
				identity: "query:teams.list",
				kind: "read",
				maxRows: 100,
			},
			"data.teams.update": {
				argumentKeys: ["key.id", "patch.routingStatus"],
				identity: "mutation:__collectionKernel.teams.update",
				kind: "write",
			},
			"jobs.ticket.slaFollowUp.accept": {
				argumentKeys: [
					"idempotencyKey",
					"input.dueAt",
					"input.organizationId",
					"input.reference",
					"input.summary",
					"input.ticketId",
				],
				identity: "job:ticket.slaFollowUp",
				kind: "acceptJob",
			},
		});
		expect(tickets.bindings.jobs).toEqual(["job:ticket.slaFollowUp"]);
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
		expect(tickets.phases.afterWrite).toEqual([
			expect.objectContaining({
				op: "if",
				test: expect.objectContaining({ op: "binary", operator: "||" }),
			}),
			expect.objectContaining({
				op: "const",
				value: expect.objectContaining({
					op: "capability",
					capability: "read",
					identity: "query:teams.get",
				}),
			}),
			expect.objectContaining({ op: "if" }),
			expect.objectContaining({
				op: "const",
				value: expect.objectContaining({
					op: "capability",
					capability: "read",
					identity: "query:teams.list",
				}),
			}),
			expect.objectContaining({
				op: "forOf",
				body: [expect.objectContaining({ op: "effect" })],
			}),
			expect.objectContaining({
				op: "effect",
				value: expect.objectContaining({
					capability: "acceptJob",
					identity: "job:ticket.slaFollowUp",
				}),
			}),
		]);
		await writeFile(
			ticketsPath,
			(await readFile(ticketsPath, "utf8")).replace(
				"organizationId: row.organizationId, first: 2, after: null",
				"organizationId: row.organizationId, after: null",
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

test("rejects different argument shapes for one capability across phases", async () => {
	const temporary = await mkdtemp(
		join(resolve(import.meta.dir, "../.."), ".tmp-adr0031-cross-phase-shape-"),
	);
	try {
		await cp(fixtureRoot, temporary, { recursive: true });
		const path = join(temporary, "src/tickets.ts");
		const source = withoutTicketCheck(await readFile(path, "utf8")).replace(
			"\t\tvalidate: ({ candidate, issues }) => {",
			`\t\tcheck: async ({ candidate, ctx }) => {
\t\t\tconst team = await ctx.data.teams.get({ key: { id: candidate.teamId }, select: { id: true, routingStatus: true } });
\t\t\tif (team === null) return;
\t\t},
\t\tafterWrite: async ({ row, ctx }) => {
\t\t\tconst team = await ctx.data.teams.get({ key: { id: row.teamId }, select: { id: true } });
\t\t\tif (team === null) return;
\t\t},
\t\tvalidate: ({ candidate, issues }) => {`,
		);
		await writeFile(path, source);
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

test("rejects parallel, detached, ambient, and external afterWrite work", async () => {
	for (const authored of [
		`afterWrite: async ({ ctx }) => { await ctx.services.audit.record({}); },`,
		`afterWrite: async ({ ctx }) => { await ctx.actions.delivery.publish({}); },`,
		`afterWrite: async ({ ctx }) => { ctx.jobs.ticket.slaFollowUp.accept({ input: {}, idempotencyKey: ctx.callId }); },`,
		`afterWrite: async ({ ctx }) => { await Promise.all([ctx.jobs.ticket.slaFollowUp.accept({ input: {}, idempotencyKey: ctx.callId })]); },`,
		`afterWrite: async ({ row }) => { setTimeout(() => void row, 0); },`,
	] as const) {
		const temporary = await mkdtemp(
			join(
				resolve(import.meta.dir, "../.."),
				".tmp-adr0031-after-write-hostile-",
			),
		);
		try {
			await cp(fixtureRoot, temporary, { recursive: true });
			const path = join(temporary, "src/tickets.ts");
			const source = withoutTicketCheck(await readFile(path, "utf8")).replace(
				"\t\tvalidate: ({ candidate, issues }) => {",
				`\t\t${authored}\n\t\tvalidate: ({ candidate, issues }) => {`,
			);
			await writeFile(path, source);
			await expect(
				compileApplication({ applicationRoot: temporary }),
			).rejects.toMatchObject({ code: "QP-COMPOSE-026" });
		} finally {
			await rm(temporary, { force: true, recursive: true });
		}
	}
}, 30_000);

test("rejects unbounded, detached, write, and inexact check capabilities", async () => {
	for (const hostile of [
		{
			authored: `check: ({ candidate }) => { return candidate; },`,
			diagnosticClass: "unsupportedLifecycleSyntax",
			needle: "({ candidate })",
		},
		{
			authored: `check: async ({ ctx }) => { ctx.data.teams.get({ key: { id: "00000000-0000-4000-8000-000000000001" }, select: { id: true } }); },`,
			diagnosticClass: "unsupportedLifecycleSyntax",
			needle: "ctx.data.teams.get",
		},
		{
			authored: `check: async ({ ctx }) => { const team = await ctx.data.teams.update({ key: { id: "00000000-0000-4000-8000-000000000001" }, patch: { name: "forbidden" } }); return team; },`,
			diagnosticClass: "unsupportedLifecycleCapability",
			needle: "ctx.data.teams.update",
		},
		{
			authored: `check: async ({ ctx }) => { const team = await ctx.data.teams.get({ key: { id: "00000000-0000-4000-8000-000000000001" }, select: { missing: true } }); return team; },`,
			diagnosticClass: "unsupportedLifecycleSyntax",
			needle: "missing",
		},
		{
			authored: `check: async ({ ctx }) => { const rows = await Promise.all([ctx.data.teams.get({ key: { id: "00000000-0000-4000-8000-000000000001" }, select: { id: true } })]); return rows; },`,
			diagnosticClass: "unsupportedLifecycleCapability",
			needle: "Promise.all",
		},
		{
			authored: `check: async ({ ctx }) => { await ctx.services.audit.record({ event: "forbidden" }); },`,
			diagnosticClass: "unsupportedLifecycleCapability",
			needle: "ctx.services",
		},
		{
			authored: `check: async ({ ctx }) => { await ctx.actions.delivery.publish({ message: "forbidden" }); },`,
			diagnosticClass: "unsupportedLifecycleCapability",
			needle: "ctx.actions",
		},
		{
			authored: `check: async ({ ctx }) => { return ctx.request; },`,
			diagnosticClass: "unsupportedLifecycleSyntax",
			needle: "request;",
		},
		{
			authored: `check: async ({ ctx }) => { return ctx.route; },`,
			diagnosticClass: "unsupportedLifecycleSyntax",
			needle: "route;",
		},
		{
			authored: `check: async ({ ctx }) => { await ctx.sql.query("SELECT 1"); },`,
			diagnosticClass: "unsupportedLifecycleCapability",
			needle: "ctx.sql",
		},
		{
			authored: `check: async ({ ctx }) => { await ctx.transaction.query("SELECT 1"); },`,
			diagnosticClass: "unsupportedLifecycleCapability",
			needle: "ctx.transaction",
		},
		{
			authored: `check: async ({ candidate }) => { setTimeout(() => void candidate, 0); },`,
			diagnosticClass: "lifecycleCapture",
			needle: "setTimeout",
		},
		{
			authored: `check: async ({ issues }) => { if (memberships) throw issues.invalidReference(); },`,
			diagnosticClass: "lifecycleCapture",
			needle: "memberships)",
		},
		{
			authored: `check: async ({ issues }) => { if (lifecycleCapturedValue) throw issues.invalidReference(); },`,
			diagnosticClass: "lifecycleCapture",
			needle: "lifecycleCapturedValue)",
			prelude: "const lifecycleCapturedValue = true;",
		},
	] as const) {
		const { authored, diagnosticClass, needle } = hostile;
		const prelude = "prelude" in hostile ? hostile.prelude : undefined;
		const temporary = await mkdtemp(
			join(resolve(import.meta.dir, "../.."), ".tmp-adr0031-check-hostile-"),
		);
		try {
			await cp(fixtureRoot, temporary, { recursive: true });
			const ticketsPath = join(temporary, "src/tickets.ts");
			let authoredSource = withoutTicketCheck(
				await readFile(ticketsPath, "utf8"),
			);
			if (prelude)
				authoredSource = authoredSource.replace(
					'import { memberships } from "./memberships";',
					`import { memberships } from "./memberships";\n\n${prelude}`,
				);
			authoredSource = authoredSource.replace(
				"\t\tvalidate: ({ candidate, issues }) => {",
				`\t\t${authored}\n\t\tvalidate: ({ candidate, issues }) => {`,
			);
			await writeFile(ticketsPath, authoredSource);
			await expect(
				compileApplication({ applicationRoot: temporary }),
			).rejects.toMatchObject({
				code: "QP-COMPOSE-026",
				diagnosticClass,
				details: {
					phase: "check",
					origin: sourceOrigin("src/tickets.ts", authoredSource, needle),
				},
			});
		} finally {
			await rm(temporary, { force: true, recursive: true });
		}
	}
}, 60_000);

test("rejects ambient clocks and network access before lifecycle lowering", async () => {
	for (const expression of ["Date.now()", 'fetch("https://example.invalid")']) {
		const temporary = await mkdtemp(
			join(resolve(import.meta.dir, "../.."), ".tmp-adr0031-check-ambient-"),
		);
		try {
			await cp(fixtureRoot, temporary, { recursive: true });
			const ticketsPath = join(temporary, "src/tickets.ts");
			await writeFile(
				ticketsPath,
				withoutTicketCheck(await readFile(ticketsPath, "utf8")).replace(
					"\t\tvalidate: ({ candidate, issues }) => {",
					`\t\tcheck: async ({ candidate }) => { void candidate; void ${expression}; },\n\t\tvalidate: ({ candidate, issues }) => {`,
				),
			);
			await expect(
				compileApplication({ applicationRoot: temporary }),
			).rejects.toMatchObject({
				code: "QP-COMPOSE-010",
				diagnosticClass: "impureStructuralGraph",
				details: {
					path: relative(resolve(import.meta.dir, "../.."), ticketsPath),
				},
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
		expect(programs.programs).toHaveLength(count + 3);
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
				capabilities: Readonly<Record<string, unknown>>;
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
	const optionalStringCalls = nestedRecords(tickets?.phases.normalize).filter(
		(expression) =>
			expression.op === "stringMethod" && expression.optional === true,
	);
	expect(optionalStringCalls.length).toBeGreaterThan(0);
	expect(
		optionalStringCalls.every((expression) => {
			const target = expression.target as
				| Readonly<Record<string, unknown>>
				| undefined;
			return target?.op === "member" && target.optional === true;
		}),
	).toBe(true);
	expect(tickets?.phases.validate.length).toBeGreaterThan(0);
	expect(tickets?.bindings.capabilities).toEqual({
		"data.memberships.get": expect.objectContaining({
			identity: "query:memberships.get",
			kind: "read",
		}),
		"data.teams.get": expect.objectContaining({
			identity: "query:teams.get",
			kind: "read",
		}),
		"jobs.ticket.slaFollowUp.accept": expect.objectContaining({
			identity: "job:ticket.slaFollowUp",
			kind: "acceptJob",
		}),
	});
	expect(tickets?.phases.check.length).toBeGreaterThan(0);
	expect(tickets?.phases.afterWrite.length).toBeGreaterThan(0);
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
				currentResult?: readonly Readonly<{
					path: readonly string[];
					column: string;
				}>[];
			}>;
			candidatePolicyCheck?: Readonly<{
				sql: string;
				parameters: readonly Readonly<{ kind: string }>[];
				outcome: string;
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
	const updatePlan = postgresPlans.plans.find(
		({ target, member }) =>
			target === "collection:tickets" && member === "update",
	)!;
	expect(createPlan.candidateValidation).toBeDefined();
	expect(createPlan.candidatePolicyCheck).toMatchObject({
		outcome: "authorizedOrUnavailable",
	});
	expect(createPlan.candidatePolicyCheck?.sql).toContain("SELECT TRUE");
	expect(createPlan.candidatePolicyCheck?.parameters).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ kind: "candidateValue" }),
		]),
	);
	expect(updatePlan.candidatePolicyCheck).toMatchObject({
		outcome: "authorizedOrUnavailable",
	});
	expect(updatePlan.candidatePolicyCheck?.parameters).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ kind: "key" }),
			expect.objectContaining({ kind: "candidateValue" }),
		]),
	);
	expect(updatePlan.candidateValidation?.currentResult).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				path: ["id"],
				column: expect.stringMatching(/^qp_current_\d+$/),
			}),
		]),
	);
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
			({ identity }) => identity === "mutation:messages.create",
		),
	).toMatchObject({
		declaredErrors: {
			channelUnavailable: {
				code: "CHANNEL_UNAVAILABLE",
				status: 404,
				payload: null,
			},
			invalidMessageEvent: {
				code: "INVALID_MESSAGE_EVENT",
				status: 422,
				payload: null,
			},
		},
		issueMappings: {
			"collection:messages": {
				"issue:messages/channelUnavailable": "channelUnavailable",
			},
			"collection:messageEvents": {
				"issue:messageEvents/invalidKind": "invalidMessageEvent",
			},
		},
	});
	expect(
		contracts.operations.find(
			({ identity }) => identity === "mutation:message.publish",
		)?.issueMappings,
	).toMatchObject({
		"collection:messages": {
			"issue:messages/channelUnavailable": "channelUnavailable",
		},
	});
	const lifecyclePrograms = JSON.parse(
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
		lifecyclePrograms.programs.find(
			({ bindings }) => bindings.collection === "collection:messages",
		)?.bindings.capabilities,
	).toEqual({
		"data.channels.get": expect.objectContaining({
			identity: "query:channels.get",
			kind: "read",
		}),
		"data.messageEvents.create": expect.objectContaining({
			identity: "mutation:__collectionKernel.messageEvents.create",
			kind: "write",
		}),
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
				/\n\t\t\tmessageEvents: \{ invalidKind: "invalidMessageEvent" \},/,
				"",
			),
		);
		await expect(
			compileApplication({ applicationRoot: temporary }),
		).rejects.toMatchObject({
			code: "QP-COMPOSE-027",
			diagnosticClass: "missingIssueMapping",
			details: {
				operation: "mutation:messages.create",
				path: [
					"mutation:messages.create",
					"collection:messages/create",
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
		const authored = withTicketNormalize(
			source,
			"\t\tnormalize: ({ input }) => crypto.randomUUID(),",
		);
		await writeFile(path, authored);

		try {
			await compileApplication({ applicationRoot: temporary });
			throw new Error("expected lifecycle capture diagnostic");
		} catch (error) {
			expect(error).toBeInstanceOf(CompilerDiagnosticError);
			expect(error).toMatchObject({
				code: "QP-COMPOSE-026",
				diagnosticClass: "lifecycleCapture",
				details: {
					origin: sourceOrigin("src/tickets.ts", authored, "crypto.randomUUID"),
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
		const authoredCollection = collectionSource
			.replace(
				"\t\tinvalidReference: collection.issue(),",
				"\t\tinvalidReference: collection.issue(),\n\t\temptySummary: collection.issue(),",
			)
			.replace(
				"\t\t\t\tthrow issues.invalidReference();",
				'\t\t\t\tthrow issues.invalidReference();\n\t\t\tif (candidate.summary === "") throw issues.emptySummary();',
			);
		await writeFile(collectionPath, authoredCollection);
		const mutationPath = join(temporary, "src/ticket-mutations.ts");
		const mutationSource = await readFile(mutationPath, "utf8");
		let mappingIndex = 0;
		const authoredMutation = mutationSource.replace(
			/tickets: \{ invalidReference: "invalidTicket" \},/g,
			(match) =>
				mappingIndex++ === 0
					? match
					: 'tickets: { invalidReference: "invalidTicket", emptySummary: "invalidTicket" },',
		);
		await writeFile(mutationPath, authoredMutation);

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
					origin: sourceOrigin(
						"src/tickets.ts",
						authoredCollection,
						"throw issues.emptySummary()",
					),
					mappingOrigin: sourceOrigin(
						"src/ticket-mutations.ts",
						authoredMutation,
						"issueMappings:",
					),
					callOrigin: sourceOrigin(
						"src/ticket-mutations.ts",
						authoredMutation,
						'tickets: { invalidReference: "invalidTicket" },',
					),
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
		const authored = source.replace(
			"\t\tinvalidReference: collection.issue(),",
			'\t\t"bad/name": collection.issue(),',
		);
		await writeFile(path, authored);

		await expect(
			compileApplication({ applicationRoot: temporary }),
		).rejects.toMatchObject({
			code: "QP-COMPOSE-027",
			diagnosticClass: "invalidIssueDeclaration",
			details: {
				phase: "validate",
				origin: sourceOrigin("src/tickets.ts", authored, '"bad/name"'),
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
			await writeFile(path, withTicketNormalize(source, authored));
			await expect(
				compileApplication({ applicationRoot: temporary }),
			).rejects.toMatchObject({ code: "QP-COMPOSE-026", diagnosticClass });
		} finally {
			await rm(temporary, { force: true, recursive: true });
		}
	}
}, 30_000);
