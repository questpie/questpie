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
	ensureInternalProtocolV3,
	internalProtocolV3Catalog,
	internalProtocolV3Checksum,
} from "./internal-protocol-v3";
import {
	internalProtocolV4Columns,
	internalProtocolV4Constraints,
	internalProtocolV4Indexes,
	internalProtocolV4ReplacedConstraints,
	internalProtocolV4Tables,
} from "./internal-protocol-v4-catalog";
import { internalProtocolV4Sql } from "./internal-protocol-v4-sql";
import { fail } from "./shared";

const internalProtocolV4Checksum = createHash("sha256")
	.update("questpie-internal-protocol-v4\0")
	.update(internalProtocolV3Checksum)
	.update("\0")
	.update(internalProtocolV4Sql)
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
	internalProtocolV4ReplacedConstraints.map(
		([table, name]) => `${table}\u0000${name}`,
	),
);

const internalProtocolV4Catalog: InternalProtocolCatalog = Object.freeze({
	tables: Object.freeze(
		[...internalProtocolV3Catalog.tables, ...internalProtocolV4Tables].sort(),
	),
	columns: Object.freeze(
		[...internalProtocolV3Catalog.columns, ...internalProtocolV4Columns].sort(
			columnSort,
		),
	),
	constraints: Object.freeze(
		[
			...internalProtocolV3Catalog.constraints.filter(
				([table, name]) => !replaced.has(`${table}\u0000${name}`),
			),
			...internalProtocolV4Constraints,
		].sort(catalogSort),
	),
	indexes: Object.freeze(
		[...internalProtocolV3Catalog.indexes, ...internalProtocolV4Indexes].sort(
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

const guardFunctionNames = [
	"guard_durable_append_only",
	"guard_durable_kernel_write",
] as const;

function guardFunctionBody(name: (typeof guardFunctionNames)[number]): string {
	const declaration = `CREATE FUNCTION questpie_internal.${name}()`;
	const declarationStart = internalProtocolV4Sql.indexOf(declaration);
	const bodyStart =
		internalProtocolV4Sql.indexOf("AS $$", declarationStart) + 5;
	const bodyEnd = internalProtocolV4Sql.indexOf("\n$$;", bodyStart);
	if (declarationStart < 0 || bodyStart < 5 || bodyEnd < 0)
		throw new TypeError(`internal protocol v4 function ${name} is missing`);
	return internalProtocolV4Sql.slice(bodyStart, bodyEnd + 1);
}

const expectedGuardTriggers = [
	[
		"durable_attempts",
		"durable_attempts_kernel_guard",
		"INSERT OR DELETE OR UPDATE",
	],
	[
		"durable_cancellations",
		"durable_cancellations_kernel_guard",
		"INSERT OR DELETE OR UPDATE",
	],
	[
		"durable_effects",
		"durable_effects_kernel_guard",
		"INSERT OR DELETE OR UPDATE",
	],
	[
		"durable_maintenance_commands",
		"durable_maintenance_commands_append_only",
		"DELETE OR UPDATE OR TRUNCATE",
	],
	[
		"durable_maintenance_commands",
		"durable_maintenance_commands_kernel_guard",
		"INSERT OR DELETE OR UPDATE",
	],
	[
		"durable_run_events",
		"durable_run_events_append_only",
		"DELETE OR UPDATE OR TRUNCATE",
	],
	["durable_run_events", "durable_run_events_kernel_guard", "INSERT"],
	["durable_runs", "durable_runs_kernel_guard", "INSERT OR DELETE OR UPDATE"],
	[
		"pending_reaction_intents",
		"durable_dispatch_kernel_guard",
		"INSERT OR DELETE OR UPDATE",
	],
] as const;

async function verifyDurableGuardCatalog(sql: SQL): Promise<void> {
	const functions = await sql<
		{
			name: string;
			body: string;
			language: string;
			returnType: string;
			securityDefiner: boolean;
			configuration: string[] | null;
			publicExecute: boolean;
			ownerMatches: boolean;
		}[]
	>`
		select p.proname as name,
		       p.prosrc as body,
		       l.lanname as language,
		       pg_catalog.format_type(p.prorettype, null) as "returnType",
		       p.prosecdef as "securityDefiner",
		       p.proconfig as configuration,
		       pg_catalog.has_function_privilege('public', p.oid, 'execute') as "publicExecute",
		       p.proowner = n.nspowner as "ownerMatches"
		from pg_catalog.pg_proc p
		join pg_catalog.pg_namespace n on n.oid = p.pronamespace
		join pg_catalog.pg_language l on l.oid = p.prolang
		where n.nspname = 'questpie_internal' and p.proname like 'guard\\_durable\\_%'
		order by p.proname
	`;
	const triggers = await sql<
		{
			tableName: string;
			name: string;
			enabled: string;
			level: string;
			timing: string;
			events: string;
			functionName: string;
		}[]
	>`
		select c.relname as "tableName", t.tgname as name, t.tgenabled as enabled,
		       case when (t.tgtype & 1) = 1 then 'row' else 'statement' end as level,
		       case when (t.tgtype & 2) = 2 then 'before' else 'after' end as timing,
		       concat_ws(' OR ',
		         case when (t.tgtype & 4) = 4 then 'INSERT' end,
		         case when (t.tgtype & 8) = 8 then 'DELETE' end,
		         case when (t.tgtype & 16) = 16 then 'UPDATE' end,
		         case when (t.tgtype & 32) = 32 then 'TRUNCATE' end) as events,
		       p.proname as "functionName"
		from pg_catalog.pg_trigger t
		join pg_catalog.pg_class c on c.oid = t.tgrelid
		join pg_catalog.pg_namespace n on n.oid = c.relnamespace
		join pg_catalog.pg_proc p on p.oid = t.tgfoid
		where n.nspname = 'questpie_internal' and not t.tgisinternal
		  and p.proname like 'guard\\_durable\\_%'
		order by c.relname, t.tgname
	`;
	const expectedFunctions = guardFunctionNames.map((name) => ({
		name,
		body: guardFunctionBody(name),
		language: "plpgsql",
		returnType: "trigger",
		securityDefiner: true,
		configuration: ["search_path=pg_catalog, questpie_internal"],
		publicExecute: false,
		ownerMatches: true,
	}));
	const expectedTriggers = expectedGuardTriggers.map(
		([tableName, name, events]) => ({
			tableName,
			name,
			enabled: "O",
			level: "statement",
			timing: "before",
			events,
			functionName: name.endsWith("append_only")
				? "guard_durable_append_only"
				: "guard_durable_kernel_write",
		}),
	);
	if (
		canonicalBytes(functions) !== canonicalBytes(expectedFunctions) ||
		canonicalBytes(triggers) !== canonicalBytes(expectedTriggers)
	)
		return fail(
			"QP-SCHEMA-023",
			"checksumMismatch",
			"questpie.internal.v4 durable guard catalog changed",
		);
}

export async function verifyInternalProtocolV4(sql: SQL): Promise<void> {
	const protocol = await protocolRow(sql);
	if (
		protocol?.version !== 4 ||
		protocol.checksum !== internalProtocolV4Checksum
	)
		return fail(
			"QP-SCHEMA-023",
			"checksumMismatch",
			"questpie_internal protocol v4 is not installed",
		);
	await verifyInternalProtocolCatalog(sql, internalProtocolV4Catalog, protocol);
	await verifyDurableGuardCatalog(sql);
}

export async function ensureInternalProtocolV4(
	sql: SQL,
	databaseName: string,
	expectedPid: number,
	control: PostgresControl,
	signal?: AbortSignal,
): Promise<void> {
	await assertBackendPid(sql, expectedPid, "before internal protocol v4");
	const protocolBefore = await protocolRow(sql).catch(() => undefined);
	if (protocolBefore?.version !== 4)
		await ensureInternalProtocolV3(
			sql,
			databaseName,
			expectedPid,
			control,
			signal,
		);

	const key = lockKey("questpie-internal-protocol-lock-v4", databaseName);
	await acquireSessionLock(sql, key, control, signal);
	try {
		await assertBackendPid(sql, expectedPid, "internal protocol v4 lock");
		const protocol = await protocolRow(sql);
		if (
			protocol?.version === 4 &&
			protocol.checksum === internalProtocolV4Checksum
		) {
			await verifyInternalProtocolV4(sql);
			return;
		}
		if (
			protocol?.version !== 3 ||
			protocol.checksum !== internalProtocolV3Checksum
		)
			return fail(
				"QP-SCHEMA-023",
				"checksumMismatch",
				"questpie.internal protocol is missing, changed, or unsupported",
			);
		await withPinnedTransaction(
			sql,
			expectedPid,
			"internal protocol v4 upgrade",
			signal,
			async (transaction) => {
				await verifyInternalProtocolCatalog(
					transaction,
					internalProtocolV3Catalog,
					protocol,
				);
				await transaction.unsafe(internalProtocolV4Sql);
				await transaction`
					update questpie_internal.protocol set version = 4, checksum = ${internalProtocolV4Checksum}
					where singleton = true
				`;
				await verifyInternalProtocolV4(transaction);
			},
		);
	} finally {
		await assertBackendPid(sql, expectedPid, "internal protocol v4 unlock");
		await sql`select pg_catalog.pg_advisory_unlock(${key})`;
	}
}

export {
	internalProtocolV4Catalog,
	internalProtocolV4Checksum,
	internalProtocolV4Sql,
};
