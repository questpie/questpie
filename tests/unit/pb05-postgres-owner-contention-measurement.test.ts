import { expect, test } from "bun:test";

import { createPostgresDatabaseDurableMaintenance } from "../../packages/runtime/src/durable/postgres-database-maintenance";
import { reconcilePostgresChangeLedger } from "../../packages/runtime/src/live-query/postgres";
import { acknowledgePostgresRetainedResult } from "../../packages/runtime/src/live-query/postgres-retention-database";
import {
	transactionBrand,
	type PostgresStatement,
	type PostgresTransactionRunner,
} from "../../packages/runtime/src/postgres";
import {
	createPb05OperationalMeasurement,
	instrumentPb05OwnerContentionRunner,
} from "../support/pb05-operational-measurement";

const application = "application:collaboration";
const runId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b6200";
const digest = "a".repeat(64);

function ownerDatabase(names: string[]): PostgresTransactionRunner {
	return {
		transaction: ({ use }) =>
			use({
				[transactionBrand]: true,
				async execute<Input, Output>(
					statement: PostgresStatement<Input, Output>,
					value: Input,
				): Promise<Output> {
					names.push(statement.name);
					if (statement.name === "durable.maintenance.run.read-locked")
						return {
							state: "running",
							attemptCount: 1,
							deadLetter: false,
							resource: "reaction:messagePublished",
							dispatchId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b6201",
							causationId: "cause-1",
							correlationId: "correlation-1",
							cancellationRequested: false,
							version: 1,
						} as Output;
					if (statement.name === "durable.event.sequence.bump")
						return { sequence: 2 } as Output;
					if (statement.name === "durable.maintenance.version.read")
						return 2 as Output;
					if (statement.name === "live-query.reconciliation-horizon-read")
						return { priorHorizon: "100", nextHorizon: "101" } as Output;
					if (statement.name === "live-query.change-ledger-facts-read")
						return [] as Output;
					if (statement.name === "live-query.retention-result-upsert")
						return (value as { tokenDigest: string }).tokenDigest as Output;
					return undefined as Output;
				},
			}),
	};
}

function measuredOwner(
	owner: "maintenance" | "reconciliation" | "retention",
	lockIdentity: string,
	measurement: ReturnType<typeof createPb05OperationalMeasurement>,
	names: string[],
) {
	const clock = [0, 5, 8];
	return instrumentPb05OwnerContentionRunner({
		database: ownerDatabase(names),
		measurement,
		owner,
		lockIdentity,
		now: () => clock.shift()!,
	});
}

test("measures contention only through actual maintenance, reconciliation, and retention owners", async () => {
	const measurement = createPb05OperationalMeasurement();
	const maintenanceNames: string[] = [];
	const maintenance = createPostgresDatabaseDurableMaintenance({
		database: measuredOwner(
			"maintenance",
			`${application}:${runId}`,
			measurement,
			maintenanceNames,
		),
		application,
		authorize: () => true,
		randomUUID: () => "018f5f6e-5f2c-7b41-a854-3d9a6b6b6202",
	});
	await maintenance.cancelRun({
		runId,
		reason: "operator request",
		actor: { kind: "user", id: "operator:one" },
	});

	const reconciliationNames: string[] = [];
	await reconcilePostgresChangeLedger({
		database: measuredOwner(
			"reconciliation",
			`${application}:consumer:one`,
			measurement,
			reconciliationNames,
		),
		application,
		consumer: "consumer:one",
		apply: async () => undefined,
	});

	const retentionNames: string[] = [];
	await acknowledgePostgresRetainedResult(
		measuredOwner(
			"retention",
			`questpie-retained-result-v1:${application}:${digest}`,
			measurement,
			retentionNames,
		),
		{
			binding: {
				applicationName: application,
				deploymentDigest: digest,
				authorityPartitionDigest: digest,
				queryIdentity: "messages.page",
				inputDigest: digest,
				wireVersion: 1,
				retainedGeneration: 1n,
			},
			resultBytes: new Uint8Array([1]),
			dependencyPlanBytes: new Uint8Array([2]),
		},
		"token-digest",
	);

	expect(maintenanceNames).toContain("durable.maintenance.run.read-locked");
	expect(reconciliationNames).toContain(
		"live-query.reconciliation-horizon-read",
	);
	expect(retentionNames).toContain("live-query.retention-authority-lock");
	expect(
		measurement.snapshot({ requireCompleteInventory: false }).contention,
	).toEqual({
		maintenance: { samples: 1, waitMs: 5, heldMs: 3, acquired: 1 },
		reconciliation: { samples: 1, waitMs: 5, heldMs: 3, acquired: 1 },
		retention: { samples: 1, waitMs: 5, heldMs: 3, acquired: 1 },
	});
});

test("owner contention observer validates before admission and preserves owner failures", async () => {
	let admissions = 0;
	const database: PostgresTransactionRunner = {
		async transaction() {
			admissions += 1;
			throw new Error("must not run");
		},
	};
	expect(() =>
		instrumentPb05OwnerContentionRunner({
			database,
			measurement: createPb05OperationalMeasurement(),
			owner: "unknown",
			lockIdentity: "lock:one",
		}),
	).toThrow("invalid PB-05 owner contention config");
	expect(admissions).toBe(0);

	const primary = new Error("owner transaction failed");
	const failing: PostgresTransactionRunner = {
		async transaction() {
			throw primary;
		},
	};
	const measured = instrumentPb05OwnerContentionRunner({
		database: failing,
		measurement: createPb05OperationalMeasurement(),
		owner: "maintenance",
		lockIdentity: "lock:one",
		now: (() => {
			const clock = [0, Number.NaN];
			return () => clock.shift()!;
		})(),
	});
	let rejected: unknown;
	try {
		await measured.transaction({
			mode: { isolation: "readCommitted", access: "readWrite" },
			use: async () => undefined,
		});
	} catch (error) {
		rejected = error;
	}
	expect(rejected).toBe(primary);
});

test("owner contention observer refuses a successful path that skipped its production lock descriptor", async () => {
	const measured = instrumentPb05OwnerContentionRunner({
		database: ownerDatabase([]),
		measurement: createPb05OperationalMeasurement(),
		owner: "retention",
		lockIdentity: "lock:one",
		now: () => 0,
	});
	await expect(
		measured.transaction({
			mode: { isolation: "readCommitted", access: "readWrite" },
			use: async () => undefined,
		}),
	).rejects.toThrow(
		"PB-05 retention owner did not execute live-query.retention-authority-lock",
	);
});
