import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { canonicalBytes } from "../../packages/compiler/src/canonical";
import { CompilerDiagnosticError } from "../../packages/compiler/src/diagnostic";
import {
	collectReachableSourceFiles,
	evaluateModules,
} from "../../packages/compiler/src/discovery";
import { normalizeDataQueryTemplate } from "../../packages/compiler/src/relational";

const frameworkEntry = resolve(
	import.meta.dir,
	"../../packages/questpie/src/index.ts",
);
const teamSupportDeskRoot = resolve(
	import.meta.dir,
	"../../fixtures/team-support-desk",
);

function source(child: string, second = "", conditionalOrder = false): string {
	return `import { codec, constraint, defineCollection, definePolicy, expr, field, policy, relation, relationRef } from "questpie";
export const countries = defineCollection({ name: "countries", fields: { id: field.uuid({ nullable: false }), name: field.text({ nullable: false }) }, constraints: { primary: constraint.primaryKey({ fields: ["id"] }) }, relations: {} });
export const regions = defineCollection({ name: "regions", fields: { id: field.uuid({ nullable: false }), countryId: field.uuid({ nullable: false }) }, constraints: { primary: constraint.primaryKey({ fields: ["id"] }) }, relations: { country: relation.toOne({ target: countries, fields: ["countryId"], references: ["id"] }) } });
export const organizations = defineCollection({ name: "organizations", fields: { id: field.uuid({ nullable: false }), regionId: field.uuid({ nullable: false }) }, constraints: { primary: constraint.primaryKey({ fields: ["id"] }) }, relations: { region: relation.toOne({ target: regions, fields: ["regionId"], references: ["id"] }) } });
export const teams = defineCollection({ name: "teams", fields: { id: field.uuid({ nullable: false }), organizationId: field.uuid({ nullable: false }) }, constraints: { primary: constraint.primaryKey({ fields: ["id"] }) }, relations: { organization: relation.toOne({ target: organizations, fields: ["organizationId"], references: ["id"] }) } });
export const tickets = defineCollection({
  name: "tickets", fields: { id: field.uuid({ nullable: false }), teamId: field.uuid({ nullable: false }) },
  constraints: { primary: constraint.primaryKey({ fields: ["id"] }) },
  relations: { comments: relation.toMany({ inverseOf: relationRef("comments", "ticket") }), team: relation.toOne({ target: teams, fields: ["teamId"], references: ["id"] }), ${second ? 'otherComments: relation.toMany({ inverseOf: relationRef("comments", "ticket") }),' : ""} },
});
export const comments = defineCollection({
  name: "comments",
  fields: { id: field.uuid({ nullable: false }), ticketId: field.uuid({ nullable: false }), body: field.text({ nullable: false }) },
  constraints: { primary: constraint.primaryKey({ fields: ["id"] }) },
  relations: { ticket: relation.toOne({ target: tickets, fields: ["ticketId"], references: ["id"] }) },
});
export const labels = defineCollection({
  name: "labels",
  fields: { id: field.uuid({ nullable: false }), body: field.text({ nullable: false }) },
  constraints: { primary: constraint.primaryKey({ fields: ["id"] }) },
  relations: {},
});
${conditionalOrder ? 'export const commentPolicy = definePolicy(comments, { name: "comments.default", read: { admit: policy.public(), rows: () => expr.always() }, fields: { output: ({ row }) => ({ id: row.id.equal(row.id) }) } });' : ""}
const child = ${child};
export const ticketDetail = tickets.list({
  parameters: { first: codec.integer({ minimum: 1, maximum: 100 }), after: codec.nullable(codec.cursor()) },
  where: ({ row }) => row.id.equal("00000000-0000-0000-0000-000000000000"),
  orderBy: { id: "asc" }, select: { id: true, comments: child${second} },
  page: ({ parameters }) => ({ first: parameters.first, after: parameters.after }),
});`;
}

