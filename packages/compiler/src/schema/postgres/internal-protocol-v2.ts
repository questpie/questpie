import { createHash } from "node:crypto";

import type { SQL } from "bun";

import {
	acquireSessionLock,
	assertBackendPid,
	lockKey,
	withPinnedTransaction,
} from "../../postgres-session";
import type { PostgresControl } from "../../postgres-session";
import {
	bootstrap,
	bootstrapCatalogV1,
	bootstrapChecksum,
	verifyInternalProtocolCatalog,
} from "./bootstrap";
import type { InternalProtocolCatalog } from "./bootstrap";
import { fail } from "./shared";

const internalProtocolV2Sql = `CREATE TABLE questpie_internal.mutation_call_receipts (
  application_name text NOT NULL,
  tenant_id text NOT NULL,
  operation_name text NOT NULL,
  principal_kind text NOT NULL,
  principal_id text NOT NULL,
  call_id text NOT NULL,
  input_digest text NOT NULL,
  transaction_id xid8 NOT NULL,
  operation_time timestamptz NOT NULL,
  outcome text NOT NULL,
  result_bytes bytea,
  committed_at timestamptz,
  PRIMARY KEY (application_name, tenant_id, operation_name, principal_kind, principal_id, call_id),
  CONSTRAINT mutation_receipt_principal_kind_known CHECK (principal_kind IN ('anonymous', 'service', 'user')),
  CONSTRAINT mutation_receipt_call_id_bounded CHECK (length(call_id) BETWEEN 1 AND 256),
  CONSTRAINT mutation_receipt_input_digest_sha256 CHECK (input_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT mutation_receipt_outcome_known CHECK (outcome IN ('executing', 'committed')),
  CONSTRAINT mutation_receipt_outcome_shape CHECK (
    (outcome = 'executing' AND result_bytes IS NULL AND committed_at IS NULL)
    OR (outcome = 'committed' AND result_bytes IS NOT NULL AND committed_at IS NOT NULL)
  ),
  CONSTRAINT mutation_receipt_result_bytes_bounded CHECK (
    result_bytes IS NULL OR octet_length(result_bytes) <= 1048576
  )
);

CREATE TABLE questpie_internal.pending_reaction_intents (
  application_name text NOT NULL,
  tenant_id text NOT NULL,
  source_operation text NOT NULL,
  principal_kind text NOT NULL,
  principal_id text NOT NULL,
  call_id text NOT NULL,
  dispatch_slot text NOT NULL,
  record_id uuid NOT NULL,
  reaction_name text NOT NULL,
  input_digest text NOT NULL,
  payload_bytes bytea NOT NULL,
  transaction_id xid8 NOT NULL,
  recorded_at timestamptz NOT NULL,
  state text NOT NULL,
  PRIMARY KEY (application_name, record_id),
  CONSTRAINT reaction_intent_origin_key UNIQUE (
    application_name, tenant_id, source_operation, principal_kind, principal_id, call_id, dispatch_slot
  ),
  CONSTRAINT reaction_intent_principal_kind_known CHECK (principal_kind IN ('anonymous', 'service', 'user')),
  CONSTRAINT reaction_intent_call_id_bounded CHECK (length(call_id) BETWEEN 1 AND 256),
  CONSTRAINT reaction_intent_input_digest_sha256 CHECK (input_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT reaction_intent_payload_bytes_bounded CHECK (
    octet_length(payload_bytes) <= 262144
  ),
  CONSTRAINT reaction_intent_state_pending CHECK (state = 'pending')
);

REVOKE ALL ON ALL TABLES IN SCHEMA questpie_internal FROM PUBLIC;
`;

const internalProtocolV2Checksum = createHash("sha256")
	.update("questpie-internal-protocol-v2\0")
	.update(bootstrapChecksum)
	.update("\0")
	.update(internalProtocolV2Sql)
	.digest("hex");

const v2Tables = [
	"mutation_call_receipts",
	"pending_reaction_intents",
] as const;

