import { expect, test } from "bun:test";

import { principal } from "questpie";

import {
	createPostgresDatabaseDurableEffectLedger,
	createPostgresDatabaseDurableKernel,
	createPostgresDatabaseDurablePrincipalMaintenance,
	createPostgresDatabaseMutationInvoker,
} from "../../packages/runtime/src/bundle-core";
import {
	createPostgresDatabaseDurableEffectLedger as createEffectFromDurable,
	createPostgresDatabaseDurableKernel as createKernelFromDurable,
	createPostgresDatabaseDurablePrincipalMaintenance as createMaintenanceFromDurable,
	type LinkedReactionProjection,
} from "../../packages/runtime/src/durable";
import {
	durableMaintenanceAuditInsert,
	durableMaintenanceRunStateRead,
} from "../../packages/runtime/src/durable/postgres-maintenance-statements";
import { durableAdmissionSelect } from "../../packages/runtime/src/durable/postgres-scheduling-statements";
import {
	durableEffectRead,
	durableKernelMarker,
} from "../../packages/runtime/src/durable/postgres-statements";
import { createPostgresDatabaseMutationInvoker as createMutationFromDomain } from "../../packages/runtime/src/mutation";
import {
	transactionBrand,
	type PostgresTransactionRunner,
} from "../../packages/runtime/src/postgres";

const application = "application:collaboration";
const runId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b6200";
const commandId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b6201";
const reactions = {
	byIdentity: new Map(),
} as unknown as LinkedReactionProjection;

test("private bundle-core exposes the database-mode domain facades", () => {
	expect(createPostgresDatabaseMutationInvoker).toBe(createMutationFromDomain);
	expect(createPostgresDatabaseDurableKernel).toBe(createKernelFromDurable);
	expect(createPostgresDatabaseDurableEffectLedger).toBe(
		createEffectFromDurable,
	);
	expect(createPostgresDatabaseDurablePrincipalMaintenance).toBe(
		createMaintenanceFromDurable,
	);
});

test("database-mode Durable facades share only the injected transaction runner", async () => {
	const modes: unknown[] = [];
	const statements: object[] = [];
	let transactions = 0;
	const database: PostgresTransactionRunner = {
		transaction(input) {
			transactions += 1;
			modes.push(input.mode);
			return input.use({
				[transactionBrand]: true,
				async execute(statement) {
					statements.push(statement);
					if (statement === durableAdmissionSelect) return [] as never;
					if (statement === durableEffectRead) return [] as never;
					if (statement === durableKernelMarker) return undefined as never;
					if (statement === durableMaintenanceRunStateRead)
						return "running" as never;
					if (statement === durableMaintenanceAuditInsert)
						return undefined as never;
					throw new TypeError("unexpected database facade statement");
				},
			});
		},
	};
	const kernel = createPostgresDatabaseDurableKernel({
		database,
		application,
		reactions,
	});
	const effects = createPostgresDatabaseDurableEffectLedger({
		database,
		application,
	});
	const maintenance = createPostgresDatabaseDurablePrincipalMaintenance({
		database,
		application,
		authorize: () => false,
		randomUUID: () => commandId,
	});

	await expect(kernel.admit(1)).resolves.toEqual([]);
	await expect(effects.read(runId)).resolves.toEqual([]);
	await expect(
		maintenance.cancelRun({
			runId,
			reason: "operator request",
			actor: principal.user({ id: "operator:one" }),
		}),
	).resolves.toEqual({
		commandId,
		command: "cancelRun",
		outcome: "rejected",
		rejectionCode: "AUTHORITY_DENIED",
		stateBefore: null,
		stateAfter: null,
		version: null,
	});

	expect(transactions).toBe(3);
	expect(modes).toEqual([
		{ isolation: "readCommitted", access: "readOnly" },
		{ isolation: "readCommitted", access: "readOnly" },
		{ isolation: "readCommitted", access: "readWrite" },
	]);
	expect(statements).toEqual([
		durableAdmissionSelect,
		durableEffectRead,
		durableKernelMarker,
		durableMaintenanceRunStateRead,
		durableMaintenanceAuditInsert,
	]);
});

test("database-mode facades preserve runner errors and cancellation identity", async () => {
	const primary = new Error("database facade failed");
	const cancellation = new DOMException(
		"database facade cancelled",
		"AbortError",
	);
	const failing = (failure: unknown): PostgresTransactionRunner => ({
		transaction: () => Promise.reject(failure),
	});
	const kernel = createPostgresDatabaseDurableKernel({
		database: failing(cancellation),
		application,
		reactions,
	});
	const effects = createPostgresDatabaseDurableEffectLedger({
		database: failing(primary),
		application,
	});
	const maintenance = createPostgresDatabaseDurablePrincipalMaintenance({
		database: failing(primary),
		application,
		authorize: () => true,
	});

	await expect(kernel.admit(1)).rejects.toBe(cancellation);
	await expect(effects.read(runId)).rejects.toBe(primary);
	await expect(maintenance.audit(runId)).rejects.toBe(primary);
});

test("database-mode Principal maintenance rejects a forged actor before database work", async () => {
	let transactions = 0;
	const maintenance = createPostgresDatabaseDurablePrincipalMaintenance({
		database: {
			transaction: () => {
				transactions += 1;
				return Promise.reject(new Error("database must not run"));
			},
		},
		application,
		authorize: () => true,
	});
	expect(() =>
		maintenance.cancelRun({
			runId,
			reason: "operator request",
			actor: { kind: "user", id: "operator:forged" } as never,
		}),
	).toThrow("durable maintenance requires a trusted Principal");
	expect(transactions).toBe(0);
});
