import type { SQL } from "bun";

import { decodeRuntimeCodec, encodeRuntimeCodec } from "../codec";
import type { ExecutionFacts } from "../execution";
import { DeclaredOperationError, type PreparedOperation } from "../operation";
import {
	canonicalMutationBytes,
	deterministicUuid,
	mutationDigest,
} from "./canonical";
import {
	createPostgresCollectionMutationData,
	type TransactionQuery,
} from "./collection";
import { CommittedResultUnavailable } from "./committed-result-unavailable";
import { createReactionDispatch, linkReactionProjection } from "./dispatch";
import type { MutationInvoker } from "./index";
import type { LinkedPostgresCollectionOperationPlansV1 } from "./postgres-program";

type Row = Readonly<Record<string, unknown>>;

interface AbortableQuery extends PromiseLike<readonly Row[]> {
	cancel(): AbortableQuery;
	execute(): AbortableQuery;
}

interface TransactionSession {
	unsafe(statement: string, parameters?: readonly unknown[]): AbortableQuery;
	close(options: Readonly<{ timeout: 0 }>): Promise<void>;
	release(): void | Promise<void>;
}

interface PostgresPool {
	reserve(): Promise<TransactionSession>;
}

function bytes(value: unknown, label: string): Uint8Array {
	if (value instanceof Uint8Array) return value;
	throw new TypeError(`${label} must be PostgreSQL bytea`);
}

function text(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0)
		throw new TypeError(`${label} must be text`);
	return value;
}

async function execute(
	session: TransactionSession,
	statement: string,
	parameters: readonly unknown[] = [],
	signal?: AbortSignal,
): Promise<readonly Row[]> {
	signal?.throwIfAborted();
	const query = session.unsafe(statement, parameters).execute();
	const cancel = () => query.cancel();
	signal?.addEventListener("abort", cancel, { once: true });
	if (signal?.aborted) cancel();
	try {
		return await query;
	} finally {
		signal?.removeEventListener("abort", cancel);
	}
}

function errorFactories(definition: Readonly<{ errors?: unknown }>) {
	const raw = definition.errors;
	if (!raw || typeof raw !== "object" || Array.isArray(raw))
		return Object.freeze({});
	return Object.freeze(
		Object.fromEntries(
			Object.entries(raw).map(([key, candidate]) => {
				if (
					!candidate ||
					typeof candidate !== "object" ||
					Array.isArray(candidate)
				)
					throw new TypeError(`Mutation error ${key} is invalid`);
				const item = candidate as Readonly<Record<string, unknown>>;
				if (
					item.kind !== "operationError" ||
					typeof item.code !== "string" ||
					typeof item.status !== "number"
				)
					throw new TypeError(`Mutation error ${key} is invalid`);
				const code = item.code;
				const status = item.status;
				return [
					key,
					(payload: unknown = null) =>
						new DeclaredOperationError(code, status, payload),
				];
			}),
		),
	);
}

function replayResult<View>(
	operation: PreparedOperation<View>,
	resultBytes: unknown,
): unknown {
	const encoded = JSON.parse(
		new TextDecoder().decode(bytes(resultBytes, "receipt result")),
	);
	return decodeRuntimeCodec(operation.output, encoded, "$receipt.result");
}

function inputScopeBytes(
	input: Readonly<{
		application: string;
		tenantId: string;
		operation: string;
		principalKind: string;
		principalId: string;
		callId: string;
		dispatchSlot: string;
	}>,
): Uint8Array {
	return canonicalMutationBytes(input);
}

