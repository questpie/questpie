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

test("a concurrent claim serialization loser is a skipped claim, not a failed worker poll", async () => {
	const sql = {
		begin() {
			return Promise.reject(
				Object.assign(new Error("serialization loser"), {
					errno: "40001",
				}),
			);
		},
	};
	const kernel = createPostgresDurableKernel({
		sql: sql as never,
		application: "application:collaboration",
		reactions: { members: new Map(), byIdentity: new Map() } as never,
	});

	await expect(
		kernel.claim({
			runId: "00000000-0000-4000-a000-000000000001",
			workerId: "worker:serialization-loser",
		}),
	).resolves.toEqual({ status: "skipped" });
});

test("a concurrent cancellation reap serialization loser leaves work for the next poll", async () => {
	const sql = {
		begin() {
			return Promise.reject(
				Object.assign(new Error("serialization loser"), {
					errno: "40001",
				}),
			);
		},
	};
	const kernel = createPostgresDurableKernel({
		sql: sql as never,
		application: "application:collaboration",
		reactions: { members: new Map(), byIdentity: new Map() } as never,
	});

	await expect(kernel.reapCancelled()).resolves.toBe(0);
});
