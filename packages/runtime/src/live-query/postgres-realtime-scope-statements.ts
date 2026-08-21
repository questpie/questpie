import { definePostgresStatement, type PostgresStatement } from "../postgres";
import { decodePostgresRealtimeWatch } from "./postgres-realtime-scope-codec";
import type {
	PostgresRealtimeOpenWatch,
	PostgresRealtimeScopeAuthority,
	PostgresRealtimeScopeLease,
	PostgresRealtimeWatch,
} from "./postgres-realtime-scope-contract";

export type BindingIdentity = PostgresRealtimeScopeAuthority &
	Readonly<{ bindingIdentity: string }>;
export type Expiry = Readonly<{
	applicationName: string;
	deploymentDigest: string;
}>;
export type ExistingWatch = Readonly<{
	activeSlot: number | null;
	authorityPartitionDigest: string;
	queryIdentity: string;
	queryBytes: Uint8Array;
	inputBytes: Uint8Array;
	contextInputBytes: Uint8Array;
	inputDigest: string;
	wireVersion: number;
	state: string;
}>;

function mutation(
	result: Readonly<{
		command: string;
		rowCount: number | null;
		rows: readonly (readonly unknown[])[];
	}>,
	command: string,
	expected?: number,
): number {
	if (
		result.command !== command ||
		result.rowCount === null ||
		result.rows.length !== 0 ||
		(expected !== undefined && result.rowCount !== expected)
	)
		throw new TypeError(`realtime scope ${command} result is invalid`);
	return result.rowCount;
}

function optionalMutation(
	result: Parameters<typeof mutation>[0],
	command: string,
): boolean {
	const count = mutation(result, command);
	if (count > 1)
		throw new TypeError(`realtime scope ${command} cardinality is invalid`);
	return count === 1;
}

function optionalRow(
	result: Readonly<{
		command: string;
		rowCount: number | null;
		rows: readonly (readonly unknown[])[];
	}>,
	columns: number,
	label: string,
	command = "SELECT",
): readonly unknown[] | undefined {
	if (
		result.command !== command ||
		result.rowCount === null ||
		result.rowCount > 1 ||
		result.rows.length !== result.rowCount
	)
		throw new TypeError(`${label} result cardinality is invalid`);
	const row = result.rows[0];
	if (row && row.length !== columns)
		throw new TypeError(`${label} row is invalid`);
	return row;
}

function positiveBigint(value: unknown, label: string): bigint {
	if (typeof value !== "string" || !/^[1-9][0-9]*$/u.test(value))
		throw new TypeError(`${label} is invalid`);
	return BigInt(value);
}

function positiveInteger(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0)
		throw new TypeError(`${label} is invalid`);
	return value;
}

function copiedBytes(value: unknown, label: string): Uint8Array {
	if (!(value instanceof Uint8Array))
		throw new TypeError(`${label} is invalid`);
	return new Uint8Array(value);
}

export const deleteExpiredScope: PostgresStatement<
	PostgresRealtimeScopeAuthority,
	number
> = definePostgresStatement({
	name: "live-query.realtime-scope-expired-delete",
	text: `DELETE FROM questpie_internal.realtime_scope_attachments
WHERE application_name = $1 AND scope_identity = $2 AND expires_at <= transaction_timestamp()`,
	parameterCount: 2,
	parameters: (input: PostgresRealtimeScopeAuthority) => [
		input.applicationName,
		input.scopeIdentity,
	],
	decode: (result) => mutation(result, "DELETE"),
});

export const attachScope: PostgresStatement<
	PostgresRealtimeScopeAuthority,
	bigint | undefined
