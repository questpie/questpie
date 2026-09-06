import {
	durableEffectFence,
	durableKernelMarker,
} from "../../../../packages/runtime/src/durable/postgres-statements";
import {
	leaseTokenDigest,
	type DurableClaim,
} from "../../../../packages/runtime/src/durable/rows";
import {
	canonicalMutationBytes,
	mutationDigest,
} from "../../../../packages/runtime/src/mutation/canonical";
import {
	definePostgresStatement,
	type PostgresTransactionRunner,
} from "../../../../packages/runtime/src/postgres/contract";

/** Proof-only storage. This is not a proposed production migration. */
export const CHECKPOINT_PROOF_SCHEMA_SQL = `CREATE SCHEMA checkpoint_proof;
CREATE TABLE checkpoint_proof.mutation_checkpoints (
  application_name text NOT NULL,
  run_id uuid NOT NULL,
  ordinal smallint NOT NULL,
  checkpoint_name text NOT NULL,
  operation_name text NOT NULL,
  call_id text NOT NULL,
  command_digest text NOT NULL,
  input_digest text NOT NULL,
  contract_digest text NOT NULL,
  runtime_graph_digest text NOT NULL,
  tenant_id text NOT NULL,
  principal_kind text NOT NULL,
  principal_id text NOT NULL,
  state text NOT NULL,
  receipt_transaction_id xid8,
  PRIMARY KEY (application_name, run_id, ordinal),
  UNIQUE (application_name, run_id, checkpoint_name),
  CONSTRAINT checkpoint_proof_ordinal_bounded CHECK (ordinal BETWEEN 1 AND 64),
  CONSTRAINT checkpoint_proof_name_bounded CHECK (
    checkpoint_name ~ '^[A-Za-z0-9_-]{1,64}$'
  ),
  CONSTRAINT checkpoint_proof_call_bounded CHECK (length(call_id) BETWEEN 1 AND 256),
  CONSTRAINT checkpoint_proof_command_digest CHECK (command_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT checkpoint_proof_input_digest CHECK (input_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT checkpoint_proof_contract_digest CHECK (contract_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT checkpoint_proof_runtime_graph_digest CHECK (runtime_graph_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT checkpoint_proof_state CHECK (state IN ('reserved', 'completed')),
  CONSTRAINT checkpoint_proof_receipt_shape CHECK (
    (state = 'reserved' AND receipt_transaction_id IS NULL)
    OR (state = 'completed' AND receipt_transaction_id IS NOT NULL)
  )
);`;

type Command = Readonly<{
	ordinal: number;
	name: string;
	operation: `mutation:${string}`;
	input: unknown;
	contractDigest: string;
	runtimeGraphDigest: string;
}>;

type PreparedCommand = Readonly<{
	ordinal: number;
	name: string;
	operation: string;
	callId: string;
	commandDigest: string;
	inputDigest: string;
	contractDigest: string;
	runtimeGraphDigest: string;
}>;

type CheckpointRow = PreparedCommand &
	Readonly<{
		tenantId: string;
		principalKind: string;
		principalId: string;
		state: "reserved" | "completed";
		receiptTransactionId: string | null;
	}>;

type StatementResult = Readonly<{
	command: string;
	rowCount: number | null;
	rows: readonly (readonly unknown[])[];
}>;

function text(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0 || value.includes("\0"))
		throw new TypeError(`invalid checkpoint proof ${label}`);
	return value;
}

function digest(value: unknown, label: string): string {
	const result = text(value, label);
	if (!/^[0-9a-f]{64}$/u.test(result))
		throw new TypeError(`invalid checkpoint proof ${label}`);
	return result;
}

function ordinal(value: unknown): number {
	if (
		!Number.isSafeInteger(value) ||
		(value as number) < 1 ||
		(value as number) > 64
	)
		throw new TypeError("invalid checkpoint proof ordinal");
	return value as number;
}

