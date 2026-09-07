import { createHash } from "node:crypto";

import type { SQL } from "bun";

import {
	acquireSessionLock,
	assertBackendPid,
	lockKey,
	withPinnedTransaction,
	type PostgresControl,
} from "../../postgres-session";
import {
	verifyInternalProtocolCatalog,
	type InternalProtocolCatalog,
} from "./bootstrap";
import {
	ensureInternalProtocolV8,
	internalProtocolV8Catalog,
	internalProtocolV8Checksum,
} from "./internal-protocol-v8";
import { internalProtocolV9CheckpointSql } from "./internal-protocol-v9-checkpoint-sql";
import { internalProtocolV9Columns } from "./internal-protocol-v9-columns";
import { internalProtocolV9Constraints } from "./internal-protocol-v9-constraints";
import { internalProtocolV9Indexes } from "./internal-protocol-v9-indexes";
import { internalProtocolV9ScheduleSql } from "./internal-protocol-v9-schedule-sql";
import { fail } from "./shared";

export const internalProtocolV9Sql =
	internalProtocolV9ScheduleSql + internalProtocolV9CheckpointSql;
export const internalProtocolV9Checksum = createHash("sha256")
	.update("questpie-internal-protocol-v9\0")
	.update(internalProtocolV8Checksum)
	.update("\0")
	.update(internalProtocolV9Sql)
	.digest("hex");
const compare = (a: readonly unknown[], b: readonly unknown[]) => {
	const left = `${String(a[0])}\0${String(a[1])}`;
	const right = `${String(b[0])}\0${String(b[1])}`;
	return left < right ? -1 : left > right ? 1 : 0;
};
export const internalProtocolV9Catalog: InternalProtocolCatalog = Object.freeze(
	{
		tables: Object.freeze(
			[
				...internalProtocolV8Catalog.tables,
				"mutation_checkpoints",
				"schedule_activations",
				"schedule_catalogs",
				"schedule_frontiers",
				"schedule_heads",
				"schedule_ticks",
			].sort(),
		),
		columns: Object.freeze(
			[...internalProtocolV8Catalog.columns, ...internalProtocolV9Columns].sort(
				(a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
			),
		),
		constraints: Object.freeze(
			[
				...internalProtocolV8Catalog.constraints.filter(
					(row) =>
						row[1] !== "durable_run_failure_code_known" &&
						row[1] !== "durable_event_error_code_known",
				),
				...internalProtocolV9Constraints,
			].sort(compare),
		),
		indexes: Object.freeze(
			[...internalProtocolV8Catalog.indexes, ...internalProtocolV9Indexes].sort(
				compare,
			),
		),
	},
);

async function protocolRow(
	sql: SQL,
): Promise<Readonly<{ version: number; checksum: string }> | undefined> {
	try {
		const [row] = await sql<
			{ version: number; checksum: string }[]
		>`SELECT version, checksum FROM questpie_internal.protocol WHERE singleton = true`;
		return row;
	} catch (error) {
		if (
			typeof error === "object" &&
			error !== null &&
			((error as { code?: string }).code === "42P01" ||
				(error as { errno?: string }).errno === "42P01")
		)
			return undefined;
		throw error;
	}
}

export async function verifyInternalProtocolV9(sql: SQL): Promise<void> {
	const row = await protocolRow(sql);
	if (row?.version !== 9 || row.checksum !== internalProtocolV9Checksum)
		return fail(
			"QP-SCHEMA-023",
			"checksumMismatch",
			"questpie_internal protocol v9 is not installed",
		);
	await verifyInternalProtocolCatalog(sql, internalProtocolV9Catalog, row);
}

/** Candidate v9 is explicit, non-rolling, and catalog-verified before and after installation. */
export async function ensureInternalProtocolV9(
	sql: SQL,
	databaseName: string,
	expectedPid: number,
	control: PostgresControl,
	cutover: Readonly<{
		allowNonRollingProtocolV8?: boolean;
		allowNonRollingProtocolV9?: boolean;
	}> = {},
	signal?: AbortSignal,
): Promise<void> {
	await assertBackendPid(sql, expectedPid, "before internal protocol v9");
	const assertCutover = (
		protocol: Readonly<{ version: number }> | undefined,
	) => {
		if (
			protocol &&
			protocol.version !== 9 &&
			cutover.allowNonRollingProtocolV9 !== true
		)
			fail(
				"QP-SCHEMA-020",
				"destructiveAcknowledgementRequired",
				"protocol v9 requires an explicitly acknowledged non-rolling cutover",
			);
	};
	assertCutover(await protocolRow(sql));
	const key = lockKey(databaseName, "questpie.internal-protocol");
	await acquireSessionLock(sql, key, control, signal);
	try {
		let protocol = await protocolRow(sql);
		// Another installer may have committed while this session waited for the lock.
		assertCutover(protocol);
		if (protocol?.version === 9) {
			await verifyInternalProtocolV9(sql);
			return;
		}
		if (
			protocol === undefined ||
			protocol.version === 6 ||
			protocol.version === 7
		) {
			await ensureInternalProtocolV8(
				sql,
				databaseName,
				expectedPid,
				control,
				{ allowNonRollingProtocolV8: cutover.allowNonRollingProtocolV8 },
				signal,
			);
			protocol = await protocolRow(sql);
		}
		if (
			protocol?.version !== 8 ||
			protocol.checksum !== internalProtocolV8Checksum
		)
			return fail(
				"QP-SCHEMA-023",
				"checksumMismatch",
				"protocol v9 installation requires exact v8 input",
			);
		await withPinnedTransaction(
			sql,
			expectedPid,
			"internal protocol v9 upgrade",
			signal,
			async (transaction) => {
				await verifyInternalProtocolCatalog(
					transaction,
					internalProtocolV8Catalog,
					protocol,
				);
				await transaction.unsafe(internalProtocolV9Sql);
				await transaction`UPDATE questpie_internal.protocol SET version = 9, checksum = ${internalProtocolV9Checksum} WHERE singleton = true`;
				await verifyInternalProtocolV9(transaction);
			},
		);
	} finally {
		await assertBackendPid(sql, expectedPid, "internal protocol v9 unlock");
		await sql`SELECT pg_catalog.pg_advisory_unlock(${key})`;
	}
}
