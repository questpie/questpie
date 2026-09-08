import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { compileApplication } from "../../../../packages/compiler/src/index";

test("compiled Support Desk binds root paging to tickets.queue but not its detail handler", async () => {
	const temporary = await mkdtemp(
		join(tmpdir(), "questpie-pagination-source-"),
	);
	try {
		const compiled = await compileApplication({
			applicationRoot: resolve(
				import.meta.dir,
				"../../../../fixtures/team-support-desk",
			),
			outputDirectory: join(temporary, "generated"),
		});
		const projection = JSON.parse(
			compiled.generatedFiles["query-projection.json"]!,
		);
		const operations = JSON.parse(
			compiled.generatedFiles["operation-contracts.json"]!,
		);
		const queue = projection.queries.find(
			(query: { identity: string | null }) =>
				query.identity === "query:tickets.queue",
		);
		expect(queue.template.page).toMatchObject({
			kind: "forwardCursor",
			first: { kind: "parameter", parameter: "first" },
			after: { kind: "parameter", parameter: "after" },
		});
		expect(queue.template.parameters).toContainEqual({
			name: "after",
			kind: "cursor",
			nullable: true,
		});
		const operation = operations.operations.find(
			(entry: { identity: string }) => entry.identity === queue.identity,
		);
		expect(operation.input.properties.after).toEqual({
			kind: "nullable",
			codec: { kind: "cursor" },
		});
		expect(operation.output.properties.pageInfo).toEqual({
			kind: "object",
			properties: {
				hasNextPage: { kind: "boolean" },
				endCursor: { kind: "nullable", codec: { kind: "text" } },
			},
		});
		expect(
			projection.queries.find(
				(query: { identity: string | null }) =>
					query.identity === "query:tickets.detail",
			),
		).toBeUndefined();
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}, 60_000);
