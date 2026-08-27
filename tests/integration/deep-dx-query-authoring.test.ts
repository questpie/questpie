import { expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

const fixtureRoot = resolve(
	import.meta.dir,
	"../../fixtures/team-support-desk",
);

test("compiles one Collection-owned handlerless Query into the generated app and client", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "questpie-deep-dx-query-"));
	try {
		await cp(fixtureRoot, temporary, { recursive: true });
		await rm(join(temporary, "node_modules"), { force: true, recursive: true });
		await symlink(
			resolve(fixtureRoot, "node_modules"),
			join(temporary, "node_modules"),
		);
		const compilation = await compileApplication({
			applicationRoot: temporary,
		});

		const generatedApp = compilation.generatedFiles["app.ts"] ?? "";
		expect(generatedApp).toContain(
			'"tickets.queue": Readonly<{ input: Readonly<{ readonly "after": string | null; readonly "first": number; readonly "statuses": ReadonlyArray<string> | null; readonly "teamIds": ReadonlyArray<string> | null; }>;',
		);
		expect(generatedApp).toContain(
			'readonly "team": Readonly<{ readonly "id": string; readonly "name": string; readonly "organization": Readonly<{ readonly "id": string; readonly "name": string; }> | null; readonly "routingStatus": string; }> | null;',
		);
		expect(generatedApp).toContain(
			'readonly "assignee": Readonly<{ readonly "id": string; readonly "principalId": string; readonly "role": string; }> | null;',
		);
		expect(compilation.generatedFiles["app.ts"]).toContain(
			"queries: GeneratedQueryOperations",
		);
		expect(compilation.generatedFiles["app.ts"]).toContain(
			"invocation.ctx.data.run(definition.query as never, invocation.input as never) as never",
		);
		expect(compilation.generatedFiles["client.ts"]).toContain(
			'"tickets.queue"',
		);
		for (const deleted of [
			'"tickets.list"',
			'"tickets.listByStatus"',
			'"tickets.listByTeam"',
			'"tickets.listByStatusAndTeam"',
		]) {
			expect(generatedApp).not.toContain(deleted);
			expect(compilation.generatedFiles["client.ts"]).not.toContain(deleted);
		}
		const queryProjection = JSON.parse(
			compilation.generatedFiles["query-projection.json"] ?? "null",
		) as Readonly<{ queries: readonly Readonly<Record<string, unknown>>[] }>;
		const queue = queryProjection.queries.find(
			(query) => query.identity === "query:tickets.queue",
		);
		expect(queue).toMatchObject({
			identity: "query:tickets.queue",
			template: { from: "collection:tickets" },
		});
		const postgresPlans = JSON.parse(
			compilation.generatedFiles["postgres-query-plans.json"] ?? "null",
		) as Readonly<{
			plans: readonly Readonly<{ queryDigest: string; sql: string }>[];
		}>;
		expect(
			postgresPlans.plans.find((plan) => plan.queryDigest === queue?.digest)
				?.sql,
		).toContain("IS NULL) OR");
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
});

test("rejects Policy evidence from a structural Query before artifact emission", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "questpie-deep-dx-query-"));
	try {
		await cp(fixtureRoot, temporary, { recursive: true });
		await rm(join(temporary, "node_modules"), { force: true, recursive: true });
		await symlink(
			resolve(fixtureRoot, "node_modules"),
			join(temporary, "node_modules"),
		);
		const queries = join(temporary, "src/tickets/queries.ts");
		const source = await readFile(queries, "utf8");
		await writeFile(
			queries,
			source.replace(
				/where: \(\{ row, parameters \}\) =>\n\s+expr\.and\(\n\s+row\.status\.in\(parameters\.statuses\),\n\s+row\.teamId\.in\(parameters\.teamIds\),\n\s+\),/,
				'where: ({ row }) => expr.exists(tickets, ({ row: evidence }) => evidence.id.equal(row.id)),',
			),
		);

		await expect(
			compileApplication({ applicationRoot: temporary }),
		).rejects.toMatchObject({
			code: "QP-DATA-025",
			diagnosticClass: "unsupportedExpressionCapability",
		});
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
});
