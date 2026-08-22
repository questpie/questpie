import { expect, test } from "bun:test";

import { createPostgresDatabaseDurableTerminal } from "../../packages/runtime/src/durable/postgres-database-terminal";
import {
	durableEventInsert,
	durableEventSequenceBump,
	durableKernelMarker,
} from "../../packages/runtime/src/durable/postgres-statements";
import {
	durableAttemptComplete,
	durableRunRetry,
	durableRunTerminal,
} from "../../packages/runtime/src/durable/postgres-terminal-statements";
import type { DurableClaim } from "../../packages/runtime/src/durable/rows";
import type {
	PostgresTransaction,
	PostgresTransactionRunner,
} from "../../packages/runtime/src/postgres/contract";

const claim = Object.freeze({
	runId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b6200",
	dispatchId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b6201",
	resource: "reaction:messagePublished",
	attemptId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b6202",
	attemptNumber: 1,
	leaseToken: "lease-token",
	leaseMilliseconds: 30_000,
	leaseExpiresAt: new Date("2026-08-22T00:00:30.000Z"),
	deadlineAt: new Date("2026-08-22T00:05:00.000Z"),
	workerId: "worker-1",
	tenantId: "tenant-1",
	principal: { kind: "user", id: "principal-1" },
	contextInputBytes: new Uint8Array([1]),
	payloadBytes: new Uint8Array([2]),
	retry: {
		maximumAttempts: 3,
		initialDelayMilliseconds: 1_000,
		backoff: "exponential",
		maximumDelayMilliseconds: 60_000,
		jitter: "full",
		horizonMilliseconds: 86_400_000,
	},
	runtimeBuildDigest: "a".repeat(64),
	executableDigest: "b".repeat(64),
	causationId: "cause",
	correlationId: "correlation",
	cancellationRequested: false,
}) satisfies DurableClaim;

function harness(input?: Readonly<{ runApplied?: boolean }>) {
	const calls: Array<Readonly<{ statement: unknown; value: unknown }>> = [];
	const transaction = {
		async execute(statement, value) {
			calls.push({ statement, value });
			if (statement === durableKernelMarker) return undefined;
			if (statement === durableRunTerminal)
				return input?.runApplied === false
					? null
					: { state: (value as { state: string }).state };
			if (statement === durableRunRetry)
				return input?.runApplied === false ? null : { state: "delayed" };
			if (statement === durableAttemptComplete) return undefined;
			if (statement === durableEventSequenceBump) return { sequence: 2 };
			if (statement === durableEventInsert) return undefined;
			throw new TypeError("unexpected terminal statement");
		},
	} as PostgresTransaction;
	const database = {
		transaction: ({ mode, use }) => {
			expect(mode).toEqual({ isolation: "readCommitted", access: "readWrite" });
			return use(transaction);
		},
	} as PostgresTransactionRunner;
	return {
		calls,
		terminal: createPostgresDatabaseDurableTerminal({
			database,
			application: "application:collaboration",
			random: () => 0.5,
		}),
	};
}

test("applies success and cancellation through the exact static transaction", async () => {
	for (const [invoke, state, event] of [
		[
			(terminal: ReturnType<typeof harness>["terminal"]) =>
				terminal.succeed(claim, new Uint8Array([7])),
			"succeeded",
			"succeeded",
		],
		[
			(terminal: ReturnType<typeof harness>["terminal"]) =>
				terminal.cancel(claim),
			"cancelled",
			"cancelled",
		],
	] as const) {
		const { calls, terminal } = harness();
		await expect(invoke(terminal)).resolves.toEqual({
			status: "applied",
			state,
			deadLetter: false,
		});
		expect(calls.map(({ statement }) => statement)).toEqual([
			durableKernelMarker,
			durableRunTerminal,
			durableAttemptComplete,
			durableEventSequenceBump,
			durableEventInsert,
		]);
		expect(calls[4]?.value).toMatchObject({ kind: event });
	}
});