> = definePostgresStatement({
	name: "live-query.realtime-scope-attach",
	text: `INSERT INTO questpie_internal.realtime_scope_attachments
  (application_name, scope_identity, deployment_digest, authority_partition_digest, principal_kind, principal_id, state)
VALUES ($1, $2, $3, NULL, $4, $5, 'attached')
ON CONFLICT (application_name, scope_identity) DO UPDATE
SET authority_partition_digest = CASE WHEN realtime_scope_attachments.state = 'withdrawn' THEN NULL ELSE realtime_scope_attachments.authority_partition_digest END,
    renewed_at = transaction_timestamp(), state = CASE WHEN realtime_scope_attachments.state = 'withdrawn' THEN 'attached' ELSE realtime_scope_attachments.state END,
    holder_generation = realtime_scope_attachments.holder_generation + 1
WHERE realtime_scope_attachments.deployment_digest = excluded.deployment_digest
  AND realtime_scope_attachments.principal_kind = excluded.principal_kind AND realtime_scope_attachments.principal_id = excluded.principal_id
  AND realtime_scope_attachments.holder_generation < 9223372036854775807
  AND (realtime_scope_attachments.state = 'withdrawn' OR realtime_scope_attachments.expires_at > transaction_timestamp())
RETURNING holder_generation::text`,
	parameterCount: 5,
	parameters: (input: PostgresRealtimeScopeAuthority) => [
		input.applicationName,
		input.scopeIdentity,
		input.deploymentDigest,
		input.principal.kind,
		input.principal.id,
	],
	decode(result) {
		const row = optionalRow(result, 1, "realtime scope attachment", "INSERT");
		return row ? positiveBigint(row[0], "holder generation") : undefined;
	},
});

export const renewScope: PostgresStatement<
	PostgresRealtimeScopeLease,
	boolean
> = definePostgresStatement({
	name: "live-query.realtime-scope-renew",
	text: `UPDATE questpie_internal.realtime_scope_attachments SET renewed_at = transaction_timestamp()
WHERE application_name = $1 AND scope_identity = $2 AND deployment_digest = $3 AND principal_kind = $4 AND principal_id = $5
  AND holder_generation = $6 AND state <> 'withdrawn' AND expires_at > transaction_timestamp()`,
	parameterCount: 6,
	parameters: (input: PostgresRealtimeScopeLease) => [
		input.applicationName,
		input.scopeIdentity,
		input.deploymentDigest,
		input.principal.kind,
		input.principal.id,
		input.holderGeneration,
	],
	decode: (result) => optionalMutation(result, "UPDATE"),
});

export const lockScope: PostgresStatement<string, void> =
	definePostgresStatement({
		name: "live-query.realtime-scope-lock",
		text: `SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1, 0))`,
		parameterCount: 1,
		parameters: (identity: string) => [identity],
		decode(result) {
			const row = optionalRow(result, 1, "realtime scope lock");
			if (!row || row[0] !== "")
				throw new TypeError("realtime scope lock result is invalid");
		},
	});

export const deleteExpiredPrincipalScopes: PostgresStatement<
	PostgresRealtimeScopeAuthority,
	number
> = definePostgresStatement({
	name: "live-query.realtime-principal-scopes-expired-delete",
	text: `DELETE FROM questpie_internal.realtime_scope_attachments
WHERE application_name = $1 AND deployment_digest = $2 AND principal_kind = $3 AND principal_id = $4 AND expires_at <= transaction_timestamp()`,
	parameterCount: 4,
	parameters: (input: PostgresRealtimeScopeAuthority) => [
		input.applicationName,
		input.deploymentDigest,
		input.principal.kind,
		input.principal.id,
	],
	decode: (result) => mutation(result, "DELETE"),
});

export const readScopeAuthority: PostgresStatement<
	PostgresRealtimeScopeAuthority,
	| Readonly<{ authorityPartitionDigest: string | null; state: string }>
	| undefined
