import { expect, test } from "bun:test";

import { linkJobProjection } from "../../packages/runtime/src/durable/job-projection";
import { linkReactionProjection } from "../../packages/runtime/src/durable/projection";
import type {
	DurableClaim,
	DurableKernel,
	DurableTransition,
} from "../../packages/runtime/src/durable/rows";
import {
	createDurableReactionWorker,
	createDurableWorker,
	type DurableWorkAttemptRequest,
} from "../../packages/runtime/src/durable/worker";

const digest = (character: string) => character.repeat(64);
const retry = Object.freeze({
	maximumAttempts: 3,
	initialDelayMilliseconds: 1_000,
	backoff: "exponential" as const,
	maximumDelayMilliseconds: 60_000,
	jitter: "full" as const,
	horizonMilliseconds: 86_400_000,
});

const jobs = linkJobProjection({
	format: "questpie.job-projection",
	version: 1,
	jobs: [
		{
			identity: "job:reports.companyDigest",
			semanticVersion: 2,
			input: { kind: "object", properties: { companyId: { kind: "text" } } },
			output: { kind: "object", properties: { reportId: { kind: "text" } } },
			declaredErrors: {
				REJECTED: { code: "REJECTED", status: 422, payload: null },
			},
			runAs: { actor: "caller", whenDenied: "fail" },
			retry,
			signals: {},
			schedule: null,
			contractDigest: digest("b"),
			origin: {
				path: "src/company-digest.ts",
				exportName: "companyDigest",
				packageId: null,
			},
		},
	],
});

const reactions = linkReactionProjection({
	format: "questpie.reaction-projection",
	version: 2,
	reactions: [
		{
			identity: "reaction:messages.published",
			input: { kind: "object", properties: { messageId: { kind: "text" } } },
			output: {
				kind: "object",
				properties: { delivered: { kind: "boolean" } },
			},
			declaredErrors: {},
			runAs: { actor: "caller", whenDenied: "fail" },
			retry,
			effects: ["deliver"],
			contractDigest: digest("c"),
			origin: {
				path: "src/message-published.ts",
				exportName: "messagePublished",
				packageId: null,
			},
		},
	],
});

function claim(
	input: Readonly<{
		resource: string;
		executableDigest: string;
		semanticVersion: number;
		payload: unknown;
	}>,
): DurableClaim {
	return Object.freeze({
		runId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b6200",
		dispatchId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b6201",
		resource: input.resource,
		semanticVersion: input.semanticVersion,
		attemptId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b6202",
		attemptNumber: 1,
		leaseToken: "018f5f6e-5f2c-7b41-a854-3d9a6b6b6203",
		leaseMilliseconds: 30_000,
		leaseExpiresAt: new Date("2026-08-25T00:00:30.000Z"),
		deadlineAt: new Date("2026-08-25T00:05:00.000Z"),
		workerId: "worker:test",
		tenantId: "tenant:stored",
		principal: Object.freeze({ kind: "user" as const, id: "user:one" }),
		contextInputBytes: new TextEncoder().encode(
			JSON.stringify({ tenant: "stored" }),
		),
		payloadBytes: new TextEncoder().encode(JSON.stringify(input.payload)),
		retry,
		runtimeBuildDigest: digest("a"),
		executableDigest: input.executableDigest,
		causationId: "cause:one",
		correlationId: "correlation:one",
		cancellationRequested: false,
	});
}

function kernelFor(
	claimed: DurableClaim,
	transition: DurableTransition = Object.freeze({
		status: "applied",
		state: "succeeded",
		deadLetter: false,
	}),
): Readonly<{
	kernel: DurableKernel;
	succeeded: Uint8Array[];
	failed: string[];
}> {
	const succeeded: Uint8Array[] = [];
	const failed: string[] = [];
	return {
		succeeded,
		failed,
		kernel: {
			application: "application:test",
			admit: async () => [
				{
					runId: claimed.runId,
					resource: claimed.resource,
					executableDigest: claimed.executableDigest,
				},
			],
			reapCancelled: async () => 0,
			claim: async () => ({ status: "claimed", claim: claimed }),
			heartbeat: async () => ({
				status: "held",
				cancellationRequested: false,
				deadlineExpired: false,
			}),
			succeed: async (_claim, bytes) => {
				succeeded.push(bytes);
				return transition;
			},
			fail: async (_claim, failure) => {
				failed.push(failure.code);
				return transition;
			},
			cancel: async () => transition,
			inspect: async () => null,
			events: async () => [],
		},
	};
}

const unusedLedger = {
	reserve: async () => {
		throw new Error("Job must not reach the Reaction effect ledger");
	},
	settle: async () => {
		throw new Error("Job must not reach the Reaction effect ledger");
	},
	markAmbiguous: async () => {
		throw new Error("Job must not reach the Reaction effect ledger");
	},
	read: async () => [],
} as never;

