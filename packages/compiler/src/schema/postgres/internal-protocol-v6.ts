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
	ensureInternalProtocolV5,
	internalProtocolV5Catalog,
	internalProtocolV5Checksum,
} from "./internal-protocol-v5";
import {
	internalProtocolV6Columns,
	internalProtocolV6Constraints,
	internalProtocolV6Indexes,
	internalProtocolV6ReplacedConstraints,
	internalProtocolV6Tables,
} from "./internal-protocol-v6-catalog";
import { internalProtocolV6Sql } from "./internal-protocol-v6-sql";
import { fail } from "./shared";

const internalProtocolV6Checksum = createHash("sha256")
	.update("questpie-internal-protocol-v6\0")
	.update(internalProtocolV5Checksum)
	.update("\0")
	.update(internalProtocolV6Sql)
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

const replaced = new Set(
	internalProtocolV6ReplacedConstraints.map(
		([table, name]) => `${table}\u0000${name}`,
	),
);

const internalProtocolV6Catalog: InternalProtocolCatalog = Object.freeze({
	tables: Object.freeze(
		[...internalProtocolV5Catalog.tables, ...internalProtocolV6Tables].sort(),
	),
	columns: Object.freeze(
		[...internalProtocolV5Catalog.columns, ...internalProtocolV6Columns].sort(
			(left, right) => compareAscii(String(left[0]), String(right[0])),
		),
	),
	constraints: Object.freeze(
		[
			...internalProtocolV5Catalog.constraints.filter(
				([table, name]) => !replaced.has(`${table}\u0000${name}`),
			),
			...internalProtocolV6Constraints,
		].sort(catalogSort),
	),
	indexes: Object.freeze(
		[...internalProtocolV5Catalog.indexes, ...internalProtocolV6Indexes].sort(
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

export async function verifyInternalProtocolV6(sql: SQL): Promise<void> {
	const protocol = await protocolRow(sql);
	if (
		protocol?.version !== 6 ||
		protocol.checksum !== internalProtocolV6Checksum
	)
		return fail(
			"QP-SCHEMA-023",
			"checksumMismatch",
			"questpie_internal protocol v6 is not installed",
		);
	await verifyInternalProtocolCatalog(sql, internalProtocolV6Catalog, protocol);
}

export async function ensureInternalProtocolV6(
	sql: SQL,
	databaseName: string,
	expectedPid: number,
	control: PostgresControl,
	signal?: AbortSignal,
): Promise<void> {
	await assertBackendPid(sql, expectedPid, "before internal protocol v6");
	const protocolBefore = await protocolRow(sql).catch(() => undefined);
	if (protocolBefore?.version !== 6)
		await ensureInternalProtocolV5(
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
			protocol?.version === 6 &&
			protocol.checksum === internalProtocolV6Checksum
		) {
			await verifyInternalProtocolV6(sql);
			return;
		}
		if (
			protocol?.version !== 5 ||
			protocol.checksum !== internalProtocolV5Checksum
		)
			return fail(
				"QP-SCHEMA-023",
				"checksumMismatch",
				"questpie.internal protocol is missing, changed, or unsupported",
			);
		await withPinnedTransaction(
			sql,
			expectedPid,
			"internal protocol v6 upgrade",
			signal,
			async (transaction) => {
				await verifyInternalProtocolCatalog(
					transaction,
					internalProtocolV5Catalog,
					protocol,
				);
				await transaction.unsafe(internalProtocolV6Sql);
				await transaction`
          update questpie_internal.protocol set version = 6, checksum = ${internalProtocolV6Checksum}
          where singleton = true
        `;
				await verifyInternalProtocolV6(transaction);
			},
		);
	} finally {
		await assertBackendPid(sql, expectedPid, "internal protocol v6 unlock");
		await sql`select pg_catalog.pg_advisory_unlock(${key})`;
	}
}

export {
	internalProtocolV6Catalog,
	internalProtocolV6Checksum,
	internalProtocolV6Sql,
};
