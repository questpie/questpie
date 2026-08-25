import { decodeRuntimeCodec, encodeRuntimeCodec } from "../codec";
import {
	canonicalMutationBytes,
	deterministicUuid,
	mutationDigest,
} from "../mutation/canonical";
import type { LinkedJobMember } from "./job-projection";
import type { LinkedReactionMember } from "./projection";
import {
	durableText,
	markDurableKernelTransaction,
	retryBytes,
	type DurableActor,
	type DurableQuery,
} from "./rows";

export type DurableAcceptance = Readonly<{
	dispatchId: string;
	runId: string;
	resource: string;
}>;

export type JobAcceptanceReceipt = Readonly<{
	runId: string;
	resource: `job:${string}`;
}>;

export type JobAcceptanceOptions = Readonly<{
	idempotencyKey: string;
	notBefore?: Date;
}>;

export type JobAcceptanceRecord = Readonly<{
	dispatchId: string;
	runId: string;
	requestDigest: string;
	resource: `job:${string}`;
	semanticVersion: number;
	tenantId: string;
	principal: DurableActor;
	runAs: "caller";
	contextInputBytes: Uint8Array;
	payloadBytes: Uint8Array;
	retryBytes: Uint8Array;
	runtimeBuildDigest: string;
	executableDigest: string;
	causationKind: "explicit" | "mutationDispatch";
	causationId: string;
	correlationId: string;
	state: "delayed" | "ready";
	availableAt: Date;
	horizonAt: Date;
	acceptedAt: Date;
}>;

export type JobAcceptanceTransactionOutcome =
	| Readonly<{ status: "accepted" }>
	| Readonly<{ status: "existing"; requestDigest: string }>;

/**
 * The transaction adapter owns only persistence and conflict serialization.
 * Identity, canonical request bytes, limits, and the stable receipt stay in
 * this module so direct and Mutation-owned callers cannot drift.
 */
export interface JobAcceptanceTransaction {
	accept(record: JobAcceptanceRecord): Promise<JobAcceptanceTransactionOutcome>;
}

export interface JobAcceptance {
	accept(
		job: LinkedJobMember,
		payload: unknown,
		options: JobAcceptanceOptions,
	): Promise<JobAcceptanceReceipt>;
}

export class JobAcceptanceConflict extends TypeError {
	readonly code = "JOB_ACCEPTANCE_CONFLICT";

	constructor(readonly receipt: JobAcceptanceReceipt) {
		super(
			"Job acceptance idempotency identity conflicts with its first request",
		);
		this.name = "JobAcceptanceConflict";
	}
}

function validIdentityText(value: unknown): value is string {
	if (typeof value !== "string" || value.length === 0 || value.includes("\0"))
		return false;
	let scalars = 0;
	for (let index = 0; index < value.length; index += 1) {
		const unit = value.charCodeAt(index);
		if (unit >= 0xd800 && unit <= 0xdbff) {
			const next = value.charCodeAt(index + 1);
			if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
			index += 1;
		} else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
		scalars += 1;
		if (scalars > 256) return false;
	}
	return (
		value.normalize("NFC") === value &&
		new TextEncoder().encode(value).byteLength <= 1_024
	);
}

function absoluteTimestamp(value: Date | undefined): Date | null {
	if (value === undefined) return null;
	if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
		throw new TypeError("Job notBefore must be an absolute timestamp");
	return new Date(value.getTime());
}

function acceptedTimestamp(value: Date): Date {
	if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
		throw new TypeError("Job acceptedAt must be an absolute timestamp");
	return new Date(value.getTime());
}

function immutableBytes(value: Uint8Array, label: string): Uint8Array {
	if (!(value instanceof Uint8Array))
		throw new TypeError(`Job ${label} must be bytes`);
	return Uint8Array.from(value);
}

