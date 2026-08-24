import { expect, test } from "bun:test";

import { canonicalJsonLine } from "../../../../packages/runtime/src/canonical-json";
import {
	actionDeadline,
	assertActionInputBytes,
	assertActionOutcomeBytes,
	measureActionPayloadBytes,
	normalizeActionLimits,
	proveActionAdmissionOrder,
	resolveActionSettlement,
} from "./contract";

const limits = Object.freeze({
	inputBytes: 64,
	resultBytes: 32,
	durationMilliseconds: 5_000,
});

test("accepts only one explicit exact contract with positive bytes and nonnegative duration", () => {
	expect(normalizeActionLimits(limits)).toEqual(limits);
	for (const candidate of [
		undefined,
		{},
		{ inputBytes: 64, resultBytes: 32 },
		{ ...limits, outputBytes: 32 },
		{ bodyBytes: 64, durationMs: 5_000 },
		{ requestBytes: 64, responseBytes: 32, durationMilliseconds: 5_000 },
		{ inputBytes: 0, resultBytes: 32, durationMilliseconds: 5_000 },
		{ inputBytes: 64, resultBytes: 0, durationMilliseconds: 5_000 },
		{ inputBytes: -1, resultBytes: 32, durationMilliseconds: 5_000 },
		{ inputBytes: 1.5, resultBytes: 32, durationMilliseconds: 5_000 },
		{ inputBytes: Number.NaN, resultBytes: 32, durationMilliseconds: 5_000 },
		{
			inputBytes: 64,
			resultBytes: Number.POSITIVE_INFINITY,
			durationMilliseconds: 5_000,
		},
		{
			inputBytes: 64,
			resultBytes: 32,
			durationMilliseconds: Number.MAX_SAFE_INTEGER + 1,
		},
	])
		expect(() => normalizeActionLimits(candidate)).toThrow(
			"Invalid Action limits",
		);
});

test("zero duration is a hard post-Policy denial and never means unlimited", () => {
	const zero = normalizeActionLimits({
		inputBytes: 1,
		resultBytes: 1,
		durationMilliseconds: 0,
	});
	expect(() => assertActionInputBytes(zero, 0)).not.toThrow();
	expect(() => assertActionInputBytes(zero, 1)).not.toThrow();
	expect(() => assertActionInputBytes(zero, 2)).toThrow("RESOURCE_LIMIT");
	expect(() =>
		assertActionOutcomeBytes(zero, { kind: "result", payloadBytes: 1 }),
	).not.toThrow();
	expect(
		actionDeadline(zero, {
			monotonicStartedAt: 100,
			rootRemainingMilliseconds: null,
		}),
	).toBe(100);
});

test("Policy denial precedes a zero duration without disclosing the limit or doing work", () => {
	const zero = normalizeActionLimits({
		inputBytes: 1,
		resultBytes: 1,
		durationMilliseconds: 0,
	});
	const denied = new Error("UNAUTHENTICATED");
	const calls = {
		policy: 0,
		deadline: 0,
		effect: 0,
		codec: 0,
		measurement: 0,
		projection: 0,
		handler: 0,
	};
	expect(() =>
		proveActionAdmissionOrder(zero, {
			admit: () => {
				calls.policy += 1;
				throw denied;
			},
			deadlineExceeded: () => {
				calls.deadline += 1;
				return true;
			},
			readEffect: () => {
				calls.effect += 1;
			},
			decodeAndEncodeInput: () => {
				calls.codec += 1;
			},
			measureInput: () => {
				calls.measurement += 1;
			},
			project: () => {
				calls.projection += 1;
			},
			execute: () => {
				calls.handler += 1;
			},
		}),
	).toThrow(denied);
	expect(calls).toEqual({
		policy: 1,
		deadline: 0,
		effect: 0,
		codec: 0,
		measurement: 0,
		projection: 0,
		handler: 0,
	});
});

