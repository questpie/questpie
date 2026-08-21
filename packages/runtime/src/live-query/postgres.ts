import type { SQL } from "bun";

import { isPostgresTransactionId } from "../operation";
import {
	definePostgresStatement,
	QuestpiePostgresError,
	type PostgresTransactionRunner,
} from "../postgres";
import type { PostgresLiveQueryInvalidationEffect } from "./postgres-durable-invalidation";

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

export type ChangeLedgerFactV1 = Readonly<{
	factIdentity: string;
	factId: string;
	transactionId: string;
	collection: string;
	kind: "collection" | "delete" | "insert" | "truncate" | "update";
	oldKey: Readonly<Record<string, unknown>> | null;
	newKey: Readonly<Record<string, unknown>> | null;
	conservative: boolean;
	capturedAt: Date;
}>;

export type ChangeReconciliationResultV1 = Readonly<{
	priorHorizon: string;
	nextHorizon: string;
	facts: readonly ChangeLedgerFactV1[];
}>;

type PostgresChangeReconciliationCommon = Readonly<{
	application: string;
	consumer: string;
	apply(
		facts: readonly ChangeLedgerFactV1[],
		horizon: Readonly<{ prior: string; next: string }>,
	): void | Promise<void>;
	effect?: PostgresLiveQueryInvalidationEffect;
	signal?: AbortSignal;
}>;

type PostgresChangeReconciliationInput =
	| (PostgresChangeReconciliationCommon &
			Readonly<{ database: PostgresTransactionRunner; sql?: never }>)
	| (PostgresChangeReconciliationCommon &
			Readonly<{ database?: never; sql: SQL }>);
type ConsumerIdentity = Readonly<{ application: string; consumer: string }>;
type ConsumerHorizon = ConsumerIdentity & Readonly<{ nextHorizon: string }>;
const uuidPattern =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const positiveIntegerPattern = /^[1-9][0-9]*$/;
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

function text(value: unknown, path: string): string {
	if (typeof value !== "string" || value.length === 0)
		throw new TypeError(`${path} must be nonempty text`);
	return value;
}

function key(
	value: unknown,
	path: string,
): Readonly<Record<string, unknown>> | null {
	if (value === null) return null;
	if (typeof value !== "object" || Array.isArray(value))
		throw new TypeError(`${path} must be a PostgreSQL JSON object or null`);
	return Object.freeze({ ...(value as Readonly<Record<string, unknown>>) });
}

function decodeFact(row: Row, index: number): ChangeLedgerFactV1 {
	const path = `Change Ledger fact ${index}`;
	const factIdentity = text(row.factIdentity, `${path} identity`);
	if (!uuidPattern.test(factIdentity))
		throw new TypeError(`${path} identity must be a canonical UUID`);
	const factId = text(row.factId, `${path} local sequence`);
	if (!positiveIntegerPattern.test(factId))
		throw new TypeError(`${path} local sequence is invalid`);
	const transactionId = text(row.transactionId, `${path} transaction`);
	if (!isPostgresTransactionId(transactionId))
		throw new TypeError(`${path} transaction must be canonical xid8`);
	const collection = text(row.collection, `${path} Collection`);
	if (!collection.startsWith("collection:"))
		throw new TypeError(`${path} Collection identity is invalid`);
	if (
		row.kind !== "collection" &&
		row.kind !== "delete" &&
		row.kind !== "insert" &&
		row.kind !== "truncate" &&
		row.kind !== "update"
	)
		throw new TypeError(`${path} kind is invalid`);
	if (typeof row.conservative !== "boolean")
		throw new TypeError(`${path} conservative marker is invalid`);
	if (
		!(row.capturedAt instanceof Date) ||
		!Number.isFinite(row.capturedAt.getTime())
	)
		throw new TypeError(`${path} capture time is invalid`);
	const oldKey = key(row.oldKey, `${path} old key`);
	const newKey = key(row.newKey, `${path} new key`);
	if (
		row.conservative
			? oldKey !== null || newKey !== null
			: oldKey === null && newKey === null
	)
		throw new TypeError(`${path} key shape is invalid`);
	return Object.freeze({
		factIdentity,
		factId,
		transactionId,
		collection,
		kind: row.kind,
		oldKey,
		newKey,
		conservative: row.conservative,
		capturedAt: new Date(row.capturedAt.getTime()),
	});
}

