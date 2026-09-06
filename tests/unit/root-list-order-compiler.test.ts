import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { evaluateModules } from "../../packages/compiler/src/discovery";
import { normalizeDataQueryTemplate } from "../../packages/compiler/src/relational";

async function evaluate(selected: boolean) {
	const root = await mkdtemp(join(tmpdir(), "questpie-root-list-order-"));
	try {
		const module = join(root, "due-tickets.ts");
		await writeFile(
			module,
			`import { codec, constraint, defineCollection, field } from "questpie";
export const tickets = defineCollection({
  name: "tickets",
  fields: { id: field.uuid({ nullable: false }), due: field.timestamp({ nullable: true }) },
  constraints: { primary: constraint.primaryKey({ fields: ["id"] }) },
  relations: {},
});
export const dueTickets = tickets.list({
  parameters: { first: codec.integer({ minimum: 1, maximum: 1 }), after: codec.nullable(codec.cursor()) },
  where: ({ row }) => row.id.equal("00000000-0000-0000-0000-000000000000"),
  orderBy: { due: { direction: "asc", nulls: "last" }, id: "asc" },
  select: { id: true${selected ? ", due: true" : ""} },
  page: ({ parameters }) => ({ first: parameters.first, after: parameters.after }),
});`,
		);
		const values = await evaluateModules({
			applicationRoot: root,
			files: [module],
			frameworkEntry: resolve(
				import.meta.dir,
				"../../packages/questpie/src/index.ts",
			),
			packages: new Map(),
		});
		const value = values.find((value) => value.exportName === "dueTickets")!;
		return normalizeDataQueryTemplate(
			value.value.templateInput,
			{
				schemaProjectionDigest: "a".repeat(64),
				dataContractProjectionDigest: "b".repeat(64),
			},
			{ path: "due-tickets.ts", exportName: "dueTickets" },
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

test("root cursor list rejects an unselected order Field with its source Origin", async () => {
	await expect(evaluate(false)).rejects.toMatchObject({
		code: "QP-DATA-008",
		diagnosticClass: "orderFieldNotSelected",
		details: {
			path: "due",
			origin: { path: "due-tickets.ts", exportName: "dueTickets" },
		},
	});
});

test("root cursor list accepts its directly selected nullable order Field", async () => {
	expect(await evaluate(true)).toMatchObject({
		format: "questpie.data-query-template",
		version: 1,
	});
});
