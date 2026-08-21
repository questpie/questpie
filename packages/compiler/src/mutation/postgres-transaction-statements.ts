import { compareAscii, digest } from "../canonical";

type ResultColumnCodec = "bytea" | "text" | "timestamptz";

type ResultContract = Readonly<{
	command: "INSERT" | "SELECT" | "UPDATE";
	affectedRows: Readonly<{ minimum: number; maximum: number }>;
	returnedRows: Readonly<{ minimum: number; maximum: number }>;
	columns: readonly Readonly<{
		key: string;
		codec: ResultColumnCodec;
		nullable: boolean;
	}>[];
}>;

type Statement = Readonly<{
	identity: string;
	text: string;
	parameterCount: number;
	result: ResultContract;
}>;

const range = (minimum: number, maximum = minimum) =>
	Object.freeze({ minimum, maximum });

const result = (
	command: ResultContract["command"],
	affectedRows: ResultContract["affectedRows"],
	returnedRows: ResultContract["returnedRows"],
	columns: ResultContract["columns"] = [],
): ResultContract =>
	Object.freeze({
		command,
		affectedRows,
		returnedRows,
		columns: Object.freeze(columns),
	});

const statements: readonly Statement[] = Object.freeze(
	[
		{
			identity: "mutation.dispatch.event.insert",
			text: `INSERT INTO questpie_internal.durable_run_events
  (application_name, run_id, sequence, occurred_at, resource_identity, dispatch_id,
   causation_id, correlation_id, kind)
VALUES ($1, $2, 1, $3, $4, $5, $6, $7, 'accepted')`,
			parameterCount: 7,
			result: result("INSERT", range(1), range(0)),
		},
		{
			identity: "mutation.dispatch.intent.accept",
			text: `UPDATE questpie_internal.pending_reaction_intents
SET state = 'accepted'
WHERE application_name = $1 AND record_id = $2 AND state = 'pending'
RETURNING record_id::text AS "dispatchId"`,
			parameterCount: 2,
			result: result("UPDATE", range(0, 1), range(0, 1), [
				{ key: "dispatchId", codec: "text", nullable: false },
			]),
		},
		{
			identity: "mutation.dispatch.intent.insert",
			text: `INSERT INTO questpie_internal.pending_reaction_intents
  (application_name, tenant_id, source_operation, principal_kind, principal_id, call_id, dispatch_slot, record_id, reaction_name, input_digest, payload_bytes, transaction_id, recorded_at, state)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, pg_catalog.pg_current_xact_id(), $12, 'pending')`,
			parameterCount: 12,
			result: result("INSERT", range(1), range(0)),
		},
		{
			identity: "mutation.dispatch.kernel.mark",
			text: `SELECT set_config('questpie.durable_kernel', 'on', true) AS "enabled"`,
			parameterCount: 0,
			result: result("SELECT", range(1), range(1), [
				{ key: "enabled", codec: "text", nullable: false },
			]),
		},
		{
			identity: "mutation.dispatch.run.insert",
			text: `INSERT INTO questpie_internal.durable_runs
  (application_name, run_id, dispatch_id, resource_identity, tenant_id, principal_kind, principal_id,
   run_as, context_input_bytes, payload_bytes, retry_bytes, runtime_build_digest, executable_digest,
   causation_kind, causation_id, correlation_id, state, attempt_count, available_at, horizon_at,
   cancellation_requested, event_sequence, dead_letter, accepted_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, 'caller', $8, $9, $10, $11, $12,
   'mutationDispatch', $13, $14, 'ready', 0, $15, $16, false, 1, false, $15)
ON CONFLICT DO NOTHING
RETURNING run_id::text AS "runId"`,
			parameterCount: 16,
			result: result("INSERT", range(0, 1), range(0, 1), [
				{ key: "runId", codec: "text", nullable: false },
			]),
		},
		{
			identity: "mutation.receipt.claim",
			text: `INSERT INTO questpie_internal.mutation_call_receipts
  (application_name, tenant_id, operation_name, principal_kind, principal_id, call_id, input_digest, transaction_id, operation_time, outcome)
VALUES ($1, $2, $3, $4, $5, $6, $7, pg_catalog.pg_current_xact_id(), pg_catalog.transaction_timestamp(), 'executing')
ON CONFLICT DO NOTHING
RETURNING transaction_id::text AS "transactionId", operation_time AS "operationTime"`,
			parameterCount: 7,
			result: result("INSERT", range(0, 1), range(0, 1), [
				{ key: "transactionId", codec: "text", nullable: false },
				{ key: "operationTime", codec: "timestamptz", nullable: false },
			]),
		},
		{
			identity: "mutation.receipt.commit",
			text: `UPDATE questpie_internal.mutation_call_receipts
SET outcome = 'committed', result_bytes = $7, committed_at = $8
WHERE application_name = $1 AND tenant_id = $2 AND operation_name = $3 AND principal_kind = $4 AND principal_id = $5 AND call_id = $6`,
			parameterCount: 8,
			result: result("UPDATE", range(1), range(0)),
		},
		{
			identity: "mutation.receipt.read",
			text: `SELECT input_digest AS "inputDigest", outcome, result_bytes AS "resultBytes", transaction_id::text AS "transactionId"
FROM questpie_internal.mutation_call_receipts
WHERE application_name = $1 AND tenant_id = $2 AND operation_name = $3 AND principal_kind = $4 AND principal_id = $5 AND call_id = $6`,
			parameterCount: 6,
			result: result("SELECT", range(1), range(1), [
				{ key: "inputDigest", codec: "text", nullable: false },
				{ key: "outcome", codec: "text", nullable: false },
				{ key: "resultBytes", codec: "bytea", nullable: true },
				{ key: "transactionId", codec: "text", nullable: false },
			]),
		},
	]
		.sort((left, right) => compareAscii(left.identity, right.identity))
		.map((statement) => Object.freeze(statement)),
);

export function projectPostgresMutationTransactionStatements() {
	const unsigned = Object.freeze({
		format: "questpie.postgres-mutation-transaction-statements" as const,
		version: 1 as const,
		statements,
	});
	return Object.freeze({
		...unsigned,
		digest: digest(
			"questpie-postgres-mutation-transaction-statements-v1",
			unsigned,
		),
	});
}
