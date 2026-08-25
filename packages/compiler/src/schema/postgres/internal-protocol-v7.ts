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
	internalProtocolV7Columns,
	internalProtocolV7Constraints,
	internalProtocolV7Indexes,
	internalProtocolV7Tables,
} from "./internal-protocol-v7-catalog";
import { internalProtocolV7Sql } from "./internal-protocol-v7-sql";
import { fail } from "./shared";

const internalProtocolV7Checksum = createHash("sha256")
	.update("questpie-internal-protocol-v7\0")
	.update(internalProtocolV6Checksum)
	.update("\0")
	.update(internalProtocolV7Sql)
	.digest("hex");

const internalProtocolV7Catalog: InternalProtocolCatalog = Object.freeze({
	tables: Object.freeze([...internalProtocolV7Tables]),
	columns: Object.freeze([...internalProtocolV7Columns]),
	constraints: Object.freeze([...internalProtocolV7Constraints]),
	indexes: Object.freeze([...internalProtocolV7Indexes]),
});

export type ProtocolV7Cutover = Readonly<{
	allowNonRollingProtocolV7?: boolean;
}>;

export function assertProtocolV7Cutover(
	protocol: Readonly<{ version: number; checksum: string }> | undefined,
	cutover: ProtocolV7Cutover,
): void {
	if (
		protocol !== undefined &&
		protocol.version !== 7 &&
		cutover.allowNonRollingProtocolV7 !== true
	)
		fail(
			"QP-SCHEMA-020",
			"destructiveAcknowledgementRequired",
			"protocol v7 is a non-rolling upgrade; stop every v6 Runtime and explicitly allow the cutover before migration",
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

export async function verifyInternalProtocolV7(sql: SQL): Promise<void> {
	const protocol = await protocolRow(sql);
	if (
		protocol?.version !== 7 ||
		protocol.checksum !== internalProtocolV7Checksum
	)
		return fail(
			"QP-SCHEMA-023",
			"checksumMismatch",
			"questpie_internal protocol v7 is not installed",
		);
	await verifyInternalProtocolCatalog(sql, internalProtocolV7Catalog, protocol);
}

export async function ensureInternalProtocolV7(
	sql: SQL,
	databaseName: string,
	expectedPid: number,
	control: PostgresControl,
	cutover: ProtocolV7Cutover = {},
	signal?: AbortSignal,
): Promise<void> {
	await assertBackendPid(sql, expectedPid, "before internal protocol v7");
	const protocolBefore = await protocolRowBeforeCutover(sql);
	assertProtocolV7Cutover(protocolBefore, cutover);
	if (protocolBefore?.version !== 7)
		await ensureInternalProtocolV6(
			sql,
			databaseName,
			expectedPid,
			control,
			signal,
		);
	const key = lockKey(databaseName, "questpie.internal-protocol");
	await acquireSessionLock(sql, key, control, signal);
	try {
		const protocol = await protocolRow(sql);
		if (
			protocol?.version === 7 &&
			protocol.checksum === internalProtocolV7Checksum
		) {
			await verifyInternalProtocolV7(sql);
			return;
		}
		if (
			protocol?.version !== 6 ||
			protocol.checksum !== internalProtocolV6Checksum
		)
			return fail(
				"QP-SCHEMA-023",
				"checksumMismatch",
				"questpie.internal protocol is missing, changed, or unsupported",
			);
		await withPinnedTransaction(
			sql,
			expectedPid,
			"internal protocol v7 upgrade",
			signal,
			async (transaction) => {
				await verifyInternalProtocolCatalog(
					transaction,
					internalProtocolV6Catalog,
					protocol,
				);
				await transaction.unsafe(internalProtocolV7Sql);
				await transaction`
          update questpie_internal.protocol set version = 7, checksum = ${internalProtocolV7Checksum}
          where singleton = true
        `;
				await verifyInternalProtocolV7(transaction);
			},
		);
	} finally {
		await assertBackendPid(sql, expectedPid, "internal protocol v7 unlock");
		await sql`select pg_catalog.pg_advisory_unlock(${key})`;
	}
}

export {
	internalProtocolV7Catalog,
	internalProtocolV7Checksum,
	internalProtocolV7Sql,
};
