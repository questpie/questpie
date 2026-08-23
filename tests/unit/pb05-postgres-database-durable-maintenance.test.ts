import { expect, test } from "bun:test";

import { createPostgresDatabaseDurableMaintenance } from "../../packages/runtime/src/durable/postgres-database-maintenance";
import {
	durableMaintenanceAuditInsert,
	durableMaintenanceAuditRead,
	durableMaintenanceCancellationInsert,
	durableMaintenanceEffectAcknowledge,
	durableMaintenanceRunCancelClaimed,
	durableMaintenanceRunReadLocked,
	durableMaintenanceRunRetry,
	durableMaintenanceRunStateRead,
	durableMaintenanceVersionRead,
} from "../../packages/runtime/src/durable/postgres-maintenance-statements";
import {
	durableEventInsert,
	durableEventSequenceBump,
	durableKernelMarker,
} from "../../packages/runtime/src/durable/postgres-statements";
import type {
	PostgresTransaction,
	PostgresTransactionRunner,
} from "../../packages/runtime/src/postgres/contract";

const application = "application:collaboration";
const runId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b6200";
const dispatchId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b6201";
const commandId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b6202";
const cancellationId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b6203";
const actor = Object.freeze({ kind: "user" as const, id: "operator:one" });

function run(state: "ready" | "running" = "running") {
	return Object.freeze({
		state,
		attemptCount: state === "running" ? 1 : 0,
		deadLetter: false,
		resource: "reaction:messagePublished",
		dispatchId,
		causationId: "cause-1",
		correlationId: "correlation-1",
		cancellationRequested: false,
		version: 1,
	});
}

function harness(
	input: Readonly<{
		authorized: boolean;
		state?: "failed" | "running";
	}>,
) {
	const calls: Array<Readonly<{ statement: unknown; value: unknown }>> = [];
	const modes: unknown[] = [];
	const transaction = {
		async execute(statement, value) {
			calls.push({ statement, value });
			if (statement === durableKernelMarker) return undefined;
			if (statement === durableMaintenanceRunStateRead) return "running";
			if (statement === durableMaintenanceRunReadLocked)
				return input.state === "failed"
					? { ...run("ready"), state: "failed", deadLetter: true }
					: run();
			if (statement === durableMaintenanceCancellationInsert) return undefined;
			if (statement === durableMaintenanceRunCancelClaimed) return undefined;
			if (statement === durableMaintenanceRunRetry) return undefined;
			if (statement === durableMaintenanceEffectAcknowledge)
				return "018f5f6e-5f2c-7b41-a854-3d9a6b6b6204";
			if (statement === durableEventSequenceBump) return { sequence: 2 };
			if (statement === durableEventInsert) return undefined;
			if (statement === durableMaintenanceAuditInsert) return undefined;
			if (statement === durableMaintenanceVersionRead) return 2;
			if (statement === durableMaintenanceAuditRead)
				return [
					{
						commandId,
						command: "cancelRun",
						outcome: "applied",
						rejectionCode: null,
						actor,
						stateBefore: "running",
						stateAfter: "running",
						reason: "operator request",
					},
				];
			throw new TypeError("unexpected maintenance statement");
		},
	} as PostgresTransaction;
	const database = {
		transaction: ({ mode, use }) => {
			modes.push(mode);
			return use(transaction);
		},
	} as PostgresTransactionRunner;
	let ids = 0;
	const maintenance = createPostgresDatabaseDurableMaintenance({
		database,
		application,
		authorize: () => input.authorized,
		randomUUID: () => (ids++ === 0 ? commandId : cancellationId),
	});
	return { calls, maintenance, modes };
}

test("Authority denial is audited without taking or disclosing a row lock", async () => {
	const { calls, maintenance, modes } = harness({ authorized: false });
	await expect(
		maintenance.cancelRun({ runId, reason: "operator request", actor }),
	).resolves.toEqual({
		commandId,
		command: "cancelRun",
		outcome: "rejected",
		rejectionCode: "AUTHORITY_DENIED",
		stateBefore: null,
		stateAfter: null,
		version: null,
	});
	expect(modes).toEqual([{ isolation: "readCommitted", access: "readWrite" }]);
	expect(calls.map(({ statement }) => statement)).toEqual([
		durableKernelMarker,
		durableMaintenanceRunStateRead,
		durableMaintenanceAuditInsert,
	]);
});