> = definePostgresStatement({
	name: "live-query.realtime-scope-authority-read",
	text: `SELECT authority_partition_digest, state FROM questpie_internal.realtime_scope_attachments
WHERE application_name = $1 AND scope_identity = $2 AND deployment_digest = $3 AND principal_kind = $4 AND principal_id = $5
  AND state IN ('attached', 'open') AND expires_at > transaction_timestamp() FOR UPDATE`,
	parameterCount: 5,
	parameters: (input: PostgresRealtimeScopeAuthority) => [
		input.applicationName,
		input.scopeIdentity,
		input.deploymentDigest,
		input.principal.kind,
		input.principal.id,
	],
	decode(result) {
		const row = optionalRow(result, 2, "realtime scope authority");
		if (!row) return;
		if (
			(row[0] !== null && typeof row[0] !== "string") ||
			(row[1] !== "attached" && row[1] !== "open")
		)
			throw new TypeError("realtime scope authority row is invalid");
		return Object.freeze({
			authorityPartitionDigest: row[0] as string | null,
			state: row[1],
		});
	},
});

export const readExistingWatch: PostgresStatement<
	PostgresRealtimeOpenWatch,
	ExistingWatch | undefined
> = definePostgresStatement({
	name: "live-query.realtime-watch-existing-read",
	text: `SELECT active_slot, authority_partition_digest, query_identity, query_bytes, input_bytes, context_input_bytes, input_digest, wire_version, state
FROM questpie_internal.realtime_watch_bindings WHERE application_name = $1 AND scope_identity = $2 AND binding_identity = $3`,
	parameterCount: 3,
	parameters: (input: PostgresRealtimeOpenWatch) => [
		input.applicationName,
		input.scopeIdentity,
		input.bindingIdentity,
	],
	decode(result) {
		const row = optionalRow(result, 9, "existing realtime watch");
		if (!row) return;
		if (
			(row[0] !== null &&
				(typeof row[0] !== "number" ||
					!Number.isSafeInteger(row[0]) ||
					row[0] <= 0)) ||
			typeof row[1] !== "string" ||
			typeof row[2] !== "string" ||
			!(row[3] instanceof Uint8Array) ||
			!(row[4] instanceof Uint8Array) ||
			!(row[5] instanceof Uint8Array) ||
			typeof row[6] !== "string" ||
			typeof row[7] !== "number" ||
			!Number.isSafeInteger(row[7]) ||
			row[7] <= 0 ||
			(row[8] !== "open" && row[8] !== "withdrawn")
		)
			throw new TypeError("existing realtime watch row is invalid");
		return Object.freeze({
			activeSlot: row[0] as number | null,
			authorityPartitionDigest: row[1],
			queryIdentity: row[2],
			queryBytes: copiedBytes(row[3], "Query bytes"),
			inputBytes: copiedBytes(row[4], "input bytes"),
			contextInputBytes: copiedBytes(row[5], "Context input bytes"),
			inputDigest: row[6],
			wireVersion: row[7],
			state: row[8],
		});
	},
});

export const allocateWatchSlot: PostgresStatement<
	PostgresRealtimeOpenWatch,
	number | undefined
> = definePostgresStatement({
	name: "live-query.realtime-watch-slot-allocate",
	text: `SELECT candidate.slot::integer FROM pg_catalog.generate_series(1, 64) AS candidate(slot)
WHERE NOT EXISTS (SELECT 1 FROM questpie_internal.realtime_watch_bindings watch WHERE watch.application_name = $1 AND watch.deployment_digest = $2 AND watch.principal_kind = $3 AND watch.principal_id = $4 AND watch.active_slot = candidate.slot)
ORDER BY candidate.slot LIMIT 1`,
	parameterCount: 4,
	parameters: (input: PostgresRealtimeOpenWatch) => [
		input.applicationName,
		input.deploymentDigest,
		input.principal.kind,
		input.principal.id,
	],
	decode(result) {
		const row = optionalRow(result, 1, "realtime watch slot");
		return row ? positiveInteger(row[0], "active slot") : undefined;
	},
});

export const markScopeOpen: PostgresStatement<
	PostgresRealtimeOpenWatch,
	number
> = definePostgresStatement({
	name: "live-query.realtime-scope-open",
	text: `UPDATE questpie_internal.realtime_scope_attachments SET authority_partition_digest = $3, state = 'open' WHERE application_name = $1 AND scope_identity = $2`,
	parameterCount: 3,
	parameters: (input: PostgresRealtimeOpenWatch) => [
		input.applicationName,
		input.scopeIdentity,
		input.authorityPartitionDigest,
	],
	decode: (result) => mutation(result, "UPDATE", 1),
});