function decodeHorizon(row: Row | undefined): Readonly<{
	priorHorizon: string;
	nextHorizon: string;
}> {
	if (!row) throw new TypeError("Change reconciliation horizon is unavailable");
	const priorHorizon = text(row.priorHorizon, "prior reconciliation horizon");
	const nextHorizon = text(row.nextHorizon, "next reconciliation horizon");
	if (
		!isPostgresTransactionId(priorHorizon) ||
		!isPostgresTransactionId(nextHorizon) ||
		BigInt(nextHorizon) < BigInt(priorHorizon)
	)
		throw new TypeError("Change reconciliation horizon is invalid");
	return Object.freeze({ priorHorizon, nextHorizon });
}
const initializeConsumer = definePostgresStatement({
	name: "live-query.reconciliation-consumer-initialize",
	text: `INSERT INTO questpie_internal.reconciliation_consumers
  (application_name, consumer_id, xid_horizon, acknowledged_at)
VALUES ($1, $2, pg_catalog.pg_snapshot_xmin(pg_catalog.pg_current_snapshot()), pg_catalog.clock_timestamp())
ON CONFLICT DO NOTHING`,
	parameterCount: 2,
	parameters: (input: ConsumerIdentity) => [input.application, input.consumer],
	decode: () => undefined,
});
const readHorizon = definePostgresStatement({
	name: "live-query.reconciliation-horizon-read",
	text: `SELECT xid_horizon::text,
       pg_catalog.pg_snapshot_xmin(pg_catalog.pg_current_snapshot())::text
FROM questpie_internal.reconciliation_consumers
WHERE application_name = $1 AND consumer_id = $2
FOR UPDATE`,
	parameterCount: 2,
	parameters: (input: ConsumerIdentity) => [input.application, input.consumer],
	decode(result) {
		const row = result.rows[0];
		if (result.rows.length !== 1 || row?.length !== 2)
			throw new TypeError("Change reconciliation horizon is unavailable");
		return decodeHorizon({ priorHorizon: row[0], nextHorizon: row[1] });
	},
});
const readFacts = definePostgresStatement({
	name: "live-query.change-ledger-facts-read",
	text: `SELECT fact_identity::text,
       fact_id::text,
       transaction_id::text,
       collection_identity,
       change_kind,
       old_key,
       new_key,
       conservative,
       captured_at
FROM questpie_internal.change_ledger AS ledger
WHERE application_name = $1
  AND transaction_id >= $3::xid8
  AND transaction_id < $4::xid8
  AND NOT EXISTS (
    SELECT 1
    FROM questpie_internal.processed_change_facts AS processed
    WHERE processed.application_name = ledger.application_name
      AND processed.consumer_id = $2
      AND processed.fact_identity = ledger.fact_identity
  )
ORDER BY transaction_id, fact_id`,
	parameterCount: 4,
	parameters: (
		input: Readonly<{
			application: string;
			consumer: string;
			priorHorizon: string;
			nextHorizon: string;
		}>,
	) => [
		input.application,
		input.consumer,
		input.priorHorizon,
		input.nextHorizon,
	],
	decode(result) {
		return Object.freeze(
			result.rows.map((row, index) => {
				if (row.length !== 9)
					throw new TypeError(`Change Ledger fact ${index} row is invalid`);
				return decodeFact(
					{
						factIdentity: row[0],
						factId: row[1],
						transactionId: row[2],
						collection: row[3],
						kind: row[4],
						oldKey: row[5],
						newKey: row[6],
						conservative: row[7],
						capturedAt: row[8],
					},
					index,
				);
			}),
		);
	},
});
const recordProcessedFacts = definePostgresStatement({
	name: "live-query.change-ledger-facts-record-processed",
	text: `INSERT INTO questpie_internal.processed_change_facts
  (application_name, consumer_id, fact_identity, processed_at)
SELECT $1, $2, fact_identity, pg_catalog.clock_timestamp()
FROM pg_catalog.unnest($3::uuid[]) AS fact_identity
ON CONFLICT DO NOTHING`,
	parameterCount: 3,
	parameters: (
		input: Readonly<{
			application: string;
			consumer: string;
			factIdentities: readonly string[];
		}>,
	) => [input.application, input.consumer, input.factIdentities],
	decode: () => undefined,
});

