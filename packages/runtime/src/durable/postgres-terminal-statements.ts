import {
	definePostgresStatement,
	type PostgresStatement,
} from "../postgres/contract";
import type { DurableFailureCode } from "./rows";

const failureCodes: ReadonlySet<string> = new Set([
	"EFFECT_AMBIGUOUS",
	"EFFECT_CONFLICT",
	"HANDLER_FAILED",
	"REACTION_ERROR",
	"RESOURCE_LIMIT",
	"RETRY_EXHAUSTED",
	"RUN_AS_DENIED",
	"VALIDATION_FAILED",
]);

function text(value: string, label: string): string {
	if (value.length === 0 || value.includes("\0"))
		throw new TypeError(`invalid PostgreSQL Durable ${label}`);
	return value;
}

function uuid(value: string, label: string): string {
	if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(value))
		throw new TypeError(`invalid PostgreSQL Durable ${label}`);
	return value;
}

function digest(value: string): string {
	if (!/^[0-9a-f]{64}$/u.test(value))
		throw new TypeError("invalid PostgreSQL Durable lease token digest");
	return value;
}

function failureCode(value: DurableFailureCode): DurableFailureCode {
	if (!failureCodes.has(value))
		throw new TypeError("invalid PostgreSQL Durable failure code");
	return value;
}

function bytes(value: Uint8Array | null): Uint8Array | null {
	if (
		value !== null &&
		(!(value instanceof Uint8Array) || value.length > 262_144)
	)
		throw new TypeError("invalid PostgreSQL Durable result bytes");
	return value;
}

type RunTransitionResult = Readonly<{ state: string }> | null;

function transitionResult(
	result: Readonly<{
		command: string;
		rowCount: number | null;
		rows: readonly (readonly unknown[])[];
	}>,
	states: ReadonlySet<string>,
	label: string,
): RunTransitionResult {
	if (
		result.command !== "UPDATE" ||
		result.rowCount === null ||
		result.rowCount !== result.rows.length ||
		result.rowCount < 0 ||
		result.rowCount > 1
	)
		throw new TypeError(`invalid PostgreSQL Durable ${label} result`);
	if (result.rowCount === 0) return null;
	const row = result.rows[0];
	if (row?.length !== 1 || typeof row[0] !== "string" || !states.has(row[0]))
		throw new TypeError(`invalid PostgreSQL Durable ${label} result`);
	return Object.freeze({ state: row[0] });
}

export type DurableRunTerminalInput = Readonly<{
	application: string;
	runId: string;
	attemptId: string;
	leaseTokenDigest: string;
	state: "cancelled" | "failed" | "succeeded";
	resultBytes: Uint8Array | null;
	failureCode: DurableFailureCode | null;
	deadLetter: boolean;
}>;

const terminalStates: ReadonlySet<string> = new Set([
	"cancelled",
	"failed",
	"succeeded",
]);

export const durableRunTerminal: PostgresStatement<
	DurableRunTerminalInput,
	RunTransitionResult
> = definePostgresStatement({
	name: "durable.terminal.run",
	text: `UPDATE questpie_internal.durable_runs
SET state = $5, current_attempt_id = NULL, lease_token_digest = NULL, lease_expires_at = NULL,
    result_bytes = $6, failure_code = $7, dead_letter = $8,
    terminal_at = pg_catalog.transaction_timestamp()
WHERE application_name = $1 AND run_id = $2
  AND current_attempt_id = $3 AND lease_token_digest = $4
RETURNING state`,
	parameterCount: 8,
	parameters(input) {
		const valid =
			(input.state === "succeeded" &&
				input.resultBytes !== null &&
				input.failureCode === null &&
				!input.deadLetter) ||
			(input.state === "cancelled" &&
				input.resultBytes === null &&
				input.failureCode === null &&
				!input.deadLetter) ||
			(input.state === "failed" &&
				input.resultBytes === null &&
				input.failureCode !== null &&
				input.deadLetter);
		if (!valid)
			throw new TypeError("invalid PostgreSQL Durable terminal state");
		return [
			text(input.application, "application identity"),
			uuid(input.runId, "run identity"),
			uuid(input.attemptId, "attempt identity"),
			digest(input.leaseTokenDigest),
			input.state,
			bytes(input.resultBytes),
			input.failureCode === null ? null : failureCode(input.failureCode),
			input.deadLetter,
		];
	},
	decode: (result) => transitionResult(result, terminalStates, "terminal run"),
});

export type DurableRunRetryInput = Readonly<{
	application: string;
	runId: string;
	attemptId: string;
	leaseTokenDigest: string;
	failureCode: DurableFailureCode;
	delaySeconds: number;
}>;

export const durableRunRetry: PostgresStatement<
	DurableRunRetryInput,
	RunTransitionResult
> = definePostgresStatement({
	name: "durable.retry.run",
	text: `UPDATE questpie_internal.durable_runs
SET state = 'delayed', current_attempt_id = NULL, lease_token_digest = NULL,
    lease_expires_at = NULL, failure_code = $5,
    available_at = LEAST(
      pg_catalog.transaction_timestamp() + make_interval(secs => $6::double precision),
      horizon_at
    )
WHERE application_name = $1 AND run_id = $2
  AND current_attempt_id = $3 AND lease_token_digest = $4
RETURNING state`,
	parameterCount: 6,
	parameters: (input) => {
		if (
			!Number.isFinite(input.delaySeconds) ||
			input.delaySeconds < 0 ||
			input.delaySeconds > 900
		)
			throw new TypeError("invalid PostgreSQL Durable retry delay");
		return [
			text(input.application, "application identity"),
			uuid(input.runId, "run identity"),
			uuid(input.attemptId, "attempt identity"),
			digest(input.leaseTokenDigest),
			failureCode(input.failureCode),
			input.delaySeconds,
		];
	},
	decode: (result) =>
		transitionResult(result, new Set(["delayed"]), "retry run"),
});

export type DurableAttemptCompleteInput = Readonly<{
	application: string;
	attemptId: string;
	outcome: "cancelled" | "failed" | "succeeded";
	failureCode: DurableFailureCode | null;
}>;

export const durableAttemptComplete: PostgresStatement<
	DurableAttemptCompleteInput,
	void
> = definePostgresStatement({
	name: "durable.terminal.attempt",
	text: `UPDATE questpie_internal.durable_attempts
SET outcome = $3, failure_code = $4
WHERE application_name = $1 AND attempt_id = $2`,
	parameterCount: 4,
	parameters: (input) => {
		if ((input.outcome === "failed") !== (input.failureCode !== null))
			throw new TypeError("invalid PostgreSQL Durable attempt outcome");
		return [
			text(input.application, "application identity"),
			uuid(input.attemptId, "attempt identity"),
			input.outcome,
			input.failureCode === null ? null : failureCode(input.failureCode),
		];
	},
	decode(result) {
		if (
			result.command !== "UPDATE" ||
			result.rowCount !== 1 ||
			result.rows.length !== 0
		)
			throw new TypeError(
				"invalid PostgreSQL Durable attempt completion result",
			);
	},
});
