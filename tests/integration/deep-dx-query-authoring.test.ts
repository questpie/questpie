import { expect, test } from "bun:test";
import { cp, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

const repositoryRoot = resolve(import.meta.dir, "../..");
const fixtureRoot = resolve(import.meta.dir, "../../fixtures/team-support-desk");

test("compiles one Collection-owned handlerless Query into the generated app and client", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "questpie-deep-dx-query-"));
	try {
		await cp(fixtureRoot, temporary, { recursive: true });
		await symlink(resolve(repositoryRoot, "node_modules"), join(temporary, "node_modules"));
		await writeFile(
			join(temporary, "src/tickets/deep-dx-query.ts"),
			`import { codec, expr, policy } from "questpie";

import { defineQuery } from "#questpie/app";

import { tickets } from "../tickets";

export const ticketQueue = defineQuery({
	name: "tickets.queue",
	network: true,
	policy: policy.authenticated(),
	query: tickets.list({
		parameters: {
			statuses: codec.nullable(codec.list(codec.text(), { maximum: 8 })),
			teamIds: codec.nullable(codec.list(codec.uuid(), { maximum: 16 })),
			first: codec.integer({ minimum: 1, maximum: 100 }),
			after: codec.nullable(codec.cursor()),
		},
		where: ({ row, parameters }) =>
			expr.and(
				row.status.in(parameters.statuses),
				row.teamId.in(parameters.teamIds),
			),
		orderBy: {
			updatedAt: { direction: "desc", nulls: "last" },
			id: "desc",
		},
		select: {
			id: true,
			status: true,
			teamId: true,
			updatedAt: true,
		},
		page: ({ parameters }) => ({
			first: parameters.first,
			after: parameters.after,
		}),
	}),
});
`,
		);

		const compilation = await compileApplication({
			applicationRoot: temporary,
		});

		expect(compilation.generatedFiles["app.ts"]).toContain(
			'"tickets.queue": Readonly<{ input: Readonly<{ "after": string | null; "first": number; "statuses": string[] | null; "teamIds": string[] | null; }>; output: Readonly<{ nodes: Array<{ "id": string; "status": string; "teamId": string; "updatedAt": Date; }>; pageInfo: Readonly<{ endCursor: string | null; hasNextPage: boolean; }>; }>; }>',
		);
		expect(compilation.generatedFiles["app.ts"]).toContain(
			'queries: GeneratedQueryOperations',
		);
		expect(compilation.generatedFiles["client.ts"]).toContain(
			'"tickets.queue"',
		);
		expect(compilation.artifacts.query).toMatchObject({
			queries: [
				{
					identity: "query:tickets.queue",
					template: { from: "collection:tickets" },
				},
			],
		});
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
});