test("an authorized running cancellation is one marked, audited event transaction", async () => {
	const { calls, maintenance } = harness({ authorized: true });
	await expect(
		maintenance.cancelRun({
			runId,
			reason: "operator request",
			actor,
			expectedVersion: 1,
		}),
	).resolves.toMatchObject({
		outcome: "applied",
		rejectionCode: null,
		stateBefore: "running",
		stateAfter: "running",
		version: 2,
	});
	expect(calls.map(({ statement }) => statement)).toEqual([
		durableKernelMarker,
		durableMaintenanceRunReadLocked,
		durableMaintenanceCancellationInsert,
		durableMaintenanceRunCancelClaimed,
		durableEventSequenceBump,
		durableEventInsert,
		durableMaintenanceAuditInsert,
		durableMaintenanceVersionRead,
	]);
});

test("audit is a marker-free read-only database operation", async () => {
	const { calls, maintenance, modes } = harness({ authorized: true });
	await expect(maintenance.audit(runId)).resolves.toHaveLength(1);
	expect(modes).toEqual([{ isolation: "readCommitted", access: "readOnly" }]);
	expect(calls.map(({ statement }) => statement)).toEqual([
		durableMaintenanceAuditRead,
	]);
});

test("an applied retry appends history and advances its returned fence", async () => {
	const { calls, maintenance } = harness({ authorized: true, state: "failed" });
	await expect(
		maintenance.retryRun({
			runId,
			reason: "retry after operator review",
			actor,
			expectedVersion: 1,
		}),
	).resolves.toMatchObject({
		outcome: "applied",
		stateBefore: "failed",
		stateAfter: "ready",
		version: 2,
	});
	expect(calls.map(({ statement }) => statement)).toEqual([
		durableKernelMarker,
		durableMaintenanceRunReadLocked,
		durableMaintenanceRunRetry,
		durableEventSequenceBump,
		durableEventInsert,
		durableMaintenanceAuditInsert,
		durableMaintenanceVersionRead,
	]);
	expect(
		calls.find(({ statement }) => statement === durableEventInsert)?.value,
	).toMatchObject({ kind: "retryRequested", sequence: 2 });
});

test("audit decoding is intentionally unbounded and actor kinds stay closed", () => {
	const auditRow = [
		commandId,
		"cancelRun",
		"applied",
		null,
		"user",
		"operator:one",
		"running",
		"running",
		"operator request",
	] as const;
	expect(
		durableMaintenanceAuditRead.decode({
			command: "SELECT",
			rowCount: 1_025,
			rows: Array.from({ length: 1_025 }, () => auditRow),
		}),
	).toHaveLength(1_025);
	expect(() =>
		durableMaintenanceCancellationInsert.parameters({
			application,
			cancellationId,
			runId,
			actor: { kind: "machine" as "user", id: "operator:one" },
			reason: "operator request",
		}),
	).toThrow("actor kind");
});

test("ambiguity acknowledgement shares the locked event and audit transaction", async () => {
	const { calls, maintenance } = harness({ authorized: true, state: "failed" });
	await expect(
		maintenance.acknowledgeAmbiguity({
			runId,
			effectName: "deliver-message",
			reason: "operator acknowledged ambiguity",
			actor,
			expectedVersion: 1,
		}),
	).resolves.toMatchObject({ outcome: "applied", version: 2 });
	expect(calls.map(({ statement }) => statement)).toEqual([
		durableKernelMarker,
		durableMaintenanceRunReadLocked,
		durableMaintenanceEffectAcknowledge,
		durableEventSequenceBump,
		durableEventInsert,
		durableMaintenanceAuditInsert,
		durableMaintenanceVersionRead,
	]);
	expect(
		calls.find(({ statement }) => statement === durableEventInsert)?.value,
	).toMatchObject({ kind: "ambiguityAcknowledged", sequence: 2 });
});
