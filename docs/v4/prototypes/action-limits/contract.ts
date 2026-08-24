import {
	canonicalJsonLine,
	CanonicalJsonError,
} from "../../../../packages/runtime/src/canonical-json";

export type ActionLimits = Readonly<{
	inputBytes: number;
	resultBytes: number;
	durationMilliseconds: number;
}>;

export type KnownActionSettlement =
	| Readonly<{ kind: "result"; payloadBytes: number }>
	| Readonly<{
			kind: "declaredError";
			code: string;
			payloadBytes: number;
	  }>;

export type ActionSettlement =
	| KnownActionSettlement
	| Readonly<{
			kind: "frameworkFailure";
			code: "DEADLINE_EXCEEDED";
	  }>
	| Readonly<{
			kind: "frameworkFailure";
			code: "RESOURCE_LIMIT";
			retryable: false;
			phase: "postHandler";
	  }>;

type RecordValue = Readonly<Record<string, unknown>>;

const limitKeys = [
	"durationMilliseconds",
	"inputBytes",
	"resultBytes",
] as const;

function fail(message: string): never {
	throw new TypeError(`Invalid Action limits: ${message}`);
}

function record(value: unknown): RecordValue {
	if (!value || typeof value !== "object" || Array.isArray(value))
		fail("limits must be an object");
	return value as RecordValue;
}

function nonnegativeSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0)
		fail(`${name} must be a nonnegative safe integer`);
	return Number(value);
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1)
		fail(`${name} must be a positive safe integer`);
	return Number(value);
}

function measuredBytes(value: number): number {
	if (!Number.isSafeInteger(value) || value < 0)
		throw new TypeError(
			"Invalid Action byte measurement: bytes must be a nonnegative safe integer",
		);
	return value;
}

export function normalizeActionLimits(value: unknown): ActionLimits {
	const limits = record(value);
	const actual = Object.keys(limits).sort();
	if (
		actual.length !== limitKeys.length ||
		limitKeys.some((key, index) => key !== actual[index])
	)
		fail(
			"limits must have exactly inputBytes, resultBytes, and durationMilliseconds",
		);
	return Object.freeze({
		inputBytes: positiveSafeInteger(limits.inputBytes, "inputBytes"),
		resultBytes: positiveSafeInteger(limits.resultBytes, "resultBytes"),
		durationMilliseconds: nonnegativeSafeInteger(
			limits.durationMilliseconds,
			"durationMilliseconds",
		),
	});
}

export function assertActionInputBytes(
	limits: ActionLimits,
	bytes: number,
): void {
	if (measuredBytes(bytes) > limits.inputBytes)
		throw new Error("RESOURCE_LIMIT");
}

export function assertActionOutcomeBytes(
	limits: ActionLimits,
	outcome: Readonly<{
		kind: "declaredError" | "result";
		payloadBytes: number;
	}>,
): void {
	if (measuredBytes(outcome.payloadBytes) > limits.resultBytes)
		throw new Error("RESOURCE_LIMIT");
}

export function measureActionPayloadBytes(
	value: unknown,
	phase: "input" | "outcome",
): number {
	try {
		assertCanonicalUnicode(value);
		return canonicalJsonLine(value).byteLength;
	} catch (error) {
		if (!(error instanceof CanonicalJsonError)) throw error;
		throw new Error(phase === "input" ? "PROTOCOL_UNSUPPORTED" : "INTERNAL", {
			cause: error,
		});
	}
}

function hasLoneSurrogate(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const unit = value.charCodeAt(index);
		if (unit >= 0xd800 && unit <= 0xdbff) {
			const next = value.charCodeAt(index + 1);
			if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
			index += 1;
			continue;
		}
		if (unit >= 0xdc00 && unit <= 0xdfff) return true;
	}
	return false;
}

function assertCanonicalUnicode(
	value: unknown,
	seen = new WeakSet<object>(),
): void {
	if (typeof value === "string") {
		if (hasLoneSurrogate(value))
			throw new CanonicalJsonError("invalid-unicode");
		return;
	}
	if (!value || typeof value !== "object" || seen.has(value)) return;
	seen.add(value);
	for (const [key, child] of Object.entries(value)) {
		if (hasLoneSurrogate(key)) throw new CanonicalJsonError("invalid-unicode");
		assertCanonicalUnicode(child, seen);
	}
}

export function actionDeadline(
	limits: ActionLimits,
	clock: Readonly<{
		monotonicStartedAt: number;
		rootRemainingMilliseconds: number | null;
	}>,
): number {
	if (
		!Number.isFinite(clock.monotonicStartedAt) ||
		clock.monotonicStartedAt < 0 ||
		(clock.rootRemainingMilliseconds !== null &&
			(!Number.isSafeInteger(clock.rootRemainingMilliseconds) ||
				clock.rootRemainingMilliseconds < 0))
	)
		throw new TypeError("Invalid Action clock");
	const budget =
		clock.rootRemainingMilliseconds === null
			? limits.durationMilliseconds
			: Math.min(limits.durationMilliseconds, clock.rootRemainingMilliseconds);
	const localDeadline = Math.min(
		Number.MAX_SAFE_INTEGER,
		clock.monotonicStartedAt + budget,
	);
	return localDeadline;
}

export function proveActionAdmissionOrder<Result>(
	limits: ActionLimits,
	steps: Readonly<{
		admit(): void;
		deadlineExceeded(): boolean;
		readEffect(): void;
		decodeAndEncodeInput(): void;
		measureInput(): void;
		project(): void;
		execute(): Result;
	}>,
): Result {
	steps.admit();
	if (limits.durationMilliseconds === 0 || steps.deadlineExceeded())
		throw new Error("DEADLINE_EXCEEDED");
	steps.readEffect();
	steps.decodeAndEncodeInput();
	steps.measureInput();
	steps.project();
	return steps.execute();
}

export function resolveActionSettlement(
	limits: ActionLimits,
	input: Readonly<{
		known: KnownActionSettlement | null;
		ownedCancellation: "DEADLINE_EXCEEDED" | null;
	}>,
): ActionSettlement {
	if (input.known !== null) {
		try {
			assertActionOutcomeBytes(limits, input.known);
		} catch (error) {
			if (error instanceof Error && error.message === "RESOURCE_LIMIT")
				return Object.freeze({
					kind: "frameworkFailure" as const,
					code: "RESOURCE_LIMIT" as const,
					retryable: false as const,
					phase: "postHandler" as const,
				});
			throw error;
		}
		return Object.freeze({ ...input.known });
	}
	if (input.ownedCancellation !== null)
		return Object.freeze({
			kind: "frameworkFailure" as const,
			code: input.ownedCancellation,
		});
	throw new Error("INTERNAL");
}