function checkpointName(value: unknown): string {
	const result = text(value, "name");
	if (!/^[A-Za-z0-9_-]{1,64}$/u.test(result))
		throw new TypeError("invalid checkpoint proof name");
	return result;
}

function row(
	result: StatementResult,
	operation: string,
): readonly unknown[] | null {
	if (
		result.command !== operation ||
		result.rowCount === null ||
		result.rowCount !== result.rows.length ||
		result.rowCount < 0 ||
		result.rowCount > 1
	)
		throw new TypeError("invalid checkpoint proof PostgreSQL result");
	return result.rows[0] ?? null;
}

function decodeCheckpoint(value: readonly unknown[]): CheckpointRow {
	if (value.length !== 13) throw new TypeError("invalid checkpoint proof row");
	const state = text(value[11], "state");
	if (state !== "reserved" && state !== "completed")
		throw new TypeError("invalid checkpoint proof state");
	const receiptTransactionId = value[12];
	if (receiptTransactionId !== null && typeof receiptTransactionId !== "string")
		throw new TypeError("invalid checkpoint proof receipt transaction");
	return Object.freeze({
		ordinal: ordinal(value[0]),
		name: checkpointName(value[1]),
		operation: text(value[2], "operation"),
		callId: text(value[3], "Call Identity"),
		commandDigest: digest(value[4], "command digest"),
		inputDigest: digest(value[5], "input digest"),
		contractDigest: digest(value[6], "contract digest"),
		runtimeGraphDigest: digest(value[7], "Runtime Graph digest"),
		tenantId: text(value[8], "tenant locator"),
		principalKind: text(value[9], "principal kind locator"),
		principalId: text(value[10], "principal locator"),
		state,
		receiptTransactionId,
	});
}

const checkpointColumns = `ordinal, checkpoint_name, operation_name, call_id,
       command_digest, input_digest, contract_digest, runtime_graph_digest,
       tenant_id, principal_kind, principal_id, state,
       receipt_transaction_id::text`;

const reserveCheckpoint = definePostgresStatement<
	Readonly<{
		application: string;
		runId: string;
		command: PreparedCommand;
		tenantId: string;
		principalKind: string;
		principalId: string;
	}>,
	void,
	"INSERT"
>({
	name: "checkpoint.proof.reserve",
	operation: "INSERT",
	text: `INSERT INTO checkpoint_proof.mutation_checkpoints
  (application_name, run_id, ordinal, checkpoint_name, operation_name, call_id,
   command_digest, input_digest, contract_digest, runtime_graph_digest,
   tenant_id, principal_kind, principal_id, state)
SELECT $1, $2, $3::smallint, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'reserved'
WHERE $3::smallint = COALESCE((
  SELECT max(existing.ordinal) + 1
  FROM checkpoint_proof.mutation_checkpoints AS existing
  WHERE existing.application_name = $1 AND existing.run_id = $2
), 1)
ON CONFLICT DO NOTHING`,
	parameterCount: 13,
	parameters: (input) => [
		input.application,
		input.runId,
		input.command.ordinal,
		input.command.name,
		input.command.operation,
		input.command.callId,
		input.command.commandDigest,
		input.command.inputDigest,
		input.command.contractDigest,
		input.command.runtimeGraphDigest,
		input.tenantId,
		input.principalKind,
		input.principalId,
	],
	decode(result) {
		if (
			result.command !== "INSERT" ||
			result.rowCount === null ||
			result.rowCount < 0 ||
			result.rowCount > 1 ||
			result.rows.length !== 0
		)
			throw new TypeError("invalid checkpoint proof reservation result");
	},
});

const readCheckpoint = definePostgresStatement<
	Readonly<{ application: string; runId: string; ordinal: number }>,
	CheckpointRow | null,
	"SELECT"
