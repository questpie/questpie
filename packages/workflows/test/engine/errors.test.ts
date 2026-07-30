import { describe, expect, test } from "bun:test";

import {
	NonDeterministicError,
	StepFailedError,
	StepRetryError,
	StepSuspendError,
	WorkflowError,
	WorkflowTimeoutError,
} from "../../src/server/engine/errors.js";

describe("StepSuspendError", () => {
	test("constructs with reason and step name", () => {
		const err = new StepSuspendError("sleep", "delay-5m");
		expect(err).toBeInstanceOf(WorkflowError);
		expect(err).toBeInstanceOf(StepSuspendError);
		expect(err.code).toBe("STEP_SUSPENDED");
		expect(err.reason).toBe("sleep");
		expect(err.stepName).toBe("delay-5m");
		expect(err.resumeAt).toBeUndefined();
		expect(err.message).toContain("delay-5m");
		expect(err.message).toContain("sleep");
	});

	test("constructs with resumeAt", () => {
		const resumeAt = new Date("2026-01-01T00:05:00Z");
		const err = new StepSuspendError("sleep", "delay-5m", resumeAt);
		expect(err.resumeAt).toBe(resumeAt);
	});

	test("supports all suspend reasons", () => {
		const reasons = ["sleep", "sleepUntil", "waitForEvent", "invoke"] as const;
		for (const reason of reasons) {
			const err = new StepSuspendError(reason, "test-step");
			expect(err.reason).toBe(reason);
		}
	});

	test("has correct name property", () => {
		const err = new StepSuspendError("sleep", "test");
		expect(err.name).toBe("StepSuspendError");
	});
});

describe("StepRetryError", () => {
	test("constructs with all metadata", () => {
		const cause = new Error("network failure");
		const retryAt = new Date("2026-01-01T00:00:05Z");
		const err = new StepRetryError("fetch-data", 2, 3, retryAt, cause);

		expect(err).toBeInstanceOf(WorkflowError);
		expect(err).toBeInstanceOf(StepRetryError);
		expect(err.code).toBe("STEP_RETRY");
		expect(err.stepName).toBe("fetch-data");
		expect(err.attempt).toBe(2);
		expect(err.maxAttempts).toBe(3);
		expect(err.retryAt).toBe(retryAt);
		expect(err.cause).toBe(cause);
		expect(err.message).toContain("fetch-data");
		expect(err.message).toContain("2/3");
	});

	test("has correct name property", () => {
		const err = new StepRetryError("test", 1, 3, new Date(), new Error("x"));
		expect(err.name).toBe("StepRetryError");
	});
});

describe("StepFailedError", () => {
	test("constructs with step name, attempts, and cause", () => {
		const cause = new Error("permanent failure");
		const err = new StepFailedError("send-email", 3, cause);

		expect(err).toBeInstanceOf(WorkflowError);
		expect(err).toBeInstanceOf(StepFailedError);
		expect(err.code).toBe("STEP_FAILED");
		expect(err.stepName).toBe("send-email");
		expect(err.attempts).toBe(3);
		expect(err.cause).toBe(cause);
		expect(err.message).toContain("send-email");
		expect(err.message).toContain("3 attempt(s)");
		expect(err.message).toContain("permanent failure");
	});

	test("has correct name property", () => {
		const err = new StepFailedError("test", 1, new Error("x"));
		expect(err.name).toBe("StepFailedError");
	});
});

describe("NonDeterministicError", () => {
	test("constructs with step mismatch details", () => {
		const err = new NonDeterministicError("stepC", "stepB", 1);

		expect(err).toBeInstanceOf(WorkflowError);
		expect(err).toBeInstanceOf(NonDeterministicError);
		expect(err.code).toBe("NON_DETERMINISTIC");
		expect(err.stepName).toBe("stepC");
		expect(err.expectedStepName).toBe("stepB");
		expect(err.index).toBe(1);
		expect(err.message).toContain("stepC");
		expect(err.message).toContain("stepB");
		expect(err.message).toContain("index 1");
	});

	test("has correct name property", () => {
		const err = new NonDeterministicError("a", "b", 0);
		expect(err.name).toBe("NonDeterministicError");
	});
});

describe("WorkflowTimeoutError", () => {
	test("constructs with instance ID and timeout", () => {
		const err = new WorkflowTimeoutError("inst-123", "30m");

		expect(err).toBeInstanceOf(WorkflowError);
		expect(err).toBeInstanceOf(WorkflowTimeoutError);
		expect(err.code).toBe("WORKFLOW_TIMEOUT");
		expect(err.instanceId).toBe("inst-123");
		expect(err.timeout).toBe("30m");
		expect(err.message).toContain("inst-123");
		expect(err.message).toContain("30m");
	});

	test("has correct name property", () => {
		const err = new WorkflowTimeoutError("test", "1h");
		expect(err.name).toBe("WorkflowTimeoutError");
	});
});

describe("error hierarchy", () => {
	test("all errors extend WorkflowError", () => {
		expect(new StepSuspendError("sleep", "s")).toBeInstanceOf(WorkflowError);
		expect(
			new StepRetryError("s", 1, 3, new Date(), new Error()),
		).toBeInstanceOf(WorkflowError);
		expect(new StepFailedError("s", 1, new Error())).toBeInstanceOf(
			WorkflowError,
		);
		expect(new NonDeterministicError("a", "b", 0)).toBeInstanceOf(
			WorkflowError,
		);
		expect(new WorkflowTimeoutError("i", "1h")).toBeInstanceOf(WorkflowError);
	});

	test("all errors extend Error", () => {
		expect(new StepSuspendError("sleep", "s")).toBeInstanceOf(Error);
		expect(
			new StepRetryError("s", 1, 3, new Date(), new Error()),
		).toBeInstanceOf(Error);
		expect(new StepFailedError("s", 1, new Error())).toBeInstanceOf(Error);
		expect(new NonDeterministicError("a", "b", 0)).toBeInstanceOf(Error);
		expect(new WorkflowTimeoutError("i", "1h")).toBeInstanceOf(Error);
	});

	test("each error has a unique code", () => {
		const codes = [
			new StepSuspendError("sleep", "s").code,
			new StepRetryError("s", 1, 3, new Date(), new Error()).code,
			new StepFailedError("s", 1, new Error()).code,
			new NonDeterministicError("a", "b", 0).code,
			new WorkflowTimeoutError("i", "1h").code,
		];
		const unique = new Set(codes);
		expect(unique.size).toBe(codes.length);
	});
});