export type WatchInsert = Readonly<{
	open: PostgresRealtimeOpenWatch;
	activeSlot: number;
}>;
export const insertWatch: PostgresStatement<WatchInsert, number> =
	definePostgresStatement({
		name: "live-query.realtime-watch-insert",
		text: `INSERT INTO questpie_internal.realtime_watch_bindings
  (application_name, scope_identity, binding_identity, deployment_digest, authority_partition_digest, principal_kind, principal_id, active_slot,
   query_identity, query_bytes, input_bytes, context_input_bytes, input_digest, wire_version, resume_requested, requested_resume_token, state)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'open')`,
		parameterCount: 16,
		parameters: ({ open, activeSlot }: WatchInsert) => [
			open.applicationName,
			open.scopeIdentity,
			open.bindingIdentity,
			open.deploymentDigest,
			open.authorityPartitionDigest,
			open.principal.kind,
			open.principal.id,
			activeSlot,
			open.queryIdentity,
			open.queryBytes,
			open.inputBytes,
			open.contextInputBytes,
			open.inputDigest,
			open.wireVersion,
			open.resumeRequested,
			open.requestedResumeToken,
		],
		decode: (result) => mutation(result, "INSERT", 1),
	});

const watchSelect = `SELECT watch.binding_identity, watch.authority_partition_digest, watch.query_identity, watch.query_bytes, watch.input_bytes, watch.input_digest,
 watch.context_input_bytes, watch.wire_version, watch.resume_requested, watch.requested_resume_token, watch.active_slot::integer,
 watch.invalidation_generation::text, watch.evaluated_invalidation_generation::text, generation.generation::text, generation.token_digest,
 generation.result_bytes, generation.dependency_plan_bytes, generation.delivery_kind, generation.reset_reason, (generation.ack_slot = 1)
FROM questpie_internal.realtime_scope_attachments scope JOIN questpie_internal.realtime_watch_bindings watch USING (application_name, scope_identity)
LEFT JOIN questpie_internal.realtime_binding_generations generation ON generation.application_name = watch.application_name AND generation.scope_identity = watch.scope_identity AND generation.binding_identity = watch.binding_identity AND generation.latest_slot = 1`;

export const scanOpenWatches: PostgresStatement<
	PostgresRealtimeScopeLease,
	readonly PostgresRealtimeWatch[]
> = definePostgresStatement({
	name: "live-query.realtime-watches-scan",
	text: `${watchSelect}
WHERE scope.application_name = $1 AND scope.scope_identity = $2 AND scope.deployment_digest = $3 AND scope.principal_kind = $4 AND scope.principal_id = $5
 AND scope.holder_generation = $6 AND scope.state = 'open' AND scope.expires_at > transaction_timestamp() AND watch.state = 'open' ORDER BY watch.binding_identity`,
	parameterCount: 6,
	parameters: (input: PostgresRealtimeScopeLease) => [
		input.applicationName,
		input.scopeIdentity,
		input.deploymentDigest,
		input.principal.kind,
		input.principal.id,
		input.holderGeneration,
	],
	decode(result) {
		if (
			result.command !== "SELECT" ||
			result.rowCount === null ||
			result.rows.length !== result.rowCount
		)
			throw new TypeError("realtime watch scan result is invalid");
		return Object.freeze(result.rows.map(decodePostgresRealtimeWatch));
	},
});

export const readOpenWatch: PostgresStatement<
	BindingIdentity,
	PostgresRealtimeWatch | undefined