export function createPostgresMutationInvoker<View>(
	input: Readonly<{
		sql: SQL;
		application: string;
		collectionPlans: LinkedPostgresCollectionOperationPlansV1;
		reactionProjection: unknown;
		facts: ExecutionFacts<
			Readonly<{ tenant: Readonly<{ id: string }>; values: unknown }>
		>;
	}>,
): MutationInvoker<View> {
	const reactionProjection = linkReactionProjection(input.reactionProjection);
	return async (operation, callId, options) => {
		if (
			operation.binding.kind !== "mutation" ||
			callId.length === 0 ||
			callId.length > 256
		)
			throw new TypeError("Mutation call identity is invalid");
		const encodedInput = encodeRuntimeCodec(
			operation.inputCodec,
			operation.input,
		);
		const inputBytes = canonicalMutationBytes(encodedInput);
		if (inputBytes.byteLength > 1_048_576)
			throw new TypeError("Mutation input exceeds its byte limit");
		const inputDigest = mutationDigest(inputBytes);
		const signals = [input.facts.signal, options?.signal].filter(
			(signal): signal is AbortSignal => signal !== undefined,
		);
		signals.push(AbortSignal.timeout(5_000));
		if (options?.deadline !== undefined) {
			if (!Number.isFinite(options.deadline))
				throw new TypeError("Mutation deadline is invalid");
			signals.push(
				AbortSignal.timeout(
					Math.max(0, Math.ceil(options.deadline - Date.now())),
				),
			);
		}
		const signal =
			signals.length === 1 ? signals[0]! : AbortSignal.any(signals);
		const facts = Object.freeze({ ...input.facts, signal });
		const pool = input.sql as unknown as PostgresPool;
		const session = await pool.reserve();
		const transactionStarted = performance.now();
		let transactionState: "preCommit" | "commitSent" | "committed" =
			"preCommit";
		let transactionId: string | null = null;
		const query: TransactionQuery = (statement, parameters = []) =>
			execute(session, statement, parameters, facts.signal);
		try {
			await execute(session, "BEGIN ISOLATION LEVEL READ COMMITTED");
			const owners = await query(
				`INSERT INTO questpie_internal.mutation_call_receipts
  (application_name, tenant_id, operation_name, principal_kind, principal_id, call_id, input_digest, transaction_id, operation_time, outcome)
VALUES ($1, $2, $3, $4, $5, $6, $7, pg_catalog.pg_current_xact_id(), pg_catalog.transaction_timestamp(), 'executing')
ON CONFLICT DO NOTHING
RETURNING transaction_id::text AS "transactionId", operation_time AS "operationTime"`,
				[
					input.application,
					facts.tenant.id,
					operation.binding.identity,
					facts.principal.kind,
					facts.principal.id,
					callId,
					inputDigest,
				],
			);
			if (owners.length === 0) {
				const receipts = await query(
					`SELECT input_digest AS "inputDigest", outcome, result_bytes AS "resultBytes", transaction_id::text AS "transactionId"
FROM questpie_internal.mutation_call_receipts
WHERE application_name = $1 AND tenant_id = $2 AND operation_name = $3 AND principal_kind = $4 AND principal_id = $5 AND call_id = $6`,
					[
						input.application,
						facts.tenant.id,
						operation.binding.identity,
						facts.principal.kind,
						facts.principal.id,
						callId,
					],
				);
				const receipt = receipts[0];
				if (!receipt || receipt.outcome !== "committed")
					throw new TypeError("Mutation receipt is unavailable after conflict");
				if (receipt.inputDigest !== inputDigest)
					throw new DeclaredOperationError("IDEMPOTENCY_CONFLICT", 409, {
						callId,
					});
				const replay = replayResult(operation, receipt.resultBytes);
				transactionId = text(receipt.transactionId, "transaction id");
				transactionState = "commitSent";
				await execute(session, "COMMIT");
				transactionState = "committed";
				return Object.freeze({ committed: true, value: replay });
			}
			const owner = owners[0]!;
			transactionId = text(owner.transactionId, "transaction id");
			if (!(owner.operationTime instanceof Date))
				throw new TypeError("operation time must be a PostgreSQL timestamp");
			let businessRows = 0;
			const data = createPostgresCollectionMutationData({
				plans: input.collectionPlans,
				query,
				facts,
				operationTime: owner.operationTime,
				consumeRows: (count) => {
					businessRows += count;
					if (businessRows > 100)
						throw new TypeError("Mutation exceeded its business row limit");
				},
			});
			const reactions = createReactionDispatch(reactionProjection);
			const ctx = Object.freeze({
				principal: facts.principal,
				authority: facts.authority,
				tenant: facts.tenant,
				values: facts.values,
				signal: facts.signal,
				deadline: options?.deadline ?? facts.deadline,
				data,
				operationTime: owner.operationTime,
				callId,
				transactionId,
				dispatch: reactions.dispatch,
			});
			const result = await operation.binding.execute({
				input: operation.input,
				ctx: ctx as View,
				errors: errorFactories(operation.binding.definition),
			} as never);
			const validated = decodeRuntimeCodec(
				operation.output,
				result,
				"$mutation.result",
			);
			const encodedResult = encodeRuntimeCodec(operation.output, validated);
			const resultBytes = canonicalMutationBytes(encodedResult);
			if (resultBytes.byteLength > 1_048_576)
				throw new TypeError("Mutation result exceeds its byte limit");
			for (const dispatch of reactions.pending) {
				const originKey = inputScopeBytes({
					application: input.application,
					tenantId: facts.tenant.id,
					operation: operation.binding.identity,
					principalKind: facts.principal.kind,
					principalId: facts.principal.id,
					callId,
					dispatchSlot: dispatch.slot,
				});
				const recordId = deterministicUuid(originKey);
				await query(
					`INSERT INTO questpie_internal.pending_reaction_intents
  (application_name, tenant_id, source_operation, principal_kind, principal_id, call_id, dispatch_slot, record_id, reaction_name, input_digest, payload_bytes, transaction_id, recorded_at, state)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, pg_catalog.pg_current_xact_id(), $12, 'pending')`,
					[
						input.application,
						facts.tenant.id,
						operation.binding.identity,
						facts.principal.kind,
						facts.principal.id,
						callId,
						dispatch.slot,
						recordId,
						dispatch.target,
						mutationDigest(dispatch.payloadBytes),
						dispatch.payloadBytes,
						owner.operationTime,
					],
				);
			}
			await query(
				`UPDATE questpie_internal.mutation_call_receipts
SET outcome = 'committed', result_bytes = $7, committed_at = $8
WHERE application_name = $1 AND tenant_id = $2 AND operation_name = $3 AND principal_kind = $4 AND principal_id = $5 AND call_id = $6`,
				[
					input.application,
					facts.tenant.id,
					operation.binding.identity,
					facts.principal.kind,
					facts.principal.id,
					callId,
					resultBytes,
					owner.operationTime,
				],
			);
			facts.signal.throwIfAborted();
			if (performance.now() - transactionStarted > 5_000)
				throw new TypeError("Mutation exceeded its transaction duration limit");
			transactionState = "commitSent";
			await execute(session, "COMMIT");
			transactionState = "committed";
			return Object.freeze({ committed: true, value: validated });
		} catch (error) {
			if (transactionState === "commitSent") {
				if (transactionId === null)
					throw new TypeError(
						"Committed mutation transaction identity is unavailable",
						{ cause: error },
					);
				throw new CommittedResultUnavailable(callId, transactionId, error);
			}
			if (transactionState === "preCommit") {
				try {
					await execute(session, "ROLLBACK");
				} catch {
					// PostgreSQL already rolled back a disconnected transaction.
				}
			}
			throw error;
		} finally {
			try {
				await session.release();
			} catch {
				await session.close({ timeout: 0 }).catch(() => {});
			}
		}
	};
}