test("an admitted zero-duration Action stops before Effect, codec, projection, or handler", () => {
	const calls: string[] = [];
	expect(() =>
		proveActionAdmissionOrder(
			{ ...limits, durationMilliseconds: 0 },
			{
				admit: () => calls.push("policy"),
				deadlineExceeded: () => {
					calls.push("deadline");
					return true;
				},
				readEffect: () => calls.push("effect"),
				decodeAndEncodeInput: () => calls.push("codec"),
				measureInput: () => calls.push("measurement"),
				project: () => calls.push("projection"),
				execute: () => calls.push("handler"),
			},
		),
	).toThrow("DEADLINE_EXCEEDED");
	expect(calls).toEqual(["policy"]);
});

test("an exhausted nonzero duration is first observed after successful Policy", () => {
	const calls: string[] = [];
	expect(() =>
		proveActionAdmissionOrder(limits, {
			admit: () => calls.push("policy"),
			deadlineExceeded: () => {
				calls.push("deadline");
				return true;
			},
			readEffect: () => calls.push("effect"),
			decodeAndEncodeInput: () => calls.push("codec"),
			measureInput: () => calls.push("measurement"),
			project: () => calls.push("projection"),
			execute: () => calls.push("handler"),
		}),
	).toThrow("DEADLINE_EXCEEDED");
	expect(calls).toEqual(["policy", "deadline"]);
});

test("trusted Effect admission precedes semantic input decode and measurement", () => {
	const calls: string[] = [];
	const forged = new Error("INTERNAL");
	expect(() =>
		proveActionAdmissionOrder(limits, {
			admit: () => calls.push("policy"),
			deadlineExceeded: () => false,
			readEffect: () => {
				calls.push("effect");
				throw forged;
			},
			decodeAndEncodeInput: () => calls.push("codec"),
			measureInput: () => calls.push("measurement"),
			project: () => calls.push("projection"),
			execute: () => calls.push("handler"),
		}),
	).toThrow(forged);
	expect(calls).toEqual(["policy", "effect"]);
});

test("input and every authored outcome payload pass at the boundary and fail at plus one", () => {
	expect(() => assertActionInputBytes(limits, 64)).not.toThrow();
	expect(() => assertActionInputBytes(limits, 65)).toThrow("RESOURCE_LIMIT");
	for (const kind of ["result", "declaredError"] as const) {
		expect(() =>
			assertActionOutcomeBytes(limits, { kind, payloadBytes: 32 }),
		).not.toThrow();
		expect(() =>
			assertActionOutcomeBytes(limits, { kind, payloadBytes: 33 }),
		).toThrow("RESOURCE_LIMIT");
	}
});

test("invalid measurements fail closed instead of wrapping, clamping, or bypassing", () => {
	for (const bytes of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
		expect(() => assertActionInputBytes(limits, bytes)).toThrow(
			"Invalid Action byte measurement",
		);
		expect(() =>
			assertActionOutcomeBytes(limits, { kind: "result", payloadBytes: bytes }),
		).toThrow("Invalid Action byte measurement");
	}
});

test("canonical encoding failures keep input and outcome sanitation distinct", () => {
	const cycle: { self?: unknown } = {};
	cycle.self = cycle;
	expect(() => measureActionPayloadBytes(cycle, "input")).toThrow(
		"PROTOCOL_UNSUPPORTED",
	);
	expect(() =>
		measureActionPayloadBytes({ text: "\ud800" }, "outcome"),
	).toThrow("INTERNAL");
});