test("separates retry scheduling from permanent terminal failure", async () => {
	const retrying = harness();
	await expect(
		retrying.terminal.fail(claim, { code: "HANDLER_FAILED" }),
	).resolves.toEqual({
		status: "applied",
		state: "delayed",
		deadLetter: false,
	});
	expect(retrying.calls.map(({ statement }) => statement)).toEqual([
		durableKernelMarker,
		durableRunRetry,
		durableAttemptComplete,
		durableEventSequenceBump,
		durableEventInsert,
	]);
	expect(retrying.calls[1]?.value).toMatchObject({ delaySeconds: 0.5 });
	expect(retrying.calls[4]?.value).toMatchObject({
		kind: "retryScheduled",
		errorCode: "HANDLER_FAILED",
	});

	const permanent = harness();
	await expect(
		permanent.terminal.fail(claim, { code: "RUN_AS_DENIED" }),
	).resolves.toEqual({ status: "applied", state: "failed", deadLetter: true });
	expect(permanent.calls[1]?.statement).toBe(durableRunTerminal);
	expect(permanent.calls[4]?.value).toMatchObject({
		kind: "failed",
		errorCode: "RUN_AS_DENIED",
	});
});

test("a fenced run performs no attempt or event write", async () => {
	const { calls, terminal } = harness({ runApplied: false });
	await expect(terminal.cancel(claim)).resolves.toEqual({
		status: "fenced",
		state: null,
		deadLetter: false,
	});
	expect(calls.map(({ statement }) => statement)).toEqual([
		durableKernelMarker,
		durableRunTerminal,
	]);
});

test("terminal statement contracts reject malformed parameters and results", () => {
	const terminalInput = {
		application: "application:collaboration",
		runId: claim.runId,
		attemptId: claim.attemptId,
		leaseTokenDigest: "a".repeat(64),
		state: "succeeded" as const,
		resultBytes: new Uint8Array([1]),
		failureCode: null,
		deadLetter: false,
	};
	expect(() =>
		durableRunTerminal.parameters({
			...terminalInput,
			runId: "bad",
		}),
	).toThrow("run identity");
	for (const invalid of [
		{ ...terminalInput, resultBytes: null },
		{
			...terminalInput,
			state: "failed" as const,
			resultBytes: null,
			failureCode: null,
			deadLetter: true,
		},
		{
			...terminalInput,
			state: "cancelled" as const,
			resultBytes: null,
			failureCode: "HANDLER_FAILED" as const,
		},
	])
		expect(() => durableRunTerminal.parameters(invalid)).toThrow(
			"terminal state",
		);
	expect(() =>
		durableRunTerminal.parameters({
			...terminalInput,
			resultBytes: new Uint8Array(262_145),
		}),
	).toThrow("result bytes");
	expect(() =>
		durableRunTerminal.decode({ command: "UPDATE", rowCount: 1, rows: [] }),
	).toThrow("terminal run result");
	const retryInput = {
		application: "application:collaboration",
		runId: claim.runId,
		attemptId: claim.attemptId,
		leaseTokenDigest: "a".repeat(64),
		failureCode: "HANDLER_FAILED" as const,
		delaySeconds: 0.5,
	};
	for (const delaySeconds of [-1, 901, Number.NaN])
		expect(() =>
			durableRunRetry.parameters({ ...retryInput, delaySeconds }),
		).toThrow("retry delay");
	for (const result of [
		{ command: "SELECT", rowCount: 1, rows: [["delayed"]] },
		{ command: "UPDATE", rowCount: 1, rows: [["running"]] },
		{ command: "UPDATE", rowCount: 2, rows: [["delayed"], ["delayed"]] },
	])
		expect(() => durableRunRetry.decode(result)).toThrow("retry run result");
	expect(() =>
		durableAttemptComplete.decode({ command: "UPDATE", rowCount: 0, rows: [] }),
	).toThrow("attempt completion result");
});
