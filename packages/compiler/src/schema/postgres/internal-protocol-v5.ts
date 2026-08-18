import { createHash } from "node:crypto";

import type { SQL } from "bun";

import { canonicalBytes, compareAscii } from "../../canonical";
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
	ensureInternalProtocolV4,
	internalProtocolV4Catalog,
	internalProtocolV4Checksum,
} from "./internal-protocol-v4";
import {
	internalProtocolV5Columns,
	internalProtocolV5Constraints,
	internalProtocolV5Indexes,
	internalProtocolV5ReplacedConstraints,
	internalProtocolV5Tables,
} from "./internal-protocol-v5-catalog";
import { internalProtocolV5Sql } from "./internal-protocol-v5-sql";
import { fail } from "./shared";

const internalProtocolV5Checksum = createHash("sha256")
	.update("questpie-internal-protocol-v5\0")
	.update(internalProtocolV4Checksum)
	.update("\0")
	.update(internalProtocolV5Sql)
	.digest("hex");

function catalogSort(
	left: readonly unknown[],
	right: readonly unknown[],
): number {
	return compareAscii(
		canonicalBytes(left.slice(0, 2)),
		canonicalBytes(right.slice(0, 2)),
	);
}

function columnSort(
	left: readonly unknown[],
	right: readonly unknown[],
): number {
	return compareAscii(String(left[0]), String(right[0]));
}

const replaced = new Set(
	internalProtocolV5ReplacedConstraints.map(
		([table, name]) => `${table}\u0000${name}`,
	),
);

/**
 * v5 adds one nullable column and rewrites one CHECK. It introduces no table,
 * function, or trigger, so the durable guard catalog v4 verifies is unchanged
 * and is re-verified here through the v4 verifier rather than duplicated.
 */
const internalProtocolV5Catalog: InternalProtocolCatalog = Object.freeze({
	tables: Object.freeze(
		[...internalProtocolV4Catalog.tables, ...internalProtocolV5Tables].sort(),
	),
	columns: Object.freeze(
		[...internalProtocolV4Catalog.columns, ...internalProtocolV5Columns].sort(
			columnSort,
		),
	),
	constraints: Object.freeze(
		[
			...internalProtocolV4Catalog.constraints.filter(
				([table, name]) => !replaced.has(`${table}\u0000${name}`),
			),
			...internalProtocolV5Constraints,
		].sort(catalogSort),
	),
	indexes: Object.freeze(
		[...internalProtocolV4Catalog.indexes, ...internalProtocolV5Indexes].sort(
			catalogSort,
		),
	),
});

async function protocolRow(
	sql: SQL,
): Promise<Readonly<{ version: number; checksum: string }> | undefined> {
	const [protocol] = await sql<{ version: number; checksum: string }[]>`
    select version, checksum from questpie_internal.protocol where singleton = true
  `;
	return protocol;
}

export async function verifyInternalProtocolV5(sql: SQL): Promise<void> {
	const protocol = await protocolRow(sql);
	if (
		protocol?.version !== 5 ||
		protocol.checksum !== internalProtocolV5Checksum
	)
		return fail(
			"QP-SCHEMA-023",
			"checksumMismatch",
			"questpie_internal protocol v5 is not installed",
		);
	await verifyInternalProtocolCatalog(sql, internalProtocolV5Catalog, protocol);
}

export async function ensureInternalProtocolV5(
	sql: SQL,
	databaseName: string,
	expectedPid: number,
	control: PostgresControl,
	signal?: AbortSignal,
): Promise<void> {
	await assertBackendPid(sql, expectedPid, "before internal protocol v5");
	const protocolBefore = await protocolRow(sql).catch(() => undefined);
	if (protocolBefore?.version !== 5)
		await ensureInternalProtocolV4(
			sql,
			databaseName,
			expectedPid,
			control,
			signal,
		);
	const key = lockKey(databaseName, "questpie.internal-protocol");
	await acquireSessionLock(sql, key, signal);
	try {
		const protocol = await protocolRow(sql);
		if (
			protocol?.version === 5 &&
			protocol.checksum === internalProtocolV5Checksum
		) {
			await verifyInternalProtocolV5(sql);
			return;
		}
		if (
			protocol?.version !== 4 ||
			protocol.checksum !== internalProtocolV4Checksum
		)
			return fail(
				"QP-SCHEMA-023",
				"checksumMismatch",
				"questpie.internal protocol is missing, changed, or unsupported",
			);
		await withPinnedTransaction(
			sql,
			expectedPid,
			"internal protocol v5 upgrade",
			signal,
			async (transaction) => {
				await verifyInternalProtocolCatalog(
					transaction,
					internalProtocolV4Catalog,
					protocol,
				);
				await transaction.unsafe(internalProtocolV5Sql);
				await transaction`
          update questpie_internal.protocol set version = 5, checksum = ${internalProtocolV5Checksum}
          where singleton = true
        `;
				await verifyInternalProtocolV5(transaction);
			},
		);
	} finally {
		await assertBackendPid(sql, expectedPid, "internal protocol v5 unlock");
		await sql`select pg_catalog.pg_advisory_unlock(${key})`;
	}
}

export {
	internalProtocolV5Catalog,
	internalProtocolV5Checksum,
	internalProtocolV5Sql,
};
