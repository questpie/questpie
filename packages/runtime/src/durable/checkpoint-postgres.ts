import {
	decodeRuntimeCodec,
	encodeRuntimeCodec,
	type RuntimeCodec,
} from "../codec";
import { canonicalMutationBytes, mutationDigest } from "../mutation/canonical";
import {
	definePostgresStatement,
	QuestpiePostgresError,
	type PostgresTransactionRunner,
} from "../postgres/contract";
import { DurableCheckpointError } from "./checkpoint-contract";
import { DurableLeaseLost } from "./effects";
import { durableEffectFence, durableKernelMarker } from "./postgres-statements";
import { leaseTokenDigest, type DurableClaim } from "./rows";

export type MutationCheckpointCommand = Readonly<{
	ordinal: number;
	name: string;
	operation: `mutation:${string}`;
	input: unknown;
	inputCodec: RuntimeCodec;
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
		receiptResultDigest: string | null;
	}>;

type StatementResult = Readonly<{
	command: string;
	rowCount: number | null;
	rows: readonly (readonly unknown[])[];
}>;

function text(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0 || value.includes("\0"))
		throw new TypeError(`invalid Mutation checkpoint ${label}`);
	return value;
}

function digest(value: unknown, label: string): string {
	const result = text(value, label);
	if (!/^[0-9a-f]{64}$/u.test(result))
		throw new TypeError(`invalid Mutation checkpoint ${label}`);
	return result;
}

function ordinal(value: unknown): number {
	if (
		!Number.isSafeInteger(value) ||
		(value as number) < 1 ||
		(value as number) > 64
	)
		throw new TypeError("invalid Mutation checkpoint ordinal");
	return value as number;
}

function checkpointName(value: unknown): string {
	const result = text(value, "name");
	if (!/^[A-Za-z0-9_-]{1,64}$/u.test(result))
		throw new TypeError("invalid Mutation checkpoint name");
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
		throw new TypeError("invalid Mutation checkpoint PostgreSQL result");
	return result.rows[0] ?? null;
}

function decodeCheckpoint(value: readonly unknown[]): CheckpointRow {
	if (value.length !== 14)
		throw new TypeError("invalid Mutation checkpoint row");
	const state = text(value[11], "state");
	if (state !== "reserved" && state !== "completed")
		throw new TypeError("invalid Mutation checkpoint state");
	const receiptTransactionId = value[12];
	if (receiptTransactionId !== null && typeof receiptTransactionId !== "string")
		throw new TypeError("invalid Mutation checkpoint receipt transaction");
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
		receiptResultDigest:
			value[13] === null ? null : digest(value[13], "receipt result digest"),
	});
}

const checkpointColumns = `ordinal, checkpoint_name, operation_name, call_id,
       command_digest, input_digest, contract_digest, runtime_graph_digest,
       tenant_id, principal_kind, principal_id, state,
       receipt_transaction_id::text, receipt_result_digest`;

const readCheckpointHistory = definePostgresStatement<
	Readonly<{ application: string; runId: string }>,
	readonly CheckpointRow[],
	"SELECT"
>({
	name: "checkpoint.history",
	operation: "SELECT",
	text: `SELECT ${checkpointColumns} FROM questpie_internal.mutation_checkpoints WHERE application_name = $1 AND run_id = $2 ORDER BY ordinal LIMIT 65`,
	parameterCount: 2,
	parameters: ({ application, runId }) => [application, runId],
	decode(result) {
		if (
			result.command !== "SELECT" ||
			result.rowCount !== result.rows.length ||
			result.rows.length > 64
		)
			throw new DurableCheckpointError();
		return result.rows.map(decodeCheckpoint);
	},
});

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
	name: "checkpoint.reserve",
	operation: "INSERT",
	text: `INSERT INTO questpie_internal.mutation_checkpoints
  (application_name, run_id, ordinal, checkpoint_name, operation_name, call_id,
   command_digest, input_digest, contract_digest, runtime_graph_digest,
   tenant_id, principal_kind, principal_id, state)
SELECT $1, $2, $3::smallint, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'reserved'
WHERE $3::smallint = COALESCE((
  SELECT max(existing.ordinal) + 1
  FROM questpie_internal.mutation_checkpoints AS existing
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
			throw new TypeError("invalid Mutation checkpoint reservation result");
	},
});

const readCheckpoint = definePostgresStatement<
	Readonly<{ application: string; runId: string; ordinal: number }>,
	CheckpointRow | null,
	"SELECT"
>({
	name: "checkpoint.read",
	operation: "SELECT",
	text: `SELECT ${checkpointColumns}
FROM questpie_internal.mutation_checkpoints
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
	Readonly<{ transactionId: string; resultDigest: string }> | null,
	"SELECT"