>({
	name: "checkpoint.proof.read",
	operation: "SELECT",
	text: `SELECT ${checkpointColumns}
FROM checkpoint_proof.mutation_checkpoints
WHERE application_name = $1 AND run_id = $2 AND ordinal = $3`,
	parameterCount: 3,
	parameters: (input) => [input.application, input.runId, input.ordinal],
	decode(result) {
		const value = row(result, "SELECT");
		return value === null ? null : decodeCheckpoint(value);
	},
});

const readCommittedReceipt = definePostgresStatement<
	Readonly<{
		application: string;
		tenantId: string;
		operation: string;
		principalKind: string;
		principalId: string;
		callId: string;
		inputDigest: string;
	}>,
	string | null,
	"SELECT"
>({
	name: "checkpoint.proof.receipt.read",
	operation: "SELECT",
	text: `SELECT transaction_id::text
FROM questpie_internal.mutation_call_receipts
WHERE application_name = $1 AND tenant_id = $2 AND operation_name = $3
  AND principal_kind = $4 AND principal_id = $5 AND call_id = $6
  AND input_digest = $7 AND outcome = 'committed'`,
	parameterCount: 7,
	parameters: (input) => [
		input.application,
		input.tenantId,
		input.operation,
		input.principalKind,
		input.principalId,
		input.callId,
		input.inputDigest,
	],
	decode(result) {
		const value = row(result, "SELECT");
		if (value === null) return null;
		if (value.length !== 1 || typeof value[0] !== "string")
			throw new TypeError("invalid checkpoint proof receipt result");
		return value[0];
	},
});

const completeCheckpoint = definePostgresStatement<
	Readonly<{
		application: string;
		runId: string;
		ordinal: number;
		commandDigest: string;
		receiptTransactionId: string;
	}>,
	string | null,
	"UPDATE"
>({
	name: "checkpoint.proof.complete",
	operation: "UPDATE",
	text: `UPDATE checkpoint_proof.mutation_checkpoints
SET state = 'completed', receipt_transaction_id = $5::xid8
WHERE application_name = $1 AND run_id = $2 AND ordinal = $3
  AND command_digest = $4 AND state = 'reserved'
RETURNING receipt_transaction_id::text`,
	parameterCount: 5,
	parameters: (input) => [
		input.application,
		input.runId,
		input.ordinal,
		input.commandDigest,
		input.receiptTransactionId,
	],
	decode(result) {
		const value = row(result, "UPDATE");
		if (value === null) return null;
		if (value.length !== 1 || typeof value[0] !== "string")
			throw new TypeError("invalid checkpoint proof completion result");
		return value[0];
	},
});

function prepare(runId: string, command: Command): PreparedCommand {
	const name = checkpointName(command.name);
	const position = ordinal(command.ordinal);
	const operation = text(command.operation, "operation");
	if (
		!operation.startsWith("mutation:") ||
		operation.length === "mutation:".length
	)
		throw new TypeError("invalid checkpoint proof Mutation identity");
	const contractDigest = digest(command.contractDigest, "contract digest");
	const runtimeGraphDigest = digest(
		command.runtimeGraphDigest,
		"Runtime Graph digest",
	);
	const inputDigest = mutationDigest(canonicalMutationBytes(command.input));
	const callId = `checkpoint:${mutationDigest(
		canonicalMutationBytes({ name, ordinal: position, runId }),
	)}`;
	const commandDigest = mutationDigest(
		canonicalMutationBytes({
			contractDigest,
			inputDigest,
			name,
			operation,
			ordinal: position,
			runtimeGraphDigest,
		}),
	);
	return Object.freeze({
		ordinal: position,
		name,
		operation,
		callId,
		commandDigest,
		inputDigest,
		contractDigest,
		runtimeGraphDigest,
	});
}

function matches(row: CheckpointRow, command: PreparedCommand): boolean {
	return (
		row.ordinal === command.ordinal &&
		row.name === command.name &&
		row.operation === command.operation &&
		row.callId === command.callId &&
		row.commandDigest === command.commandDigest &&
		row.inputDigest === command.inputDigest &&
		row.contractDigest === command.contractDigest &&
		row.runtimeGraphDigest === command.runtimeGraphDigest
	);
}