const v2Columns = [
	["mutation_call_receipts", "application_name", "text", true],
	["mutation_call_receipts", "tenant_id", "text", true],
	["mutation_call_receipts", "operation_name", "text", true],
	["mutation_call_receipts", "principal_kind", "text", true],
	["mutation_call_receipts", "principal_id", "text", true],
	["mutation_call_receipts", "call_id", "text", true],
	["mutation_call_receipts", "input_digest", "text", true],
	["mutation_call_receipts", "transaction_id", "xid8", true],
	[
		"mutation_call_receipts",
		"operation_time",
		"timestamp with time zone",
		true,
	],
	["mutation_call_receipts", "outcome", "text", true],
	["mutation_call_receipts", "result_bytes", "bytea", false],
	["mutation_call_receipts", "committed_at", "timestamp with time zone", false],
	["pending_reaction_intents", "application_name", "text", true],
	["pending_reaction_intents", "tenant_id", "text", true],
	["pending_reaction_intents", "source_operation", "text", true],
	["pending_reaction_intents", "principal_kind", "text", true],
	["pending_reaction_intents", "principal_id", "text", true],
	["pending_reaction_intents", "call_id", "text", true],
	["pending_reaction_intents", "dispatch_slot", "text", true],
	["pending_reaction_intents", "record_id", "uuid", true],
	["pending_reaction_intents", "reaction_name", "text", true],
	["pending_reaction_intents", "input_digest", "text", true],
	["pending_reaction_intents", "payload_bytes", "bytea", true],
	["pending_reaction_intents", "transaction_id", "xid8", true],
	["pending_reaction_intents", "recorded_at", "timestamp with time zone", true],
	["pending_reaction_intents", "state", "text", true],
] as const;

const v2Constraints = [
	[
		"mutation_call_receipts",
		"mutation_call_receipts_pkey",
		"p",
		"PRIMARY KEY (application_name, tenant_id, operation_name, principal_kind, principal_id, call_id)",
	],
	[
		"mutation_call_receipts",
		"mutation_receipt_call_id_bounded",
		"c",
		"CHECK (length(call_id) >= 1 AND length(call_id) <= 256)",
	],
	[
		"mutation_call_receipts",
		"mutation_receipt_principal_kind_known",
		"c",
		"CHECK (principal_kind = ANY (ARRAY['anonymous'::text, 'service'::text, 'user'::text]))",
	],
	[
		"mutation_call_receipts",
		"mutation_receipt_input_digest_sha256",
		"c",
		"CHECK (input_digest ~ '^[0-9a-f]{64}$'::text)",
	],
	[
		"mutation_call_receipts",
		"mutation_receipt_outcome_known",
		"c",
		"CHECK (outcome = ANY (ARRAY['executing'::text, 'committed'::text]))",
	],
	[
		"mutation_call_receipts",
		"mutation_receipt_outcome_shape",
		"c",
		"CHECK (outcome = 'executing'::text AND result_bytes IS NULL AND committed_at IS NULL OR outcome = 'committed'::text AND result_bytes IS NOT NULL AND committed_at IS NOT NULL)",
	],
	[
		"mutation_call_receipts",
		"mutation_receipt_result_bytes_bounded",
		"c",
		"CHECK (result_bytes IS NULL OR octet_length(result_bytes) <= 1048576)",
	],
	[
		"pending_reaction_intents",
		"reaction_intent_origin_key",
		"u",
		"UNIQUE (application_name, tenant_id, source_operation, principal_kind, principal_id, call_id, dispatch_slot)",
	],
	[
		"pending_reaction_intents",
		"reaction_intent_call_id_bounded",
		"c",
		"CHECK (length(call_id) >= 1 AND length(call_id) <= 256)",
	],
	[
		"pending_reaction_intents",
		"reaction_intent_principal_kind_known",
		"c",
		"CHECK (principal_kind = ANY (ARRAY['anonymous'::text, 'service'::text, 'user'::text]))",
	],
	[
		"pending_reaction_intents",
		"pending_reaction_intents_pkey",
		"p",
		"PRIMARY KEY (application_name, record_id)",
	],
	[
		"pending_reaction_intents",
		"reaction_intent_input_digest_sha256",
		"c",
		"CHECK (input_digest ~ '^[0-9a-f]{64}$'::text)",
	],
	[
		"pending_reaction_intents",
		"reaction_intent_payload_bytes_bounded",
		"c",
		"CHECK (octet_length(payload_bytes) <= 262144)",
	],
	[
		"pending_reaction_intents",
		"reaction_intent_state_pending",
		"c",
		"CHECK (state = 'pending'::text)",
	],
] as const;

const v2Indexes = [
	[
		"mutation_call_receipts",
		"mutation_call_receipts_pkey",
		"btree",
		true,
		true,
		"CREATE UNIQUE INDEX mutation_call_receipts_pkey ON questpie_internal.mutation_call_receipts USING btree (application_name, tenant_id, operation_name, principal_kind, principal_id, call_id)",
	],
	[
		"pending_reaction_intents",
		"reaction_intent_origin_key",
		"btree",
		true,
		false,
		"CREATE UNIQUE INDEX reaction_intent_origin_key ON questpie_internal.pending_reaction_intents USING btree (application_name, tenant_id, source_operation, principal_kind, principal_id, call_id, dispatch_slot)",
	],
	[
		"pending_reaction_intents",
		"pending_reaction_intents_pkey",
		"btree",
		true,
		true,
		"CREATE UNIQUE INDEX pending_reaction_intents_pkey ON questpie_internal.pending_reaction_intents USING btree (application_name, record_id)",
	],
] as const;