> = definePostgresStatement({
	name: "live-query.realtime-watch-read",
	text: `${watchSelect}
WHERE scope.application_name = $1 AND scope.scope_identity = $2 AND scope.deployment_digest = $3 AND scope.principal_kind = $4 AND scope.principal_id = $5
 AND scope.state = 'open' AND scope.expires_at > transaction_timestamp() AND watch.binding_identity = $6 AND watch.state = 'open'`,
	parameterCount: 6,
	parameters: (input: BindingIdentity) => [
		input.applicationName,
		input.scopeIdentity,
		input.deploymentDigest,
		input.principal.kind,
		input.principal.id,
		input.bindingIdentity,
	],
	decode(result) {
		const row = optionalRow(result, 20, "realtime watch read");
		return row ? decodePostgresRealtimeWatch(row) : undefined;
	},
});

export const closeWatch: PostgresStatement<BindingIdentity, boolean> =
	definePostgresStatement({
		name: "live-query.realtime-watch-close",
		text: `UPDATE questpie_internal.realtime_watch_bindings watch SET state = 'withdrawn' FROM questpie_internal.realtime_scope_attachments scope
WHERE scope.application_name = $1 AND scope.scope_identity = $2 AND scope.deployment_digest = $3 AND scope.principal_kind = $4 AND scope.principal_id = $5
 AND scope.state = 'open' AND scope.expires_at > transaction_timestamp() AND watch.application_name = scope.application_name AND watch.scope_identity = scope.scope_identity
 AND watch.binding_identity = $6 AND watch.state = 'open'`,
		parameterCount: 6,
		parameters: (input: BindingIdentity) => [
			input.applicationName,
			input.scopeIdentity,
			input.deploymentDigest,
			input.principal.kind,
			input.principal.id,
			input.bindingIdentity,
		],
		decode: (result) => optionalMutation(result, "UPDATE"),
	});

export const withdrawScope: PostgresStatement<
	PostgresRealtimeScopeLease,
	boolean
> = definePostgresStatement({
	name: "live-query.realtime-scope-withdraw",
	text: `UPDATE questpie_internal.realtime_scope_attachments SET state = 'withdrawn'
WHERE application_name = $1 AND scope_identity = $2 AND deployment_digest = $3 AND principal_kind = $4 AND principal_id = $5
 AND holder_generation = $6 AND state <> 'withdrawn' AND expires_at > transaction_timestamp()`,
	parameterCount: 6,
	parameters: (input: PostgresRealtimeScopeLease) => [
		input.applicationName,
		input.scopeIdentity,
		input.deploymentDigest,
		input.principal.kind,
		input.principal.id,
		input.holderGeneration,
	],
	decode: (result) => optionalMutation(result, "UPDATE"),
});

export const expireScopes: PostgresStatement<
	Expiry,
	Readonly<{ scopes: number; watches: number }>
> = definePostgresStatement({
	name: "live-query.realtime-scopes-expire",
	text: `WITH doomed AS MATERIALIZED (SELECT application_name, scope_identity FROM questpie_internal.realtime_scope_attachments
 WHERE application_name = $1 AND deployment_digest = $2 AND expires_at <= transaction_timestamp() FOR UPDATE),
watch_count AS (SELECT count(*)::integer FROM questpie_internal.realtime_watch_bindings watch JOIN doomed USING (application_name, scope_identity)),
deleted AS (DELETE FROM questpie_internal.realtime_scope_attachments attachment USING doomed WHERE attachment.application_name = doomed.application_name AND attachment.scope_identity = doomed.scope_identity RETURNING 1)
SELECT count(*)::integer, (SELECT count FROM watch_count) FROM deleted`,
	parameterCount: 2,
	parameters: (input: Expiry) => [
		input.applicationName,
		input.deploymentDigest,
	],
	decode(result) {
		const row = optionalRow(result, 2, "realtime scope expiry");
		if (
			!row ||
			typeof row[0] !== "number" ||
			typeof row[1] !== "number" ||
			!Number.isSafeInteger(row[0]) ||
			!Number.isSafeInteger(row[1]) ||
			row[0] < 0 ||
			row[1] < 0
		)
			throw new TypeError("realtime scope expiry row is invalid");
		return Object.freeze({ scopes: row[0], watches: row[1] });
	},
});