function jobAcceptanceIdentity(
	input: Readonly<{
		application: string;
		tenantId: string;
		principal: DurableActor;
		resource: string;
		idempotencyKey: string;
	}>,
): string {
	return deterministicUuid(
		canonicalMutationBytes({
			format: "questpie.job-acceptance-identity.v1",
			application: input.application,
			tenantId: input.tenantId,
			principalKind: input.principal.kind,
			principalId: input.principal.id,
			resource: input.resource,
			idempotencyKey: input.idempotencyKey,
		}),
	);
}

/**
 * Creates one transaction-bound Job acceptance owner. The returned receipt is
 * deterministic and available before commit; the adapter still decides
 * whether that transaction commits it atomically with its caller's work.
 */
export function createJobAcceptance(
	input: Readonly<{
		application: string;
		tenantId: string;
		principal: DurableActor;
		contextInputBytes: Uint8Array;
		runtimeBuildDigest: string;
		acceptedAt: Date;
		causation: Readonly<{
			kind: "explicit" | "mutationDispatch";
			id: string;
			correlationId: string;
		}>;
		transaction: JobAcceptanceTransaction;
	}>,
): JobAcceptance {
	const acceptedAt = acceptedTimestamp(input.acceptedAt);
	const contextInputBytes = immutableBytes(
		input.contextInputBytes,
		"Context input",
	);
	const locallyAccepted = new Map<
		string,
		Readonly<{ requestDigest: string; receipt: JobAcceptanceReceipt }>
	>();
	return Object.freeze({
		async accept(
			job: LinkedJobMember,
			payload: unknown,
			options: JobAcceptanceOptions,
		) {
			if (!validIdentityText(options?.idempotencyKey))
				throw new TypeError("Job idempotency key is invalid");
			const notBefore = absoluteTimestamp(options.notBefore);
			const decoded = decodeRuntimeCodec(job.input, payload, "$job.input");
			const payloadBytes = canonicalMutationBytes(
				encodeRuntimeCodec(job.input, decoded, "$job.input"),
			);
			if (payloadBytes.byteLength > 262_144)
				throw new TypeError("Durable payload exceeds its byte limit");
			const dispatchId = jobAcceptanceIdentity({
				application: input.application,
				tenantId: input.tenantId,
				principal: input.principal,
				resource: job.identity,
				idempotencyKey: options.idempotencyKey,
			});
			const receipt = Object.freeze({
				runId: durableRunIdentity(dispatchId),
				resource: job.identity as `job:${string}`,
			});
			const requestDigest = mutationDigest(
				canonicalMutationBytes({
					format: "questpie.job-acceptance-request.v1",
					contextInputDigest: mutationDigest(contextInputBytes),
					notBefore: notBefore?.toISOString() ?? null,
					payloadDigest: mutationDigest(payloadBytes),
					runAs: job.runAs,
				}),
			);
			const local = locallyAccepted.get(dispatchId);
			if (local) {
				if (local.requestDigest !== requestDigest)
					throw new JobAcceptanceConflict(local.receipt);
				return local.receipt;
			}
			if (locallyAccepted.size >= 100)
				throw new TypeError(
					"Job acceptance transaction exceeds its command limit",
				);
			const availableAt = notBefore ?? new Date(acceptedAt.getTime());
			const horizonAt = new Date(
				Math.max(availableAt.getTime(), acceptedAt.getTime()) +
					job.retry.horizonMilliseconds,
			);
			if (!Number.isFinite(horizonAt.getTime()))
				throw new TypeError("Job notBefore is outside its supported range");
			const record = Object.freeze({
				dispatchId,
				runId: receipt.runId,
				requestDigest,
				resource: receipt.resource,
				semanticVersion: job.semanticVersion,
				tenantId: input.tenantId,
				principal: Object.freeze({ ...input.principal }),
				runAs: "caller" as const,
				contextInputBytes: Uint8Array.from(contextInputBytes),
				payloadBytes,
				retryBytes: retryBytes(job.retry),
				runtimeBuildDigest: input.runtimeBuildDigest,
				executableDigest: job.contractDigest,
				causationKind: input.causation.kind,
				causationId: input.causation.id,
				correlationId: input.causation.correlationId,
				state:
					availableAt.getTime() > acceptedAt.getTime()
						? ("delayed" as const)
						: ("ready" as const),
				availableAt,
				horizonAt,
				acceptedAt: new Date(acceptedAt.getTime()),
			}) satisfies JobAcceptanceRecord;
			const outcome = await input.transaction.accept(record);
			if (
				outcome.status === "existing" &&
				outcome.requestDigest !== requestDigest
			)
				throw new JobAcceptanceConflict(receipt);
			locallyAccepted.set(
				dispatchId,
				Object.freeze({ requestDigest, receipt }),
			);
			return receipt;
		},
	});
}