function compareCatalogRows(
	left: readonly [string, string, ...unknown[]],
	right: readonly [string, string, ...unknown[]],
): number {
	return left[0] < right[0]
		? -1
		: left[0] > right[0]
			? 1
			: left[1] < right[1]
				? -1
				: left[1] > right[1]
					? 1
					: 0;
}

function compareCatalogTables(
	left: readonly [string, ...unknown[]],
	right: readonly [string, ...unknown[]],
): number {
	return left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0;
}

const internalProtocolV2Catalog: InternalProtocolCatalog = Object.freeze({
	tables: Object.freeze([...bootstrapCatalogV1.tables, ...v2Tables].sort()),
	columns: Object.freeze(
		[...bootstrapCatalogV1.columns, ...v2Columns].sort(compareCatalogTables),
	),
	constraints: Object.freeze(
		[...bootstrapCatalogV1.constraints, ...v2Constraints].sort(
			compareCatalogRows,
		),
	),
	indexes: Object.freeze(
		[...bootstrapCatalogV1.indexes, ...v2Indexes].sort(compareCatalogRows),
	),
});

async function protocolRow(
	sql: SQL,
): Promise<Readonly<{ version: number; checksum: string }> | undefined> {
	const [protocol] = await sql<{ version: number; checksum: string }[]>`
		select version, checksum
		from questpie_internal.protocol
		where singleton = true
	`;
	return protocol;
}

export async function verifyInternalProtocolV2(sql: SQL): Promise<void> {
	const protocol = await protocolRow(sql);
	if (
		protocol?.version !== 2 ||
		protocol.checksum !== internalProtocolV2Checksum
	)
		return fail(
			"QP-SCHEMA-023",
			"checksumMismatch",
			"questpie_internal protocol v2 is not installed",
		);
	await verifyInternalProtocolCatalog(sql, internalProtocolV2Catalog, {
		version: 2,
		checksum: internalProtocolV2Checksum,
	});
}

export async function ensureInternalProtocolV2(
	sql: SQL,
	databaseName: string,
	expectedPid: number,
	control: PostgresControl,
	signal?: AbortSignal,
): Promise<void> {
	await assertBackendPid(sql, expectedPid, "before internal protocol v2");
	const [state] = await sql<{ exists: boolean }[]>`
		select exists(
			select 1 from pg_catalog.pg_namespace
			where nspname = 'questpie_internal'
		) as exists
	`;
	if (!state?.exists)
		await bootstrap(sql, databaseName, expectedPid, control, signal);

	const key = lockKey("questpie-internal-protocol-lock-v2", databaseName);
	await acquireSessionLock(sql, key, control, signal);
	try {
		await assertBackendPid(sql, expectedPid, "internal protocol v2 lock");
		const protocol = await protocolRow(sql);
		if (
			protocol?.version === 2 &&
			protocol.checksum === internalProtocolV2Checksum
		) {
			await verifyInternalProtocolCatalog(
				sql,
				internalProtocolV2Catalog,
				protocol,
			);
			return;
		}
		if (protocol?.version !== 1 || protocol.checksum !== bootstrapChecksum)
			return fail(
				"QP-SCHEMA-023",
				"checksumMismatch",
				"questpie.internal protocol is missing, changed, or unsupported",
			);

		await withPinnedTransaction(
			sql,
			expectedPid,
			"internal protocol v2 upgrade",
			signal,
			async (transaction) => {
				await verifyInternalProtocolCatalog(
					transaction,
					bootstrapCatalogV1,
					protocol,
				);
				await transaction.unsafe(internalProtocolV2Sql);
				await transaction`
					update questpie_internal.protocol
					set version = 2, checksum = ${internalProtocolV2Checksum}
					where singleton = true
				`;
				await verifyInternalProtocolCatalog(
					transaction,
					internalProtocolV2Catalog,
					{ version: 2, checksum: internalProtocolV2Checksum },
				);
			},
		);
	} finally {
		await assertBackendPid(sql, expectedPid, "internal protocol v2 unlock");
		await sql`select pg_catalog.pg_advisory_unlock(${key})`;
	}
}

export {
	internalProtocolV2Catalog,
	internalProtocolV2Checksum,
	internalProtocolV2Sql,
};
