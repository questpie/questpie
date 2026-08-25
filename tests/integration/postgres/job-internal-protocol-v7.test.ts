import { afterAll, beforeEach, describe, expect, test } from "bun:test";

import { SQL } from "bun";

import { backendPid } from "../../../packages/compiler/src/postgres-session";
import {
	ensureInternalProtocolV7,
	internalProtocolV7Checksum,
	verifyInternalProtocolV7,
} from "../../../packages/compiler/src/schema/postgres/internal-protocol-v7";

const database = process.env.PGHOST ? new SQL({ max: 2 }) : undefined;
const control = { lockTimeoutMs: 5_000, statementTimeoutMs: 30_000 } as const;

beforeEach(async () => {
	await database?.unsafe("DROP SCHEMA IF EXISTS questpie_internal CASCADE");
});

afterAll(async () => {
	await database?.unsafe("DROP SCHEMA IF EXISTS questpie_internal CASCADE");
	await database?.close();
});

describe.skipIf(!database)("Job internal protocol v7", () => {
	test("generalizes durable dispatch identity and pins run semantic version", async () => {
		const session = await database!.reserve();
		try {
			const [current] = await session<{ databaseName: string }[]>`
				select current_database() as "databaseName"
			`;
			await ensureInternalProtocolV7(
				session,
				current!.databaseName,
				await backendPid(session),
				control,
			);
			await verifyInternalProtocolV7(session);

			const [protocol] = await session<
				Readonly<Array<{ version: number; checksum: string }>>
			>`select version, checksum from questpie_internal.protocol where singleton = true`;
			expect(protocol).toEqual({
				version: 7,
				checksum: internalProtocolV7Checksum,
			});
			const columns = await session<
				Readonly<Array<{ table: string; column: string }>>
			>`
				select table_name as table, column_name as column
				from information_schema.columns
				where table_schema = 'questpie_internal'
				  and ((table_name = 'durable_dispatches' and column_name in ('resource_kind', 'resource_identity'))
				    or (table_name = 'durable_runs' and column_name = 'semantic_version'))
				order by table_name, column_name
			`;
			expect(columns).toEqual([
				{ table: "durable_dispatches", column: "resource_identity" },
				{ table: "durable_dispatches", column: "resource_kind" },
				{ table: "durable_runs", column: "semantic_version" },
			]);
			const [legacy] = await session<{ exists: boolean }[]>`
				select to_regclass('questpie_internal.pending_reaction_intents') is not null as exists
			`;
			expect(legacy!.exists).toBe(false);
		} finally {
			session.release();
		}
	});
});