/** One acceptance fact owns one run; the dispatch identity derives both. */
export function durableRunIdentity(dispatchId: string): string {
	return deterministicUuid(
		new TextEncoder().encode(`questpie.durable-run\u0000${dispatchId}`),
	);
}

/**
 * Advances one recorded dispatch into a ready run inside the caller's
 * transaction. `durable_run_dispatch_unique` makes a second run for the same
 * committed fact unrepresentable rather than merely unlikely.
 */
export async function acceptDurableDispatch(
	input: Readonly<{
		query: DurableQuery;
		application: string;
		dispatchId: string;
		reaction: LinkedReactionMember;
		tenantId: string;
		principal: DurableActor;
		contextInputBytes: Uint8Array;
		payloadBytes: Uint8Array;
		runtimeBuildDigest: string;
		causationId: string;
		correlationId: string;
		acceptedAt: Date;
	}>,
): Promise<DurableAcceptance | null> {
	await markDurableKernelTransaction(input.query);
	const advanced = await input.query(
		`UPDATE questpie_internal.durable_dispatches
SET state = 'accepted'
WHERE application_name = $1 AND record_id = $2 AND state = 'pending'
RETURNING record_id::text AS "dispatchId"`,
		[input.application, input.dispatchId],
	);
	if (advanced.length === 0) return null;
	const runId = durableRunIdentity(input.dispatchId);
	const horizonAt = new Date(
		input.acceptedAt.getTime() + input.reaction.retry.horizonMilliseconds,
	);
	const inserted = await input.query(
		`INSERT INTO questpie_internal.durable_runs
  (application_name, run_id, dispatch_id, resource_identity, semantic_version, tenant_id, principal_kind, principal_id,
   run_as, context_input_bytes, payload_bytes, retry_bytes, runtime_build_digest, executable_digest,
   causation_kind, causation_id, correlation_id, state, attempt_count, available_at, horizon_at,
   cancellation_requested, event_sequence, dead_letter, accepted_at)
VALUES ($1, $2, $3, $4, 1, $5, $6, $7, 'caller', $8, $9, $10, $11, $12,
   'mutationDispatch', $13, $14, 'ready', 0, $15, $16, false, 1, false, $15)
ON CONFLICT DO NOTHING
RETURNING run_id::text AS "runId"`,
		[
			input.application,
			runId,
			input.dispatchId,
			input.reaction.identity,
			input.tenantId,
			input.principal.kind,
			input.principal.id,
			input.contextInputBytes,
			input.payloadBytes,
			retryBytes(input.reaction.retry),
			input.runtimeBuildDigest,
			input.reaction.contractDigest,
			input.causationId,
			input.correlationId,
			input.acceptedAt,
			horizonAt,
		],
	);
	if (inserted.length === 0) return null;
	await input.query(
		`INSERT INTO questpie_internal.durable_run_events
  (application_name, run_id, sequence, occurred_at, resource_identity, dispatch_id,
   causation_id, correlation_id, kind)
VALUES ($1, $2, 1, $3, $4, $5, $6, $7, 'accepted')`,
		[
			input.application,
			runId,
			input.acceptedAt,
			input.reaction.identity,
			input.dispatchId,
			input.causationId,
			input.correlationId,
		],
	);
	return Object.freeze({
		dispatchId: durableText(advanced[0]!.dispatchId, "dispatch identity"),
		runId,
		resource: input.reaction.identity,
	});
}
