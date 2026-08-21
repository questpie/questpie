import {
	definePostgresStatement,
	type PostgresTransactionRunner,
} from "../postgres";
import type {
	RetainedLiveQueryBinding,
	RetainedLiveQueryCompleteResult,
} from "./postgres-retention";

const retainedTokensPerPrincipal = 128;
const postgresBigintMaximum = 9_223_372_036_854_775_807n;
const positiveIntegerPattern = /^[1-9][0-9]*$/;

type RetainedLiveQueryLookupBinding = Omit<
	RetainedLiveQueryBinding,
	"retainedGeneration"
>;

export type PostgresRetainedResultRow = Readonly<{
	deploymentDigest: string;
	authorityPartitionDigest: string;
	queryIdentity: string;
	inputDigest: string;
	wireVersion: number;
	retainedGeneration: bigint;
	resultBytes: Uint8Array;
	dependencyPlanBytes: Uint8Array;
}>;

function decodedMutation(
	result: Readonly<{
		command: string;
		rowCount: number | null;
		rows: readonly (readonly unknown[])[];
	}>,
	command: "DELETE",
): number {
	if (
		result.command !== command ||
		!Number.isSafeInteger(result.rowCount) ||
		result.rowCount! < 0 ||
		result.rows.length !== 0
	)
		throw new TypeError(`retained Live Query ${command} result is invalid`);
	return result.rowCount!;
}

function decodedCount(
	result: Readonly<{
		command: string;
		rowCount: number | null;
		rows: readonly (readonly unknown[])[];
	}>,
	label: string,
): number {
	const value = result.rows[0]?.[0];
	if (
		result.command !== "SELECT" ||
		result.rowCount !== 1 ||
		result.rows.length !== 1 ||
		result.rows[0]?.length !== 1 ||
		typeof value !== "number" ||
		!Number.isSafeInteger(value) ||
		value < 0
	)
		throw new TypeError(`${label} prune result is invalid`);
	return value;
}

const lockAuthorityPartition = definePostgresStatement({
	name: "live-query.retention-authority-lock",
	text: `SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
  $1,
  0
))`,
	parameterCount: 1,
	parameters: (identity: string) => [identity],
	decode(result) {
		if (
			result.command !== "SELECT" ||
			result.rowCount !== 1 ||
			result.rows.length !== 1 ||
			result.rows[0]?.length !== 1 ||
			result.rows[0][0] !== ""
		)
			throw new TypeError(
				"retained Live Query authority lock result is invalid",
			);
	},
});

const deleteExpiredPartitionResults = definePostgresStatement({
	name: "live-query.retention-expired-partition-delete",
	text: `DELETE FROM questpie_internal.retained_live_query_results
WHERE application_name = $1
  AND authority_partition_digest = $2
  AND expires_at <= transaction_timestamp()`,
	parameterCount: 2,
	parameters: (input: RetainedLiveQueryBinding) => [
		input.applicationName,
		input.authorityPartitionDigest,
	],
	decode: (result) => decodedMutation(result, "DELETE"),
});

type AcknowledgedResult = RetainedLiveQueryCompleteResult &
	Readonly<{ tokenDigest: string }>;

const retainAcknowledgedResult = definePostgresStatement({
	name: "live-query.retention-result-upsert",
	text: `INSERT INTO questpie_internal.retained_live_query_results
  (application_name, token_digest, authority_partition_digest, deployment_digest,
   query_identity, input_digest, wire_version, retained_generation, result_bytes,
   dependency_plan_bytes)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
ON CONFLICT (application_name, token_digest) DO UPDATE
SET token_digest = excluded.token_digest
WHERE retained_live_query_results.authority_partition_digest = excluded.authority_partition_digest
  AND retained_live_query_results.deployment_digest = excluded.deployment_digest
  AND retained_live_query_results.query_identity = excluded.query_identity
  AND retained_live_query_results.input_digest = excluded.input_digest
  AND retained_live_query_results.wire_version = excluded.wire_version
  AND retained_live_query_results.retained_generation = excluded.retained_generation
  AND retained_live_query_results.result_bytes = excluded.result_bytes
  AND retained_live_query_results.dependency_plan_bytes = excluded.dependency_plan_bytes
RETURNING token_digest`,
	parameterCount: 10,
	parameters: (input: AcknowledgedResult) => [
		input.binding.applicationName,
		input.tokenDigest,
		input.binding.authorityPartitionDigest,
		input.binding.deploymentDigest,
		input.binding.queryIdentity,
		input.binding.inputDigest,
		input.binding.wireVersion,
		input.binding.retainedGeneration,
		input.resultBytes,
		input.dependencyPlanBytes,
	],
	decode(result) {
		if (result.command !== "INSERT" || result.rowCount === null)
			throw new TypeError("retained result upsert result is invalid");
		if (result.rowCount === 0 && result.rows.length === 0) return;
		const tokenDigest = result.rows[0]?.[0];
		if (
			result.rowCount !== 1 ||
			result.rows.length !== 1 ||
			result.rows[0]?.length !== 1 ||
			typeof tokenDigest !== "string"
		)
			throw new TypeError("retained result upsert result is invalid");
		return tokenDigest;
	},
});

const evictExcessPartitionResults = definePostgresStatement({
	name: "live-query.retention-excess-partition-delete",
	text: `WITH evicted AS (
  SELECT token_digest
  FROM questpie_internal.retained_live_query_results
  WHERE application_name = $1
    AND authority_partition_digest = $2
  ORDER BY created_at DESC, token_digest DESC
  OFFSET $3
)
DELETE FROM questpie_internal.retained_live_query_results AS retained
USING evicted
WHERE retained.application_name = $1
  AND retained.token_digest = evicted.token_digest`,
	parameterCount: 3,
	parameters: (input: RetainedLiveQueryBinding) => [
		input.applicationName,
		input.authorityPartitionDigest,
		retainedTokensPerPrincipal,
	],
	decode: (result) => decodedMutation(result, "DELETE"),
});

