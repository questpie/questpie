import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
import {
	ensureInternalProtocolV6,
	internalProtocolV6Checksum,
	verifyInternalProtocolV6,
} from "../../../packages/compiler/src/schema/postgres/internal-protocol-v6";

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

async function catalogTool(...cliArguments: string[]): Promise<string> {
	const child = Bun.spawn(
		["bun", "run", "scripts/internal-protocol-catalog.ts", ...cliArguments],
		{ stdout: "pipe", stderr: "pipe" },
	);
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	expect(stderr).toBe("");
	expect(exitCode).toBe(0);
	return stdout;
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

	test("the live v4-to-v5 delta reproduces the committed catalog module", async () => {
		const directory = await mkdtemp(join(tmpdir(), "questpie-v5-catalog-"));
		const base = join(directory, "v4.json");
		const session = await database!.reserve();
		try {
			const identity = await connectionIdentity(session);
			await ensureInternalProtocolV4(
				session,
				identity.databaseName,
				identity.pid,
				control,
			);
			await catalogTool("--snapshot", base);
			await ensureInternalProtocolV5(
				session,
				identity.databaseName,
				identity.pid,
				control,
			);
			expect(
				await catalogTool("--emit", "5", "--base", base, "--check"),
			).toContain("catalog v5 reproduces the committed module exactly");
		} finally {
			session.release();
			await rm(directory, { recursive: true, force: true });
		}
	});
});

describe.skipIf(!database)("PB-05 questpie_internal protocol v6", () => {
	test("a live v5 database converges on the verified retry-event catalog", async () => {
		const session = await database!.reserve();
		try {
			const identity = await connectionIdentity(session);
			await ensureInternalProtocolV5(
				session,
				identity.databaseName,
				identity.pid,
				control,
			);
			await ensureInternalProtocolV6(
				session,
				identity.databaseName,
				identity.pid,
				control,
			);
			await verifyInternalProtocolV6(session);
			const [protocol] = await session<
				Readonly<Array<{ version: number; checksum: string }>>
			>`select version, checksum from questpie_internal.protocol where singleton = true`;
			expect(protocol).toEqual({
				version: 6,
				checksum: internalProtocolV6Checksum,
			});
			const [constraint] = await session<
				Readonly<Array<{ definition: string }>>
			>`select pg_catalog.pg_get_constraintdef(oid, true) as definition
from pg_catalog.pg_constraint
where conname = 'durable_event_kind_known'`;
			expect(constraint?.definition).toContain("retryRequested");
		} finally {
			session.release();
		}
	});

	test("same-version checksum and catalog tampering are both refused", async () => {
		const session = await database!.reserve();
		try {
			const identity = await connectionIdentity(session);
			await ensureInternalProtocolV6(
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
				ensureInternalProtocolV6(
					session,
					identity.databaseName,
					identity.pid,
					control,
				),
			).rejects.toMatchObject({ code: "QP-SCHEMA-023" });

			await session`
				update questpie_internal.protocol
				set checksum = ${internalProtocolV6Checksum}
				where singleton = true
			`;
			await session.unsafe(
				"ALTER TABLE questpie_internal.durable_run_events DROP CONSTRAINT durable_event_kind_known",
			);
			await expect(verifyInternalProtocolV6(session)).rejects.toMatchObject({
				code: "QP-SCHEMA-023",
			});
		} finally {
			session.release();
		}
	});

	test("the live v5-to-v6 delta reproduces the committed catalog module", async () => {
		const directory = await mkdtemp(join(tmpdir(), "questpie-v6-catalog-"));
		const base = join(directory, "v5.json");
		const session = await database!.reserve();
		try {
			const identity = await connectionIdentity(session);
			await ensureInternalProtocolV5(
				session,
				identity.databaseName,
				identity.pid,
				control,
			);
			await catalogTool("--snapshot", base);
			await ensureInternalProtocolV6(
				session,
				identity.databaseName,
				identity.pid,
				control,
			);
			expect(
				await catalogTool("--emit", "6", "--base", base, "--check"),
			).toContain("catalog v6 reproduces the committed module exactly");
		} finally {
			session.release();
			await rm(directory, { recursive: true, force: true });
		}
	});
});