const advanceHorizon = definePostgresStatement({
	name: "live-query.reconciliation-horizon-advance",
	text: `UPDATE questpie_internal.reconciliation_consumers
SET xid_horizon = $3::xid8, acknowledged_at = pg_catalog.clock_timestamp()
WHERE application_name = $1 AND consumer_id = $2`,
	parameterCount: 3,
	parameters: (input: ConsumerHorizon) => [
		input.application,
		input.consumer,
		input.nextHorizon,
	],
	decode(result) {
		if (result.rowCount !== 1)
			throw new TypeError("Change reconciliation horizon did not advance");
	},
});

async function reconcilePostgresDatabaseChangeLedgerAttempt(
	input: PostgresChangeReconciliationCommon &
		Readonly<{ database: PostgresTransactionRunner }>,
): Promise<ChangeReconciliationResultV1> {
	const application = text(input.application, "Change Ledger application");
	const consumer = text(input.consumer, "Change Ledger consumer");
	if (input.effect && input.effect.consumer !== consumer)
		throw new TypeError(
			"Change Ledger consumer must match the deployment invalidation effect",
		);
	return input.database.transaction({
		mode: { isolation: "repeatableRead", access: "readWrite" },
		control: { signal: input.signal },
		async use(transaction) {
			const identity = { application, consumer };
			await transaction.execute(initializeConsumer, identity);
			const horizon = await transaction.execute(readHorizon, identity);
			const facts = await transaction.execute(readFacts, {
				...identity,
				...horizon,
			});
			await input.apply(facts, {
				prior: horizon.priorHorizon,
				next: horizon.nextHorizon,
			});
			await input.effect?.apply({ application, facts, transaction });
			if (facts.length > 0)
				await transaction.execute(recordProcessedFacts, {
					...identity,
					factIdentities: facts.map(({ factIdentity }) => factIdentity),
				});
			await transaction.execute(advanceHorizon, {
				...identity,
				nextHorizon: horizon.nextHorizon,
			});
			return Object.freeze({
				priorHorizon: horizon.priorHorizon,
				nextHorizon: horizon.nextHorizon,
				facts,
			});
		},
	});
}

