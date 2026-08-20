import { expect, test } from "bun:test";

import { createPostgresDurableKernel } from "../../packages/runtime/src/index";

test("durable admission is fair across tenants and hides incompatible work before the batch limit", async () => {
	const statements: ReadonlyArray<{
		statement: string;
		parameters: readonly unknown[];
	}> = [];
	const executableDigest = "1".repeat(64);
	const sql = {
		unsafe(statement: string, parameters: readonly unknown[] = []) {
			(statements as Array<(typeof statements)[number]>).push({
				statement,
				parameters,
			});
			return Promise.resolve([]);
		},
	};
	const reactions = {
		members: new Map(),
		byIdentity: new Map([
			["reaction:message.published", { contractDigest: executableDigest }],
		]),
	};
	const kernel = createPostgresDurableKernel({
		sql: sql as never,
		application: "application:collaboration",
		reactions: reactions as never,
	});

	await kernel.admit(10);

	expect(statements).toHaveLength(1);
	const admission = statements[0]!;
	expect(admission.statement).toContain(
		"row_number() OVER (PARTITION BY tenant_id ORDER BY available_at, run_id)",
	);
	expect(admission.statement).toContain(
		"SELECT pg_catalog.jsonb_array_elements_text(($2::text)::jsonb)",
	);
	expect(admission.statement).toContain(
		"ORDER BY tenant_turn, available_at, run_id",
	);
	expect(admission.parameters).toEqual([
		"application:collaboration",
		JSON.stringify([executableDigest]),
		10,
	]);
});