function matchesLocator(row: CheckpointRow, claim: DurableClaim): boolean {
	return (
		row.tenantId === claim.tenantId &&
		row.principalKind === claim.principal.kind &&
		row.principalId === claim.principal.id
	);
}

export function createMutationCheckpointProof(
	input: Readonly<{
		database: PostgresTransactionRunner;
		application: string;
	}>,
) {
	const fence = (claim: DurableClaim) => ({
		application: input.application,
		runId: claim.runId,
		attemptId: claim.attemptId,
		leaseTokenDigest: leaseTokenDigest(claim.leaseToken),
	});
	return Object.freeze({
		async reserve(claim: DurableClaim, rawCommand: Command) {
			const command = prepare(claim.runId, rawCommand);
			return input.database.transaction({
				mode: { isolation: "readCommitted", access: "readWrite" },
				use: async (transaction) => {
					await transaction.execute(durableKernelMarker, undefined);
					if (!(await transaction.execute(durableEffectFence, fence(claim))))
						return Object.freeze({ status: "fenced" as const });
					await transaction.execute(reserveCheckpoint, {
						application: input.application,
						runId: claim.runId,
						command,
						tenantId: claim.tenantId,
						principalKind: claim.principal.kind,
						principalId: claim.principal.id,
					});
					const stored = await transaction.execute(readCheckpoint, {
						application: input.application,
						runId: claim.runId,
						ordinal: command.ordinal,
					});
					if (
						!stored ||
						!matches(stored, command) ||
						!matchesLocator(stored, claim)
					)
						return Object.freeze({ status: "conflict" as const });
					return Object.freeze({
						status: "reserved" as const,
						callId: command.callId,
						commandDigest: command.commandDigest,
						state: stored.state,
					});
				},
			});
		},
		async complete(claim: DurableClaim, rawCommand: Command) {
			const command = prepare(claim.runId, rawCommand);
			return input.database.transaction({
				mode: { isolation: "readCommitted", access: "readWrite" },
				use: async (transaction) => {
					await transaction.execute(durableKernelMarker, undefined);
					if (!(await transaction.execute(durableEffectFence, fence(claim))))
						return Object.freeze({ status: "fenced" as const });
					const stored = await transaction.execute(readCheckpoint, {
						application: input.application,
						runId: claim.runId,
						ordinal: command.ordinal,
					});
					if (
						!stored ||
						!matches(stored, command) ||
						!matchesLocator(stored, claim)
					)
						return Object.freeze({ status: "conflict" as const });
					if (stored.state === "completed")
						return Object.freeze({
							status: "completed" as const,
							receiptTransactionId: stored.receiptTransactionId!,
						});
					const receiptTransactionId = await transaction.execute(
						readCommittedReceipt,
						{
							application: input.application,
							tenantId: stored.tenantId,
							operation: command.operation,
							principalKind: stored.principalKind,
							principalId: stored.principalId,
							callId: command.callId,
							inputDigest: command.inputDigest,
						},
					);
					if (receiptTransactionId === null)
						return Object.freeze({ status: "receiptUnavailable" as const });
					const completed = await transaction.execute(completeCheckpoint, {
						application: input.application,
						runId: claim.runId,
						ordinal: command.ordinal,
						commandDigest: command.commandDigest,
						receiptTransactionId,
					});
					if (completed !== receiptTransactionId)
						throw new TypeError("checkpoint proof completion did not advance");
					return Object.freeze({
						status: "completed" as const,
						receiptTransactionId,
					});
				},
			});
		},
		inspect(runId: string, position: number) {
			return input.database.transaction({
				mode: { isolation: "readCommitted", access: "readOnly" },
				use: (transaction) =>
					transaction.execute(readCheckpoint, {
						application: input.application,
						runId,
						ordinal: ordinal(position),
					}),
			});
		},
	});
}
