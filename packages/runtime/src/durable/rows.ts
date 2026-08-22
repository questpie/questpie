import { canonicalMutationBytes, mutationDigest } from "../mutation/canonical";
import {
	durableEventInsert,
	durableEventSequenceBump,
	type DurableEventErrorCode,
	type DurableEventKind,
} from "./postgres-statements";
import { durableKernelMarker } from "./postgres-statements";
import type { LinkedReactionRetry } from "./projection";

export type DurableRow = Readonly<Record<string, unknown>>;

export type DurableQuery = (
	statement: string,
	parameters?: readonly unknown[],
) => Promise<readonly DurableRow[]>;

export type DurablePrincipalKind = "anonymous" | "service" | "user";

export type DurableActor = Readonly<{
	kind: DurablePrincipalKind;
	id: string;
}>;

export type DurableRunState =
	| "cancelled"
	| "delayed"
	| "failed"
	| "ready"
	| "running"
	| "succeeded";

export type DurableFailureCode =
	| "EFFECT_AMBIGUOUS"
	| "EFFECT_CONFLICT"
	| "HANDLER_FAILED"
	| "REACTION_ERROR"
	| "RESOURCE_LIMIT"
	| "RETRY_EXHAUSTED"
	| "RUN_AS_DENIED"
	| "VALIDATION_FAILED";

export type DurableClaim = Readonly<{
	runId: string;
	dispatchId: string;
	resource: string;
	attemptId: string;
	attemptNumber: number;
	leaseToken: string;
	leaseMilliseconds: number;
	leaseExpiresAt: Date;
	deadlineAt: Date;
	workerId: string;
	tenantId: string;
	principal: Readonly<{ kind: DurablePrincipalKind; id: string }>;
	contextInputBytes: Uint8Array;
	payloadBytes: Uint8Array;
	retry: LinkedReactionRetry;
	runtimeBuildDigest: string;
	executableDigest: string;
	causationId: string;
	correlationId: string;
	cancellationRequested: boolean;
}>;

export type DurableAdmission = Readonly<{
	runId: string;
	resource: string;
	executableDigest: string;
}>;

export type DurableClaimOutcome =
	| Readonly<{ status: "claimed"; claim: DurableClaim }>
	| Readonly<{ status: "skipped" }>
	| Readonly<{ status: "refused"; code: "EXECUTABLE_RETIRED" }>;

export type DurableHeartbeat = Readonly<{
	status: "fenced" | "held";
	cancellationRequested: boolean;
	deadlineExpired: boolean;
}>;

export type DurableTransition = Readonly<{
	status: "applied" | "fenced";
	state: DurableRunState | null;
	deadLetter: boolean;
}>;

export type DurableRunView = Readonly<{
	runId: string;
	/** The append-only history length: the run version a command may fence on. */
	version: number;
	dispatchId: string;
	resource: string;
	state: DurableRunState;
	attemptCount: number;
	currentAttemptId: string | null;
	cancellationRequested: boolean;
	deadLetter: boolean;
	failureCode: string | null;
	resultBytes: Uint8Array | null;
	availableAt: Date;
	terminalAt: Date | null;
}>;

export type DurableRunEventView = Readonly<{
	sequence: number;
	kind: string;
	attemptId: string | null;
	leaseTokenDigest: string | null;
	errorCode: string | null;
}>;

export interface DurableKernel {
	readonly application: string;
	admit(batch?: number): Promise<readonly DurableAdmission[]>;
	reapCancelled(limit?: number): Promise<number>;
	claim(
		input: Readonly<{
			runId: string;
			workerId: string;
			leaseMilliseconds?: number;
			attemptDeadlineMilliseconds?: number;
		}>,
	): Promise<DurableClaimOutcome>;
	heartbeat(claim: DurableClaim): Promise<DurableHeartbeat>;
	succeed(
		claim: DurableClaim,
		resultBytes: Uint8Array,
	): Promise<DurableTransition>;
	fail(
		claim: DurableClaim,
		failure: Readonly<{ code: DurableFailureCode }>,
	): Promise<DurableTransition>;
	cancel(claim: DurableClaim): Promise<DurableTransition>;
	inspect(runId: string): Promise<DurableRunView | null>;
	events(runId: string): Promise<readonly DurableRunEventView[]>;
}

/**
 * The durable kernel opts every one of its own transactions into the
 * `questpie_internal` guard. Application and worker statements that never call
 * this are rejected by the run, attempt, event, and dispatch triggers.
 */