const readRetainedResult = definePostgresStatement({
	name: "live-query.retention-result-read",
	text: `SELECT deployment_digest,
       authority_partition_digest,
       query_identity,
       input_digest,
       wire_version,
       retained_generation::text,
       result_bytes,
       dependency_plan_bytes
FROM questpie_internal.retained_live_query_results
WHERE application_name = $1
  AND token_digest = $2
  AND deployment_digest = $3
  AND authority_partition_digest = $4
  AND query_identity = $5
  AND input_digest = $6
  AND wire_version = $7
  AND expires_at > transaction_timestamp()`,
	parameterCount: 7,
	parameters: (
		input: RetainedLiveQueryLookupBinding & Readonly<{ tokenDigest: string }>,
	) => [
		input.applicationName,
		input.tokenDigest,
		input.deploymentDigest,
		input.authorityPartitionDigest,
		input.queryIdentity,
		input.inputDigest,
		input.wireVersion,
	],
	decode(result): PostgresRetainedResultRow | undefined {
		if (result.command !== "SELECT" || result.rowCount === null)
			throw new TypeError("retained result lookup result is invalid");
		if (result.rowCount === 0 && result.rows.length === 0) return;
		const row = result.rows[0];
		if (
			result.rowCount !== 1 ||
			result.rows.length !== 1 ||
			row?.length !== 8 ||
			typeof row[0] !== "string" ||
			typeof row[1] !== "string" ||
			typeof row[2] !== "string" ||
			typeof row[3] !== "string" ||
			typeof row[4] !== "number" ||
			!Number.isSafeInteger(row[4]) ||
			typeof row[5] !== "string" ||
			!positiveIntegerPattern.test(row[5]) ||
			!(row[6] instanceof Uint8Array) ||
			!(row[7] instanceof Uint8Array)
		)
			throw new TypeError("retained result lookup result is invalid");
		const retainedGeneration = BigInt(row[5]);
		if (retainedGeneration > postgresBigintMaximum)
			throw new TypeError("retained result generation is invalid");
		return Object.freeze({
			deploymentDigest: row[0],
			authorityPartitionDigest: row[1],
			queryIdentity: row[2],
			inputDigest: row[3],
			wireVersion: row[4],
			retainedGeneration,
			resultBytes: new Uint8Array(row[6]),
			dependencyPlanBytes: new Uint8Array(row[7]),
		});
	},
});

const pruneExpiredResults = definePostgresStatement({
	name: "live-query.retention-expired-delete",
	text: `WITH deleted AS (
  DELETE FROM questpie_internal.retained_live_query_results
  WHERE application_name = $1
    AND expires_at <= transaction_timestamp()
  RETURNING 1
)
SELECT count(*)::integer FROM deleted`,
	parameterCount: 1,
	parameters: (applicationName: string) => [applicationName],
	decode: (result) => decodedCount(result, "retained result"),
});

const pruneLedgerFacts = definePostgresStatement({
	name: "live-query.retention-ledger-delete",
	text: `WITH minimum AS (
  SELECT min(xid_horizon) AS horizon
  FROM questpie_internal.reconciliation_consumers
  WHERE application_name = $1
), deleted AS (
  DELETE FROM questpie_internal.change_ledger AS facts USING minimum
  WHERE facts.application_name = $1
    AND facts.transaction_id < minimum.horizon
  RETURNING 1
)
SELECT count(*)::integer FROM deleted`,
	parameterCount: 1,
	parameters: (applicationName: string) => [applicationName],
	decode: (result) => decodedCount(result, "Change Ledger"),
});

export async function acknowledgePostgresRetainedResult(
	database: PostgresTransactionRunner,
	result: RetainedLiveQueryCompleteResult,
	tokenDigest: string,
): Promise<void> {
	await database.transaction({
		mode: { isolation: "readCommitted", access: "readWrite" },
		async use(transaction) {
			await transaction.execute(
				lockAuthorityPartition,
				`questpie-retained-result-v1:${result.binding.applicationName}:${result.binding.authorityPartitionDigest}`,
			);
			await transaction.execute(deleteExpiredPartitionResults, result.binding);
			const insertedTokenDigest = await transaction.execute(
				retainAcknowledgedResult,
				{ ...result, tokenDigest },
			);
			if (insertedTokenDigest !== tokenDigest)
				throw new TypeError("retained result identity conflicts");
			await transaction.execute(evictExcessPartitionResults, result.binding);
		},
	});
}

export function readPostgresRetainedResult(
	database: PostgresTransactionRunner,
	binding: RetainedLiveQueryLookupBinding,
	tokenDigest: string,
): Promise<PostgresRetainedResultRow | undefined> {
	return database.transaction({
		mode: { isolation: "readCommitted", access: "readOnly" },
		use: (transaction) =>
			transaction.execute(readRetainedResult, { ...binding, tokenDigest }),
	});
}

export function prunePostgresLiveQueryRetention(
	database: PostgresTransactionRunner,
	applicationName: string,
): Promise<Readonly<{ retainedResults: number; ledgerFacts: number }>> {
	return database.transaction({
		mode: { isolation: "readCommitted", access: "readWrite" },
		async use(transaction) {
			const retainedResults = await transaction.execute(
				pruneExpiredResults,
				applicationName,
			);
			const ledgerFacts = await transaction.execute(
				pruneLedgerFacts,
				applicationName,
			);
			return Object.freeze({ retainedResults, ledgerFacts });
		},
	});
}
