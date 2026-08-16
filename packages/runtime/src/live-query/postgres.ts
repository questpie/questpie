import type { SQL } from "bun";

import { isPostgresTransactionId } from "../operation";

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

export async function reconcilePostgresChangeLedger(
	input: Readonly<{
		sql: SQL;
		application: string;
		consumer: string;
		apply(
			facts: readonly ChangeLedgerFactV1[],
			horizon: Readonly<{ prior: string; next: string }>,
		): void | Promise<void>;
		signal?: AbortSignal;
	}>,
): Promise<ChangeReconciliationResultV1> {
	const application = text(input.application, "Change Ledger application");
	const consumer = text(input.consumer, "Change Ledger consumer");
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
