import { createHash } from "node:crypto";

import type { SQL } from "bun";

import {
	acquireSessionLock,
	assertBackendPid,
	lockKey,
	withPinnedTransaction,
} from "../../postgres-session";
import type { PostgresControl } from "../../postgres-session";
import type { InternalProtocolCatalog } from "./bootstrap";
import { verifyInternalProtocolCatalog } from "./bootstrap";
import {
	ensureInternalProtocolV6,
	internalProtocolV6Catalog,
	internalProtocolV6Checksum,
} from "./internal-protocol-v6";
import {
	internalProtocolV7Catalog,
	internalProtocolV7Checksum,
	internalProtocolV7Sql,
} from "./internal-protocol-v7";
import {
	internalProtocolV8Columns,
	internalProtocolV8Constraints,
	internalProtocolV8Indexes,
	internalProtocolV8Tables,
} from "./internal-protocol-v8-catalog";
import { internalProtocolV8Sql } from "./internal-protocol-v8-sql";
import { fail } from "./shared";

const internalProtocolV8Checksum = createHash("sha256")
	.update("questpie-internal-protocol-v8\0")
	.update(internalProtocolV7Checksum)
	.update("\0")
	.update(internalProtocolV8Sql)
	.digest("hex");

const internalProtocolV8Catalog: InternalProtocolCatalog = Object.freeze({
	tables: internalProtocolV8Tables,
	columns: internalProtocolV8Columns,
	constraints: internalProtocolV8Constraints,
	indexes: internalProtocolV8Indexes,
});

export type ProtocolV8Cutover = Readonly<{
	allowNonRollingProtocolV8?: boolean;
}>;

export function assertProtocolV8Cutover(
	protocol: Readonly<{ version: number; checksum: string }> | undefined,
	cutover: ProtocolV8Cutover,
): void {
	if (
		protocol !== undefined &&
		protocol.version !== 8 &&
		cutover.allowNonRollingProtocolV8 !== true
	)
		fail(
			"QP-SCHEMA-020",
			"destructiveAcknowledgementRequired",
			"protocol v8 is a non-rolling upgrade; stop every v7 Runtime and explicitly allow the cutover before migration",
		);
}

async function protocolRow(
	sql: SQL,
): Promise<Readonly<{ version: number; checksum: string }> | undefined> {
	const [protocol] = await sql<{ version: number; checksum: string }[]>`
    select version, checksum from questpie_internal.protocol where singleton = true
  `;
	return protocol;
}

function isMissingProtocolRelation(error: unknown): boolean {
	if (typeof error !== "object" || error === null) return false;
	const postgresError = error as { code?: unknown; errno?: unknown };
	return postgresError.code === "42P01" || postgresError.errno === "42P01";
}

async function protocolRowBeforeCutover(
	sql: SQL,
): Promise<Readonly<{ version: number; checksum: string }> | undefined> {
	try {
		return await protocolRow(sql);
	} catch (error) {
		if (isMissingProtocolRelation(error)) return undefined;
		throw error;
	}
}

export async function verifyInternalProtocolV8(sql: SQL): Promise<void> {
	const protocol = await protocolRow(sql);
	if (
		protocol?.version !== 8 ||
		protocol.checksum !== internalProtocolV8Checksum
	)
		return fail(
			"QP-SCHEMA-023",
			"checksumMismatch",
			"questpie_internal protocol v8 is not installed",
		);
	await verifyInternalProtocolCatalog(sql, internalProtocolV8Catalog, protocol);
}

export async function ensureInternalProtocolV8(
	sql: SQL,
	databaseName: string,
	expectedPid: number,
	control: PostgresControl,
	cutover: ProtocolV8Cutover = {},
	signal?: AbortSignal,
): Promise<void> {
	await assertBackendPid(sql, expectedPid, "before internal protocol v8");
	const protocolBefore = await protocolRowBeforeCutover(sql);
	assertProtocolV8Cutover(protocolBefore, cutover);
	const key = lockKey(databaseName, "questpie.internal-protocol");
	await acquireSessionLock(sql, key, control, signal);
	try {
		let protocol = await protocolRowBeforeCutover(sql);
		if (
			protocol?.version === 8 &&
			protocol.checksum === internalProtocolV8Checksum
		) {
			await verifyInternalProtocolV8(sql);
			return;
		}
		if (protocol === undefined) {
			await ensureInternalProtocolV6(
				sql,
				databaseName,
				expectedPid,
				control,
				signal,
			);
			protocol = await protocolRow(sql);
		}
		if (
			(protocol?.version !== 6 ||
				protocol.checksum !== internalProtocolV6Checksum) &&
			(protocol?.version !== 7 ||
				protocol.checksum !== internalProtocolV7Checksum)
		)
			return fail(
				"QP-SCHEMA-023",
				"checksumMismatch",
				"protocol v8 installation requires an exact v6 bootstrap or v7 cutover",
			);
		await withPinnedTransaction(
			sql,
			expectedPid,
			"internal protocol v8 upgrade",
			signal,
			async (transaction) => {
				if (protocol.version === 6) {
					await verifyInternalProtocolCatalog(
						transaction,
						internalProtocolV6Catalog,
						protocol,
					);
					await transaction.unsafe(internalProtocolV7Sql);
				} else {
					await verifyInternalProtocolCatalog(
						transaction,
						internalProtocolV7Catalog,
						protocol,
					);
				}
				await transaction.unsafe(internalProtocolV8Sql);
				await transaction`
          update questpie_internal.protocol set version = 8, checksum = ${internalProtocolV8Checksum}
          where singleton = true
        `;
				await verifyInternalProtocolV8(transaction);
			},
		);
	} finally {
		await assertBackendPid(sql, expectedPid, "internal protocol v8 unlock");
		await sql`select pg_catalog.pg_advisory_unlock(${key})`;
	}
}

export {
	internalProtocolV8Catalog,
	internalProtocolV8Checksum,
	internalProtocolV8Sql,
};