test("executes and settles a Job through the shared worker without Reaction effects", async () => {
	const claimed = claim({
		resource: "job:reports.companyDigest",
		executableDigest: digest("b"),
		semanticVersion: 2,
		payload: { companyId: "company:one" },
	});
	const state = kernelFor(claimed);
	let request: DurableWorkAttemptRequest | undefined;
	const worker = createDurableWorker({
		kernel: state.kernel,
		ledger: unusedLedger,
		reactions,
		jobs,
		workerId: "worker:test",
		execute: async (attempt) => {
			request = attempt;
			expect(attempt.capability).toBe("job");
			if (attempt.capability !== "job") throw new Error("expected Job");
			expect(attempt.job.identity).toBe("job:reports.companyDigest");
			expect(attempt.run).toEqual({
				id: claimed.runId,
				dispatchId: claimed.dispatchId,
			});
			expect("effect" in attempt.run).toBe(false);
			attempt.assertResolvedTenant("tenant:stored");
			return { reportId: "report:one" };
		},
	});

	expect(await worker.poll()).toMatchObject({
		admitted: 1,
		claimed: 1,
		outcomes: [{ outcome: "succeeded", failureCode: null }],
	});
	expect(request).toBeDefined();
	expect(JSON.parse(new TextDecoder().decode(state.succeeded[0]))).toEqual({
		reportId: "report:one",
	});
});

test("retries an ordinary Job handler failure through the shared kernel", async () => {
	const claimed = claim({
		resource: "job:reports.companyDigest",
		executableDigest: digest("b"),
		semanticVersion: 2,
		payload: { companyId: "company:one" },
	});
	const state = kernelFor(
		claimed,
		Object.freeze({ status: "applied", state: "delayed", deadLetter: false }),
	);
	const worker = createDurableWorker({
		kernel: state.kernel,
		ledger: unusedLedger,
		reactions,
		jobs,
		execute: async () => {
			throw new Error("transient Job failure");
		},
	});

	expect((await worker.poll()).outcomes).toEqual([
		expect.objectContaining({
			outcome: "retryScheduled",
			failureCode: "HANDLER_FAILED",
		}),
	]);
	expect(state.failed).toEqual(["HANDLER_FAILED"]);
});

test("fails a Job before handler work when fresh Context resolves another Tenant", async () => {
	const claimed = claim({
		resource: "job:reports.companyDigest",
		executableDigest: digest("b"),
		semanticVersion: 2,
		payload: { companyId: "company:one" },
	});
	const state = kernelFor(
		claimed,
		Object.freeze({ status: "applied", state: "failed", deadLetter: true }),
	);
	let handlerReached = false;
	const worker = createDurableWorker({
		kernel: state.kernel,
		ledger: unusedLedger,
		reactions,
		jobs,
		execute: async (attempt) => {
			attempt.assertResolvedTenant("tenant:changed");
			handlerReached = true;
			return { reportId: "report:must-not-exist" };
		},
	});

	expect((await worker.poll()).outcomes[0]).toMatchObject({
		outcome: "failed",
		failureCode: "RUN_AS_DENIED",
	});
	expect(handlerReached).toBe(false);
	expect(state.failed).toEqual(["RUN_AS_DENIED"]);
});

test("settles a declared Job error permanently through the shared failure vocabulary", async () => {
	const claimed = claim({
		resource: "job:reports.companyDigest",
		executableDigest: digest("b"),
		semanticVersion: 2,
		payload: { companyId: "company:one" },
	});
	const state = kernelFor(
		claimed,
		Object.freeze({ status: "applied", state: "failed", deadLetter: true }),
	);
	const worker = createDurableWorker({
		kernel: state.kernel,
		ledger: unusedLedger,
		reactions,
		jobs,
		execute: async (attempt) => {
			if (attempt.capability !== "job") throw new Error("expected Job");
			throw attempt.errors.REJECTED!({ reason: "blocked" });
		},
	});

	expect((await worker.poll()).outcomes[0]).toMatchObject({
		outcome: "failed",
		failureCode: "REACTION_ERROR",
	});
	expect(state.failed).toEqual(["REACTION_ERROR"]);
});

test("refuses an incompatible Job before claim", async () => {
	let claims = 0;
	const kernel = kernelFor(
		claim({
			resource: "job:reports.companyDigest",
			executableDigest: digest("d"),
			semanticVersion: 2,
			payload: { companyId: "company:one" },
		}),
	).kernel;
	const worker = createDurableWorker({
		kernel: { ...kernel, claim: async () => (claims += 1) as never },
		ledger: unusedLedger,
		reactions,
		jobs,
		execute: async () => {
			throw new Error("incompatible Job must not execute");
		},
	});

	expect((await worker.poll()).outcomes).toEqual([
		expect.objectContaining({
			outcome: "refusedIncompatible",
			failureCode: "EXECUTABLE_RETIRED",
		}),
	]);
	expect(claims).toBe(0);
});

test("preserves the legacy Reaction-only worker and effect surface", async () => {
	const claimed = claim({
		resource: "reaction:messages.published",
		executableDigest: digest("c"),
		semanticVersion: 1,
		payload: { messageId: "message:one" },
	});
	const state = kernelFor(claimed);
	const worker = createDurableReactionWorker({
		kernel: state.kernel,
		ledger: unusedLedger,
		reactions,
		execute: async (attempt) => {
			expect(attempt.capability).toBe("reaction");
			expect(attempt.reaction.identity).toBe("reaction:messages.published");
			expect(typeof attempt.run.effect).toBe("function");
			return { delivered: true };
		},
	});

	expect((await worker.poll()).outcomes[0]).toMatchObject({
		outcome: "succeeded",
		failureCode: null,
	});
});