>({
	name: "checkpoint.receipt.read",
	operation: "SELECT",
	text: `SELECT transaction_id::text, result_bytes
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
		if (
			value.length !== 2 ||
			typeof value[0] !== "string" ||
			!(value[1] instanceof Uint8Array)
		)
			throw new TypeError("invalid Mutation checkpoint receipt result");
		return { transactionId: value[0], resultDigest: mutationDigest(value[1]) };
	},
});

const completeCheckpoint = definePostgresStatement<
	Readonly<{
		application: string;
		runId: string;
		ordinal: number;
		commandDigest: string;
		receiptTransactionId: string;
		receiptResultDigest: string;
	}>,
	string | null,
	"UPDATE"
>({
	name: "checkpoint.complete",
	operation: "UPDATE",
	text: `UPDATE questpie_internal.mutation_checkpoints
SET state = 'completed', receipt_transaction_id = $5::xid8, receipt_result_digest = $6
WHERE application_name = $1 AND run_id = $2 AND ordinal = $3
  AND command_digest = $4 AND state = 'reserved'
RETURNING receipt_transaction_id::text`,
	parameterCount: 6,
	parameters: (input) => [
		input.application,
		input.runId,
		input.ordinal,
		input.commandDigest,
		input.receiptTransactionId,
		input.receiptResultDigest,
	],
	decode(result) {
		const value = row(result, "UPDATE");
		if (value === null) return null;
		if (value.length !== 1 || typeof value[0] !== "string")
			throw new TypeError("invalid Mutation checkpoint completion result");
		return value[0];
	},
});

function prepare(
	runId: string,
	command: MutationCheckpointCommand,
): PreparedCommand {
	const name = checkpointName(command.name);
	const position = ordinal(command.ordinal);
	const operation = text(command.operation, "operation");
	if (
		!operation.startsWith("mutation:") ||
		operation.length === "mutation:".length
	)
		throw new TypeError("invalid Mutation checkpoint Mutation identity");
	const contractDigest = digest(command.contractDigest, "contract digest");
	const runtimeGraphDigest = digest(
		command.runtimeGraphDigest,
		"Runtime Graph digest",
	);
	const encodedInput = encodeRuntimeCodec(
		command.inputCodec,
		decodeRuntimeCodec(command.inputCodec, command.input),
	);
	const inputBytes = canonicalMutationBytes(encodedInput);
	if (inputBytes.byteLength > 1_048_576)
		throw new DurableCheckpointError("RESOURCE_LIMIT");
	const inputDigest = mutationDigest(inputBytes);
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

function storedResultFailure(error: unknown): never {
	if (
		error instanceof QuestpiePostgresError &&
		error.code === "invalidResult" &&
		error.phase === "statement" &&
		(error.statementName === readCheckpointHistory.name ||
			error.statementName === readCheckpoint.name ||
			error.statementName === readCommittedReceipt.name)
	)
		throw new DurableCheckpointError();
	throw error;
}

export function createPostgresMutationCheckpointStore(
	input: Readonly<{
		database: PostgresTransactionRunner;
		application: string;
		signal?: AbortSignal;
	}>,
) {
	const control = () => ({
		signal: input.signal
			? AbortSignal.any([input.signal, AbortSignal.timeout(5000)])
			: AbortSignal.timeout(5000),
	});
	const fence = (claim: DurableClaim) => ({
		application: input.application,
		runId: claim.runId,
		attemptId: claim.attemptId,
		leaseTokenDigest: leaseTokenDigest(claim.leaseToken),
	});
	return Object.freeze({
		load(claim: DurableClaim) {
			return input.database
				.transaction({
					control: control(),
					mode: { isolation: "readCommitted", access: "readWrite" },
					use: async (transaction) => {
						await transaction.execute(durableKernelMarker, undefined);
						if (!(await transaction.execute(durableEffectFence, fence(claim))))
							throw new DurableLeaseLost();
						const history = await transaction.execute(readCheckpointHistory, {
							application: input.application,
							runId: claim.runId,
						});
						if (
							history.some(
								(row, index) =>
									row.ordinal !== index + 1 ||
									!matchesLocator(row, claim) ||
									(index < history.length - 1 && row.state !== "completed"),
							)
						)
							throw new DurableCheckpointError();
						return history.length;
					},
				})
				.catch(storedResultFailure);
		},
		async reserve(claim: DurableClaim, rawCommand: MutationCheckpointCommand) {
			const command = prepare(claim.runId, rawCommand);
			return input.database
				.transaction({
					control: control(),
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
							receiptTransactionId: stored.receiptTransactionId,
							receiptResultDigest: stored.receiptResultDigest,
						});
					},
				})
				.catch(storedResultFailure);
		},
		async complete(
			claim: DurableClaim,
			rawCommand: MutationCheckpointCommand,
			resultDigest: string,
		) {
			const command = prepare(claim.runId, rawCommand);
			return input.database
				.transaction({
					control: control(),
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
						if (
							stored.state === "completed" &&
							stored.receiptResultDigest !== resultDigest
						)
							return Object.freeze({ status: "conflict" as const });
						if (stored.state === "completed")
							return Object.freeze({
								status: "completed" as const,
								receiptTransactionId: stored.receiptTransactionId!,
							});
						const receipt = await transaction.execute(readCommittedReceipt, {
							application: input.application,
							tenantId: stored.tenantId,
							operation: command.operation,
							principalKind: stored.principalKind,
							principalId: stored.principalId,
							callId: command.callId,
							inputDigest: command.inputDigest,
						});
						if (receipt === null || receipt.resultDigest !== resultDigest)
							return Object.freeze({ status: "receiptUnavailable" as const });
						const receiptTransactionId = receipt.transactionId;
						const completed = await transaction.execute(completeCheckpoint, {
							application: input.application,
							runId: claim.runId,
							ordinal: command.ordinal,
							commandDigest: command.commandDigest,
							receiptTransactionId,
							receiptResultDigest: resultDigest,
						});
						if (completed !== receiptTransactionId)
							throw new TypeError(
								"Mutation checkpoint completion did not advance",
							);
						return Object.freeze({
							status: "completed" as const,
							receiptTransactionId,
						});
					},
				})
				.catch(storedResultFailure);
		},
	});
}