function recursiveToOneSource(): string {
	return `import { codec, constraint, defineCollection, field, relation } from "questpie";
export const countries = defineCollection({ name: "countries", fields: { id: field.uuid({ nullable: false }), name: field.text({ nullable: false }) }, constraints: { primary: constraint.primaryKey({ fields: ["id"] }) }, relations: {} });
export const regions = defineCollection({ name: "regions", fields: { id: field.uuid({ nullable: false }), countryId: field.uuid({ nullable: false }) }, constraints: { primary: constraint.primaryKey({ fields: ["id"] }) }, relations: { country: relation.toOne({ target: countries, fields: ["countryId"], references: ["id"] }) } });
export const organizations = defineCollection({ name: "organizations", fields: { id: field.uuid({ nullable: false }), regionId: field.uuid({ nullable: false }) }, constraints: { primary: constraint.primaryKey({ fields: ["id"] }) }, relations: { region: relation.toOne({ target: regions, fields: ["regionId"], references: ["id"] }) } });
export const teams = defineCollection({ name: "teams", fields: { id: field.uuid({ nullable: false }), organizationId: field.uuid({ nullable: false }) }, constraints: { primary: constraint.primaryKey({ fields: ["id"] }) }, relations: { organization: relation.toOne({ target: organizations, fields: ["organizationId"], references: ["id"] }) } });
export const tickets = defineCollection({ name: "tickets", fields: { id: field.uuid({ nullable: false }), teamId: field.uuid({ nullable: false }) }, constraints: { primary: constraint.primaryKey({ fields: ["id"] }) }, relations: { team: relation.toOne({ target: teams, fields: ["teamId"], references: ["id"] }) } });
export const ticketDetail = tickets.list({
  parameters: { first: codec.integer({ minimum: 1, maximum: 100 }), after: codec.nullable(codec.cursor()) },
  where: ({ row }) => row.id.equal("00000000-0000-0000-0000-000000000000"),
  orderBy: { id: "asc" },
  select: {
    id: true,
    team: {
      select: {
        id: true,
        organization: {
          select: {
            id: true,
            region: {
              select: {
                id: true,
                country: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    },
  },
  page: ({ parameters }) => ({ first: parameters.first, after: parameters.after }),
});`;
}