export const durableKernelMarkerStatement = durableKernelMarker.text;

export async function markDurableKernelTransaction(
	query: DurableQuery,
): Promise<void> {
	await query(durableKernelMarkerStatement);
}

export function durableText(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0)
		throw new TypeError(`${label} must be nonempty text`);
	return value;
}

export function durableBytes(value: unknown, label: string): Uint8Array {
	if (!(value instanceof Uint8Array))
		throw new TypeError(`${label} must be PostgreSQL bytea`);
	return value;
}

export function durableDate(value: unknown, label: string): Date {
	if (!(value instanceof Date)) throw new TypeError(`${label} must be a date`);
	return value;
}

export function durableInteger(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value))
		throw new TypeError(`${label} must be an integer`);
	return value;
}

export function durablePrincipalKind(
	value: unknown,
	label: string,
): DurablePrincipalKind {
	const text = durableText(value, label);
	if (text !== "anonymous" && text !== "service" && text !== "user")
		throw new TypeError(`${label} is not a Principal kind`);
	return text;
}

export function retryBytes(retry: LinkedReactionRetry): Uint8Array {
	return canonicalMutationBytes({
		backoff: retry.backoff,
		horizonMilliseconds: retry.horizonMilliseconds,
		initialDelayMilliseconds: retry.initialDelayMilliseconds,
		jitter: retry.jitter,
		maximumAttempts: retry.maximumAttempts,
		maximumDelayMilliseconds: retry.maximumDelayMilliseconds,
	});
}

export function decodeRetryBytes(value: unknown): LinkedReactionRetry {
	const decoded = JSON.parse(
		new TextDecoder().decode(durableBytes(value, "retry program")),
	) as Readonly<Record<string, unknown>>;
	return Object.freeze({
		maximumAttempts: durableInteger(
			decoded.maximumAttempts,
			"retry maximumAttempts",
		),
		initialDelayMilliseconds: durableInteger(
			decoded.initialDelayMilliseconds,
			"retry initialDelayMilliseconds",
		),
		backoff: "exponential" as const,
		maximumDelayMilliseconds: durableInteger(
			decoded.maximumDelayMilliseconds,
			"retry maximumDelayMilliseconds",
		),
		jitter: "full" as const,
		horizonMilliseconds: durableInteger(
			decoded.horizonMilliseconds,
			"retry horizonMilliseconds",
		),
	});
}

/** Full jitter over an exponential backoff, bounded by the declared cap. */
export function retryDelayMilliseconds(
	retry: LinkedReactionRetry,
	attemptNumber: number,
	random: () => number,
): number {
	const exponential =
		retry.initialDelayMilliseconds * 2 ** Math.max(0, attemptNumber - 1);
	const capped = Math.min(exponential, retry.maximumDelayMilliseconds);
	return Math.floor(random() * capped);
}

export function leaseTokenDigest(token: string): string {
	return mutationDigest(new TextEncoder().encode(token));
}

export type DurableEventClaim = Readonly<{
	runId: string;
	dispatchId: string;
	resource: string;
	/** A maintenance transition belongs to no physical attempt. */
	attemptId: string | null;
	leaseToken: string | null;
	causationId: string;
	correlationId: string;
}>;

/** One append-only writer for every durable transition. */
export async function appendDurableRunEvent(
	query: DurableQuery,
	input: Readonly<{
		application: string;
		claim: DurableEventClaim;
		kind: DurableEventKind;
		errorCode?: DurableEventErrorCode | null;
	}>,
): Promise<void> {
	const [bumped] = await query(durableEventSequenceBump.text, [
		input.application,
		input.claim.runId,
	]);
	if (!bumped) throw new TypeError("durable run history has no run");
	await query(durableEventInsert.text, [
		input.application,
		input.claim.runId,
		durableInteger(bumped.sequence, "run event sequence"),
		input.claim.resource,
		input.claim.dispatchId,
		input.claim.attemptId,
		input.claim.leaseToken === null
			? null
			: leaseTokenDigest(input.claim.leaseToken),
		input.claim.causationId,
		input.claim.correlationId,
		input.kind,
		input.errorCode ?? null,
	]);
}

export function effectIdentity(
	application: string,
	runId: string,
	effectName: string,
): string {
	const digest = mutationDigest(
		canonicalMutationBytes({ application, effectName, runId }),
	);
	return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}
