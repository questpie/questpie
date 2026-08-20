import { afterAll, beforeEach, describe, expect, test } from "bun:test";

import { SQL } from "bun";

import { backendPid } from "../../../packages/compiler/src/postgres-session";
import {
	ensureInternalProtocolV4,
	internalProtocolV4Checksum,
} from "../../../packages/compiler/src/schema/postgres/internal-protocol-v4";
import {
	ensureInternalProtocolV5,
	internalProtocolV5Checksum,
	verifyInternalProtocolV5,
} from "../../../packages/compiler/src/schema/postgres/internal-protocol-v5";

const database = process.env.PGHOST ? new SQL({ max: 2 }) : undefined;
const control = { lockTimeoutMs: 5_000, statementTimeoutMs: 30_000 } as const;

async function connectionIdentity(
	sql: SQL,
): Promise<Readonly<{ databaseName: string; pid: number }>> {
	const [current] = await sql<{ databaseName: string }[]>`
		select current_database() as "databaseName"
	`;
	return { databaseName: current!.databaseName, pid: await backendPid(sql) };
}

beforeEach(async () => {
	await database?.unsafe("DROP SCHEMA IF EXISTS questpie_internal CASCADE");
});

afterAll(async () => {
	await database?.unsafe("DROP SCHEMA IF EXISTS questpie_internal CASCADE");
	await database?.close();
});

describe.skipIf(!database)("BETA-09 questpie_internal protocol v5", () => {
	test("fresh install and v4 upgrade converge on the verified v5 catalog", async () => {
		const session = await database!.reserve();
		try {
			const identity = await connectionIdentity(session);
			await ensureInternalProtocolV5(
				session,
				identity.databaseName,
				identity.pid,
				control,
			);
			await verifyInternalProtocolV5(session);
			const [fresh] = await session<
				Readonly<Array<{ version: number; checksum: string }>>
			>`select version, checksum from questpie_internal.protocol where singleton = true`;
			expect(fresh).toEqual({
				version: 5,
				checksum: internalProtocolV5Checksum,
			});

			await session.unsafe("DROP SCHEMA questpie_internal CASCADE");
			await ensureInternalProtocolV4(
				session,
				identity.databaseName,
				identity.pid,
				control,
			);
			const [before] = await session<
				Readonly<Array<{ version: number; checksum: string }>>
			>`select version, checksum from questpie_internal.protocol where singleton = true`;
			expect(before).toEqual({
				version: 4,
				checksum: internalProtocolV4Checksum,
			});

			await ensureInternalProtocolV5(
				session,
				identity.databaseName,
				identity.pid,
				control,
			);
			await verifyInternalProtocolV5(session);
		} finally {
			session.release();
		}
	});

	test("same-version catalog drift is refused by checksum", async () => {
		const session = await database!.reserve();
		try {
			const identity = await connectionIdentity(session);
			await ensureInternalProtocolV5(
				session,
				identity.databaseName,
				identity.pid,
				control,
			);
			await session`
				update questpie_internal.protocol
				set checksum = ${"0".repeat(64)}
				where singleton = true
			`;

			await expect(
				ensureInternalProtocolV5(
					session,
					identity.databaseName,
					identity.pid,
					control,
				),
			).rejects.toMatchObject({
				code: "QP-SCHEMA-023",
				diagnosticClass: "checksumMismatch",
			});
		} finally {
			session.release();
		}
	});
});
