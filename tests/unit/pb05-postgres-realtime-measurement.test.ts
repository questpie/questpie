import { expect, test } from "bun:test";

import {
	canonicalJsonLine,
	sha256Digest,
} from "../../packages/runtime/src/canonical-json";
import {
	createPostgresLiveQueryInvalidationEffect,
	createPostgresLiveQueryRetention,
	reconcilePostgresChangeLedger,
	type PostgresLiveQueryInvalidationEffect,
} from "../../packages/runtime/src/live-query";
import {
	transactionBrand,
	type PostgresTransactionRunner,
} from "../../packages/runtime/src/postgres";
import {
	createPb05OperationalMeasurement,
	instrumentPb05OwnedTransaction,
	instrumentPb05TransactionRunner,
} from "../support/pb05-operational-measurement";

const deploymentDigest = "a".repeat(64);

function observedPlanBytes(): Uint8Array {
	const plan = {
		format: "questpie.observed-live-query-plan" as const,
		version: 1 as const,
		query: "query:messages.page",
		tokens: [
			{
				kind: "collectionRange" as const,
				collection: "collection:messages",
				detail: { conservative: true },
			},
		],
	};
	return canonicalJsonLine({
		...plan,
		digest: sha256Digest(
			Buffer.concat([
				Buffer.from("questpie-observed-live-query-plan-v1\0"),
				canonicalJsonLine(plan),
			]),
		),
	});
}

test("attributes reconciliation, apply, and retention without inventing a transaction", async () => {
	const measurement = createPb05OperationalMeasurement();
	const names: string[] = [];
	const modes: unknown[] = [];
	let transactions = 0;
	const planBytes = observedPlanBytes();
	const fact = Object.freeze({
		factIdentity: "00000000-0000-4000-a000-000000000007",
		factId: "7",
		transactionId: "101",
		collection: "collection:messages",
		kind: "insert" as const,
		oldKey: null,
		newKey: { id: "message-new" },
		conservative: false,
		capturedAt: new Date("2026-08-16T00:00:00.000Z"),
	});
	const unmeasured: PostgresTransactionRunner = {
		transaction: ({ mode, use }) => {
			transactions += 1;
			modes.push(mode);
			return use({
				[transactionBrand]: true,
				async execute(statement) {
					names.push(statement.name);
					if (statement.name === "live-query.reconciliation-horizon-read")
						return { priorHorizon: "100", nextHorizon: "102" } as never;
					if (statement.name === "live-query.change-ledger-facts-read")
						return [fact] as never;
					if (
						statement.name === "live-query.observed-plans-read-for-invalidation"
					)
						return [
							{
								scopeIdentity: "scope:one",
								bindingIdentity: "binding:one",
								queryIdentity: "query:messages.page",
								planDigest: sha256Digest(planBytes),
								planBytes,
							},
						] as never;
					if (statement.name === "live-query.retention-expired-delete")
						return 2 as never;
					if (statement.name === "live-query.retention-ledger-delete")
						return 3 as never;
					return undefined as never;
				},
			});
		},
	};
	const reconciliationDatabase = instrumentPb05TransactionRunner({
		database: unmeasured,
		measurement,
		population: "realtime",
		operation: "reconciliation",
	});
	const invalidation = createPostgresLiveQueryInvalidationEffect({
		deploymentDigest,
		fanoutPerBatch: 16,
	});
	const effect: PostgresLiveQueryInvalidationEffect = Object.freeze({
		consumer: invalidation.consumer,
		apply: (input) => {
			if (input.transaction === undefined)
				throw new TypeError("expected an owned reconciliation transaction");
			return invalidation.apply({
				...input,
				transaction: instrumentPb05OwnedTransaction({
					transaction: input.transaction,
					measurement,
					population: "realtime",
					operation: "apply",
				}),
			});
		},
	});
	const applied: string[] = [];

	await expect(
		reconcilePostgresChangeLedger({
			database: reconciliationDatabase,
			application: "application:collaboration",
			consumer: invalidation.consumer,
			effect,
			apply: (facts) => {
				applied.push(...facts.map(({ factIdentity }) => factIdentity));
			},
		}),
	).resolves.toEqual({
		priorHorizon: "100",
		nextHorizon: "102",
		facts: [fact],
	});

	const retentionDatabase = instrumentPb05TransactionRunner({
		database: unmeasured,
		measurement,
		population: "realtime",
		operation: "retention",
	});
	const retention = createPostgresLiveQueryRetention({
		database: retentionDatabase,
		hmacKey: new Uint8Array(32).fill(7),
	});
	await expect(
		retention.prune({ applicationName: "collaboration" }),
	).resolves.toEqual({ retainedResults: 2, ledgerFacts: 3 });

	expect(applied).toEqual([fact.factIdentity]);
	expect(transactions).toBe(2);
	expect(modes).toEqual([
		{ isolation: "repeatableRead", access: "readWrite" },
		{ isolation: "readCommitted", access: "readWrite" },
	]);
	expect(names).toEqual([
		"live-query.reconciliation-consumer-initialize",
		"live-query.reconciliation-horizon-read",
		"live-query.change-ledger-facts-read",
		"live-query.observed-plans-read-for-invalidation",
		"live-query.observed-bindings-invalidate",
		"live-query.change-ledger-facts-record-processed",
		"live-query.reconciliation-horizon-advance",
		"live-query.retention-expired-delete",
		"live-query.retention-ledger-delete",
	]);
	const snapshot = measurement.snapshot({ requireCompleteInventory: false });
	expect(snapshot.populations.realtime).toEqual({
		statementExecutions: 9,
		distinctStatements: 9,
		transactions: 2,
	});
	expect(snapshot.operations["realtime:reconciliation"]).toMatchObject({
		statementExecutions: 5,
		distinctStatements: [
			"live-query.reconciliation-consumer-initialize",
			"live-query.reconciliation-horizon-read",
			"live-query.change-ledger-facts-read",
			"live-query.change-ledger-facts-record-processed",
			"live-query.reconciliation-horizon-advance",
		],
		transactions: 1,
	});
	expect(snapshot.operations["realtime:apply"]).toMatchObject({
		statementExecutions: 2,
		distinctStatements: [
			"live-query.observed-plans-read-for-invalidation",
			"live-query.observed-bindings-invalidate",
		],
		transactions: 1,
	});
	expect(snapshot.operations["realtime:retention"]).toMatchObject({
		statementExecutions: 2,
		distinctStatements: [
			"live-query.retention-expired-delete",
			"live-query.retention-ledger-delete",
		],
		transactions: 1,
	});
});