test("the monotonic Action deadline uses the earlier root remaining or local budget", () => {
	expect(
		actionDeadline(limits, {
			monotonicStartedAt: 10_000.5,
			rootRemainingMilliseconds: null,
		}),
	).toBe(15_000.5);
	expect(
		actionDeadline(limits, {
			monotonicStartedAt: 10_000,
			rootRemainingMilliseconds: 2_000,
		}),
	).toBe(12_000);
	expect(
		actionDeadline(
			{ ...limits, durationMilliseconds: Number.MAX_SAFE_INTEGER },
			{
				monotonicStartedAt: Number.MAX_SAFE_INTEGER - 1,
				rootRemainingMilliseconds: null,
			},
		),
	).toBe(Number.MAX_SAFE_INTEGER);
	expect(
		actionDeadline(
			{ ...limits, durationMilliseconds: Number.MAX_SAFE_INTEGER },
			{
				monotonicStartedAt: Number.MAX_SAFE_INTEGER - 1,
				rootRemainingMilliseconds: 1,
			},
		),
	).toBe(Number.MAX_SAFE_INTEGER);
	expect(() =>
		actionDeadline(limits, {
			monotonicStartedAt: Number.NaN,
			rootRemainingMilliseconds: null,
		}),
	).toThrow("Invalid Action clock");
});

test("known result, declared rejection, and declared ambiguity beat a racing owned deadline", () => {
	for (const known of [
		{ kind: "result", payloadBytes: 8 },
		{ kind: "declaredError", code: "DELIVERY_REJECTED", payloadBytes: 8 },
		{
			kind: "declaredError",
			code: "DELIVERY_OUTCOME_UNKNOWN",
			payloadBytes: 8,
		},
	] as const)
		expect(
			resolveActionSettlement(limits, {
				known,
				ownedCancellation: "DEADLINE_EXCEEDED",
			}),
		).toEqual(known);
});

test("an oversized known outcome becomes RESOURCE_LIMIT instead of a racing deadline", () => {
	expect(
		resolveActionSettlement(limits, {
			known: { kind: "result", payloadBytes: 33 },
			ownedCancellation: "DEADLINE_EXCEEDED",
		}),
	).toEqual({
		kind: "frameworkFailure",
		code: "RESOURCE_LIMIT",
		retryable: false,
		phase: "postHandler",
	});
});

test("owned cancellation wins only when no validated Action outcome exists", () => {
	expect(
		resolveActionSettlement(limits, {
			known: null,
			ownedCancellation: "DEADLINE_EXCEEDED",
		}),
	).toEqual({ kind: "frameworkFailure", code: "DEADLINE_EXCEEDED" });
	expect(() =>
		resolveActionSettlement(limits, {
			known: null,
			ownedCancellation: null,
		}),
	).toThrow("INTERNAL");
});

test("direct and network adapters measure the same canonical semantic bytes", () => {
	const directInput = Object.freeze({ text: "é" });
	const networkInput = JSON.parse('{ "text" : "é" }');
	const directBytes = canonicalJsonLine(directInput);
	const networkBytes = canonicalJsonLine(networkInput);
	expect([...directBytes]).toEqual([...networkBytes]);
	expect(directBytes.byteLength).toBe(
		new TextEncoder().encode('{"text":"é"}\n').byteLength,
	);
	expect(measureActionPayloadBytes(directInput, "input")).toBe(
		directBytes.byteLength,
	);
	const semanticLimits = {
		...limits,
		inputBytes: directBytes.byteLength,
		resultBytes: directBytes.byteLength,
	};
	const decide = () => {
		assertActionInputBytes(semanticLimits, directBytes.byteLength);
		assertActionOutcomeBytes(semanticLimits, {
			kind: "declaredError",
			payloadBytes: directBytes.byteLength,
		});
		return resolveActionSettlement(semanticLimits, {
			known: {
				kind: "declaredError",
				code: "DELIVERY_REJECTED",
				payloadBytes: directBytes.byteLength,
			},
			ownedCancellation: null,
		});
	};
	expect(decide()).toEqual(decide());
	expect(() => measureActionPayloadBytes({ text: "\ud800" }, "input")).toThrow(
		"PROTOCOL_UNSUPPORTED",
	);
});