async function evaluate(
	authored: string,
): Promise<Readonly<Record<string, unknown>>> {
	const root = await mkdtemp(join(tmpdir(), "questpie-inv01-evaluator-"));
	try {
		const module = join(root, "ticket detail.ts");
		await writeFile(module, authored);
		const exports = await evaluateModules({
			applicationRoot: root,
			files: [module],
			frameworkEntry,
			packages: new Map(),
		});
		return exports.find(({ exportName }) => exportName === "ticketDetail")!
			.value;
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

const accepted = `comments.list({ first: 10, where: ({ row }) => row.body.notEqual("filtered"), orderBy: { id: "asc" }, select: { id: true, body: true, ticket: { select: { id: true } } } })`;

const recursiveToOne = `comments.list({ first: 10, orderBy: { id: "asc" }, select: { id: true, ticket: { select: { id: true, team: { select: { id: true, organization: { select: { id: true, region: { select: { id: true, country: { select: { id: true, name: true } } } } } } } } } } } })`;

test("evaluates the real Team Support Desk inverse projection source", async () => {
	const entry = join(
		teamSupportDeskRoot,
		"src/tickets/__fixtures__/inverse-projection.ts",
	);
	const files = await collectReachableSourceFiles([entry], new Map());
	const exports = await evaluateModules({
		applicationRoot: teamSupportDeskRoot,
		files,
		frameworkEntry,
		packages: new Map(),
	});
	const value = exports.find(
		({ logicalPath, exportName }) =>
			logicalPath === "src/tickets/__fixtures__/inverse-projection.ts" &&
			exportName === "ticketDetailWithComments",
	)?.value;
	expect(value?.templateInput).toMatchObject({
		from: "collection:tickets",
		select: expect.arrayContaining([
			expect.objectContaining({
				kind: "inverseList",
				key: "comments",
				relation: "collection:comments/relation:ticket",
			}),
		]),
	});
});

test("compiles the Team Support Desk child list through the production evaluator", async () => {
	const value = await evaluate(source(accepted));
	const template = value.templateInput as {
		select: readonly Readonly<Record<string, unknown>>[];
	};
	expect(template.select.find(({ kind }) => kind === "inverseList")).toEqual({
		kind: "inverseList",
		key: "comments",
		relation: "collection:comments/relation:ticket",
		source: "collection:comments",
		first: 10,
		filter: expect.objectContaining({ kind: "notEqual" }),
		order: [
			{
				field: "collection:comments/field:id",
				direction: "asc",
				nulls: "last",
			},
		],
		select: [
			{ kind: "field", key: "body", field: "collection:comments/field:body" },
			{ kind: "field", key: "id", field: "collection:comments/field:id" },
			{
				kind: "toOne",
				key: "ticket",
				relation: "collection:comments/relation:ticket",
				select: [
					{ kind: "field", key: "id", field: "collection:tickets/field:id" },
				],
			},
		],
	});
});

test("keeps recursive toOne-only production authoring on byte-identical Template v1", async () => {
	const value = await evaluate(recursiveToOneSource());
	const template = normalizeDataQueryTemplate(
		value.templateInput,
		{
			schemaProjectionDigest: "a".repeat(64),
			dataContractProjectionDigest: "b".repeat(64),
		},
		{ path: "ticket detail.ts", exportName: "ticketDetail" },
	);
	expect(template).toMatchObject({
		format: "questpie.data-query-template",
		version: 1,
	});
	expect(canonicalBytes(template)).toMatchSnapshot();
});

test.each([
	[
		accepted.replace("first: 10", "first: Number('51')"),
		"QP-DATA-026",
		"comments",
	],
	[accepted.replace("comments.list", "labels.list"), "QP-DATA-026", "comments"],
	[`({ ...${accepted}, after: "cursor" })`, "QP-DATA-026", "comments"],
	[
		accepted
			.replace('orderBy: { id: "asc" }', 'orderBy: { body: "asc" }')
			.replace("body: true, ", ""),
		"QP-DATA-008",
		"comments.body",
	],
	[
		accepted.replace('orderBy: { id: "asc" }', 'orderBy: { body: "asc" }'),
		"QP-DATA-026",
		"comments",
	],
	[
		accepted.replace(
			"id: true, body: true, ticket: { select: { id: true } }",
			"",
		),
		"QP-DATA-026",
		"comments",
	],
	[accepted.replace("body: true", "missing: true"), "QP-DATA-026", "comments"],
] as const)(
	"rejects hostile child authoring through the production evaluator",
	async (child, code, path) => {
		try {
			await evaluate(source(child));
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(CompilerDiagnosticError);
			expect(error).toMatchObject({
				code,
				details: {
					path,
					origin: { path: "ticket detail.ts", exportName: "ticketDetail" },
				},
			});
		}
	},
);

test("rejects a second plural child list", async () => {
	await expect(
		evaluate(source(accepted, ", otherComments: child")),
	).rejects.toMatchObject({
		code: "QP-DATA-026",
		details: { path: "otherComments" },
	});
});

test("rejects a conditionally visible child order Field", async () => {
	await expect(evaluate(source(accepted, "", true))).rejects.toMatchObject({
		code: "QP-DATA-008",
		details: { path: "comments.id" },
	});
});

test("rejects an unsupported inverse child filter expression", async () => {
	const forged = accepted.replace(
		'where: ({ row }) => row.body.notEqual("filtered")',
		'where: () => ({ kind: "forgedExpression" } as any)',
	);
	await expect(evaluate(source(forged))).rejects.toMatchObject({
		code: "QP-DATA-026",
		details: {
			path: "comments",
			origin: { path: "ticket detail.ts", exportName: "ticketDetail" },
		},
	});
});

test("rejects a non-true nested inverse child Field selection", async () => {
	const nonTrueNestedField = accepted.replace(
		"ticket: { select: { id: true } }",
		"ticket: { select: { id: false as any } }",
	);
	await expect(evaluate(source(nonTrueNestedField))).rejects.toMatchObject({
		code: "QP-DATA-026",
		details: {
			path: "comments.ticket.id",
			origin: { path: "ticket detail.ts", exportName: "ticketDetail" },
		},
	});
});

test("rejects the fifth selected Relation edge", async () => {
	await expect(evaluate(source(recursiveToOne))).rejects.toMatchObject({
		code: "QP-DATA-022",
		details: { path: "comments.ticket.team.organization.region" },
	});
});