async function reconcilePostgresChangeLedgerAttempt(
	input: PostgresChangeReconciliationInput,
): Promise<ChangeReconciliationResultV1> {
	const application = text(input.application, "Change Ledger application");
	const consumer = text(input.consumer, "Change Ledger consumer");
	if (input.effect && input.effect.consumer !== consumer)
		throw new TypeError(
			"Change Ledger consumer must match the deployment invalidation effect",
		);
	const session = await (input.sql as unknown as PostgresPool).reserve();
	let transaction = false;
	try {
		await execute(
			session,
			"BEGIN ISOLATION LEVEL REPEATABLE READ",
			[],
			input.signal,
		);
		transaction = true;
		await execute(
			session,
			`INSERT INTO questpie_internal.reconciliation_consumers
  (application_name, consumer_id, xid_horizon, acknowledged_at)
VALUES ($1, $2, pg_catalog.pg_snapshot_xmin(pg_catalog.pg_current_snapshot()), pg_catalog.clock_timestamp())
ON CONFLICT DO NOTHING`,
			[application, consumer],
			input.signal,
		);
		const horizonRows = await execute(
			session,
			`SELECT xid_horizon::text AS "priorHorizon",
       pg_catalog.pg_snapshot_xmin(pg_catalog.pg_current_snapshot())::text AS "nextHorizon"
FROM questpie_internal.reconciliation_consumers
WHERE application_name = $1 AND consumer_id = $2
FOR UPDATE`,
			[application, consumer],
			input.signal,
		);
		const horizon = decodeHorizon(horizonRows[0]);
		const rows = await execute(
			session,
			`SELECT fact_identity::text AS "factIdentity",
       fact_id::text AS "factId",
       transaction_id::text AS "transactionId",
       collection_identity AS collection,
       change_kind AS kind,
       old_key AS "oldKey",
       new_key AS "newKey",
       conservative,
       captured_at AS "capturedAt"
FROM questpie_internal.change_ledger AS ledger
WHERE application_name = $1
  AND transaction_id >= $3::xid8
  AND transaction_id < $4::xid8
  AND NOT EXISTS (
    SELECT 1
    FROM questpie_internal.processed_change_facts AS processed
    WHERE processed.application_name = ledger.application_name
      AND processed.consumer_id = $2
      AND processed.fact_identity = ledger.fact_identity
  )
ORDER BY transaction_id, fact_id`,
			[application, consumer, horizon.priorHorizon, horizon.nextHorizon],
			input.signal,
		);
		const facts = Object.freeze(rows.map(decodeFact));
		await input.apply(facts, {
			prior: horizon.priorHorizon,
			next: horizon.nextHorizon,
		});
		await input.effect?.apply({
			application,
			facts,
			execute: (statement, parameters = []) =>
				execute(session, statement, parameters, input.signal),
		});
		if (facts.length > 0) {
			const factIdentities = `{${facts
				.map(({ factIdentity }) => factIdentity)
				.join(",")}}`;
			await execute(
				session,
				`INSERT INTO questpie_internal.processed_change_facts
  (application_name, consumer_id, fact_identity, processed_at)
SELECT $1, $2, fact_identity, pg_catalog.clock_timestamp()
FROM pg_catalog.unnest($3::uuid[]) AS fact_identity
ON CONFLICT DO NOTHING`,
				[application, consumer, factIdentities],
				input.signal,
			);
		}
		await execute(
			session,
			`UPDATE questpie_internal.reconciliation_consumers
SET xid_horizon = $3::xid8, acknowledged_at = pg_catalog.clock_timestamp()
WHERE application_name = $1 AND consumer_id = $2`,
			[application, consumer, horizon.nextHorizon],
			input.signal,
		);
		await execute(session, "COMMIT", [], input.signal);
		transaction = false;
		return Object.freeze({
			priorHorizon: horizon.priorHorizon,
			nextHorizon: horizon.nextHorizon,
			facts,
		});
	} catch (error) {
		if (transaction) {
			try {
				await execute(session, "ROLLBACK");
			} catch {
				// A disconnected PostgreSQL session already rolled the transaction back.
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
}

function isSerializationFailure(error: unknown): boolean {
	if (error instanceof QuestpiePostgresError)
		return error.code === "serializationFailure";
	if (!error || typeof error !== "object") return false;
	return (error as Readonly<{ errno?: unknown }>).errno === "40001";
}

function waitForReconciliationRetry(
	attempt: number,
	signal?: AbortSignal,
): Promise<void> {
	signal?.throwIfAborted();
	const ceilingMilliseconds = Math.min(2 ** (attempt - 1), 64);
	const delayMilliseconds = Math.floor(Math.random() * ceilingMilliseconds) + 1;
	return new Promise((resolve, reject) => {
		const aborted = () => {
			clearTimeout(timer);
			reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
		};
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", aborted);
			resolve();
		}, delayMilliseconds);
		signal?.addEventListener("abort", aborted, { once: true });
		if (signal?.aborted) aborted();
	});
}

export async function reconcilePostgresChangeLedger(
	input: PostgresChangeReconciliationInput,
): Promise<ChangeReconciliationResultV1> {
	for (let attempt = 1; ; attempt += 1) {
		try {
			return input.database !== undefined
				? await reconcilePostgresDatabaseChangeLedgerAttempt({
						...input,
						database: input.database,
					})
				: await reconcilePostgresChangeLedgerAttempt(input);
		} catch (error) {
			if (!isSerializationFailure(error) || attempt === 16) throw error;
			await waitForReconciliationRetry(attempt, input.signal);
		}
	}
}
