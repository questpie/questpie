import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { CompilerDiagnosticError } from "../../packages/compiler/src/diagnostic";
import { evaluateModules } from "../../packages/compiler/src/discovery";

const frameworkEntry = resolve(
	import.meta.dir,
	"../../packages/questpie/src/index.ts",
);

function source(child: string, second = "", conditionalOrder = false): string {
	return `import { codec, constraint, defineCollection, definePolicy, expr, field, policy, relation, relationRef } from "questpie";
export const regions = defineCollection({ name: "regions", fields: { id: field.uuid({ nullable: false }) }, constraints: { primary: constraint.primaryKey({ fields: ["id"] }) }, relations: {} });
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
${conditionalOrder ? 'export const commentPolicy = definePolicy(comments, { name: "comments.default", read: { admit: policy.public(), rows: () => expr.always() }, fields: { output: ({ row }) => ({ id: row.id.equal(row.id) }) } });' : ""}
const child = ${child};
export const ticketDetail = tickets.list({
  parameters: { first: codec.integer({ minimum: 1, maximum: 100 }), after: codec.nullable(codec.cursor()) },
  where: ({ row }) => row.id.equal("00000000-0000-0000-0000-000000000000"),
  orderBy: { id: "asc" }, select: { id: true, comments: child${second} },
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

test.each([
	[
		accepted.replace("first: 10", "first: Number('51')"),
		"QP-DATA-026",
		"comments",
	],
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

test("rejects the fifth selected Relation edge", async () => {
	const fifth = accepted.replace(
		"ticket: { select: { id: true } }",
		"ticket: { select: { id: true, team: { select: { id: true, organization: { select: { id: true, region: { select: { id: true } } } } } } } }",
	);
	await expect(evaluate(source(fifth))).rejects.toMatchObject({
		code: "QP-DATA-022",
		details: { path: "comments.ticket.team.organization.region" },
	});
});
