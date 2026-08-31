import {
	decodeRuntimeCodec,
	encodeRuntimeCodec,
	RuntimeCodecError,
} from "../codec";
import { canonicalMutationBytes } from "../mutation/canonical";
import { DeclaredOperationError } from "../operation";
import type { DurableEffectLedger } from "./durable-effect-contract";
import {
	createDurableRunHandle,
	DurableEffectAmbiguous,
	DurableEffectConflict,
	DurableLeaseLost,
	type DurableRunHandle,
} from "./effects";
import type { LinkedJobMember, LinkedJobProjection } from "./job-projection";
import type {
	LinkedReactionMember,
	LinkedReactionProjection,
} from "./projection";
import type { DurableClaim, DurableFailureCode, DurableKernel } from "./rows";

export type DurableAttemptHandle = Readonly<{
	number: number;
	heartbeat(): Promise<void>;
}>;

export type DurableAttemptRequest = Readonly<{
	capability: "reaction";
	claim: DurableClaim;
	reaction: LinkedReactionMember;
	input: unknown;
	contextInput: unknown;
	principal: Readonly<{ kind: "anonymous" | "service" | "user"; id: string }>;
	signal: AbortSignal;
	run: DurableRunHandle;
	attempt: DurableAttemptHandle;
	errors: Readonly<Record<string, (payload?: unknown) => Error>>;
	assertResolvedTenant(tenantId: string): void;
}>;

export type DurableJobRunHandle = Readonly<{
	id: string;
	dispatchId: string;
}>;

export type DurableJobAttemptRequest = Readonly<{
	capability: "job";
	claim: DurableClaim;
	job: LinkedJobMember;
	input: unknown;
	contextInput: unknown;
	principal: Readonly<{ kind: "anonymous" | "service" | "user"; id: string }>;
	signal: AbortSignal;
	run: DurableJobRunHandle;
	attempt: DurableAttemptHandle;
	errors: Readonly<Record<string, (payload?: unknown) => Error>>;
	assertResolvedTenant(tenantId: string): void;
}>;

export type DurableWorkAttemptRequest =
	| DurableAttemptRequest
	| DurableJobAttemptRequest;

export type DurableWorkAttemptExecutor<Execution = unknown> = (
	request: DurableWorkAttemptRequest,
	execution: Execution,
) => Promise<unknown>;

export type DurableAttemptExecutionRequest = Readonly<{
	capability: "job" | "reaction";
	attemptId: string;
	attemptNumber: number;
	contextInput: unknown;
	dispatchId: string;
	principal: DurableClaim["principal"];
	resource: string;
	runId: string;
	signal: AbortSignal;
}>;

export type DurableAttemptExecution<Execution = unknown> = (
	request: DurableAttemptExecutionRequest,
	work: Readonly<{
		preparationError?: unknown;
		use(execution: Execution): Promise<DurableWorkerOutcome>;
		failure(error: unknown): Promise<DurableWorkerOutcome>;
	}>,
) => Promise<DurableWorkerOutcome>;

type DurableWorkerOutcomeBase = Readonly<{
	runId: string;
	resource: string;
	attemptNumber: number;
}>;
export type DurableWorkerOutcome = DurableWorkerOutcomeBase &
	(
		| Readonly<{
				failureCode: DurableFailureCode;
				outcome: "retryScheduled";
				retryDelayMilliseconds: number;
		  }>
		| Readonly<{
				failureCode: DurableFailureCode | null;
				outcome: "cancelled" | "failed" | "fenced" | "succeeded";
		  }>
		| Readonly<{
				failureCode: "EXECUTABLE_RETIRED";
				outcome: "refusedIncompatible";
		  }>
		| Readonly<{
				failureCode: null;
				outcome: "skipped";
		  }>
	);

export type DurableWorkerTrace = Readonly<{
	workerId: string;
	admitted: number;
	cancelled: number;
	claimed: number;
	refusedIncompatible: number;
	outcomes: readonly DurableWorkerOutcome[];
}>;

export interface DurableWorker {
	readonly workerId: string;
	poll(): Promise<DurableWorkerTrace>;
	beginDrain(): void;
	readonly draining: boolean;
}

type LinkedDurableMember = LinkedReactionMember | LinkedJobMember;

type AvailableDurableDefinition =
	| Readonly<{ capability: "reaction"; definition: LinkedReactionMember }>
	| Readonly<{ capability: "job"; definition: LinkedJobMember }>;

class DurableRunAsDenied extends Error {
	readonly code = "notFound";
	constructor() {
		super("Durable run-as tenant is unavailable");
		this.name = "DurableRunAsDenied";
	}
}

function errorFactories(
	definition: LinkedDurableMember,
): Readonly<Record<string, (payload?: unknown) => Error>> {
	return Object.freeze(
		Object.fromEntries(
			Object.entries(definition.declaredErrors).map(([key, declared]) => [
				key,
				(payload: unknown = null) =>
					new DeclaredOperationError(declared.code, declared.status, payload),
			]),
		),
	);
}

function availableDefinition(
	resource: string,
	executableDigest: string,
	input: Readonly<{
		reactions: LinkedReactionProjection;
		jobs: LinkedJobProjection;
	}>,
): AvailableDurableDefinition | null {
	const reaction = input.reactions.byIdentity.get(resource);
	if (reaction?.contractDigest === executableDigest)
		return Object.freeze({
			capability: "reaction" as const,
			definition: reaction,
		});
	const job = input.jobs.byIdentity.get(resource);
	if (job?.contractDigest === executableDigest)
		return Object.freeze({ capability: "job" as const, definition: job });
	return null;
}

function isRunAsDenial(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	const code = (error as Readonly<{ code?: unknown }>).code;
	return code === "notFound" || code === "unauthenticated";
}

function classify(error: unknown): DurableFailureCode {
	// A payload or result outside its compiled codec can never become valid on a
	// later attempt, so it is permanent rather than retried to exhaustion.
	if (error instanceof RuntimeCodecError) return "VALIDATION_FAILED";
	// Protocol v7 retains the physical REACTION_ERROR code for declared durable
	// handler failures so Job execution does not require a rolling schema split.
	if (error instanceof DeclaredOperationError) return "REACTION_ERROR";
	if (error instanceof DurableEffectAmbiguous) return "EFFECT_AMBIGUOUS";
	if (error instanceof DurableEffectConflict) return "EFFECT_CONFLICT";
	if (isRunAsDenial(error)) return "RUN_AS_DENIED";
	return "HANDLER_FAILED";
}

export function createDurableWorker<Execution>(
	input: Readonly<{
		kernel: DurableKernel;
		ledger: DurableEffectLedger;
		reactions: LinkedReactionProjection;
		jobs: LinkedJobProjection;
		attemptExecution: DurableAttemptExecution<Execution>;
		execute: DurableWorkAttemptExecutor<Execution>;
		workerId?: string;
		claimBatch?: number;
		leaseMilliseconds?: number;
		heartbeatMilliseconds?: number;
		attemptDeadlineMilliseconds?: number;
		resultBytesLimit?: number;
	}>,
): DurableWorker {
	const workerId = input.workerId ?? `worker:${crypto.randomUUID()}`;
	const claimBatch = input.claimBatch ?? 64;
	if (!Number.isSafeInteger(claimBatch) || claimBatch < 1 || claimBatch > 64)
		throw new TypeError("durable worker claim batch must be between 1 and 64");
	const leaseMilliseconds = input.leaseMilliseconds ?? 30_000;
	const heartbeatMilliseconds = input.heartbeatMilliseconds ?? 10_000;
	if (heartbeatMilliseconds >= leaseMilliseconds)
		throw new TypeError("durable heartbeat must be shorter than its lease");
	const attemptDeadlineMilliseconds =
		input.attemptDeadlineMilliseconds ?? 300_000;
	const resultBytesLimit = input.resultBytesLimit ?? 262_144;
	if (
		!Number.isSafeInteger(resultBytesLimit) ||
		resultBytesLimit < 1 ||
		resultBytesLimit > 262_144
	)
		throw new TypeError("durable result limit must be between 1 and 262144");
	let draining = false;

	const runAttempt = async (
		claim: DurableClaim,
		available: AvailableDurableDefinition,
	): Promise<DurableWorkerOutcome> => {
		const definition = available.definition;
		const controller = new AbortController();
		let fenced = false;
		let cancelled = claim.cancellationRequested;
		let deadlineExpired = false;
		let contextInput: unknown;
		let preparationError: unknown;
		try {
			contextInput = JSON.parse(
				new TextDecoder().decode(claim.contextInputBytes),
			);
		} catch (error) {
			preparationError = error;
		}
		if (cancelled)
			controller.abort(new DOMException("Run cancelled", "AbortError"));
		const settle = async (
			failureCode: DurableFailureCode | null,
			resultBytes: Uint8Array | null,
		): Promise<DurableWorkerOutcome> => {
			if (fenced)
				return Object.freeze({
					runId: claim.runId,
					resource: claim.resource,
					attemptNumber: claim.attemptNumber,
					outcome: "fenced" as const,
					failureCode: null,
				});
			if (cancelled) {
				const transition = await input.kernel.cancel(claim);
				return Object.freeze({
					runId: claim.runId,
					resource: claim.resource,
					attemptNumber: claim.attemptNumber,
					outcome: transition.status === "applied" ? "cancelled" : "fenced",
					failureCode: null,
				});
			}
			if (resultBytes !== null) {
				const transition = await input.kernel.succeed(claim, resultBytes);
				return Object.freeze({
					runId: claim.runId,
					resource: claim.resource,
					attemptNumber: claim.attemptNumber,
					outcome: transition.status === "applied" ? "succeeded" : "fenced",
					failureCode: null,
				});
			}
			const code = failureCode ?? "HANDLER_FAILED";
			const transition = await input.kernel.fail(claim, { code });
			if (transition.status === "fenced")
				return Object.freeze({
					runId: claim.runId,
					resource: claim.resource,
					attemptNumber: claim.attemptNumber,
					outcome: "fenced" as const,
					failureCode: code,
				});
			if (transition.state === "delayed")
				return Object.freeze({
					runId: claim.runId,
					resource: claim.resource,
					attemptNumber: claim.attemptNumber,
					outcome: "retryScheduled" as const,
					failureCode: code,
					retryDelayMilliseconds: transition.retryDelayMilliseconds,
				});
			return Object.freeze({
				runId: claim.runId,
				resource: claim.resource,
				attemptNumber: claim.attemptNumber,
				outcome: "failed" as const,
				failureCode: code,
			});
		};
		let timer: ReturnType<typeof setInterval>;
		const observe = async (): Promise<void> => {
			if (deadlineExpired) return;
			const beat = await input.kernel.heartbeat(claim);
			if (beat.status === "fenced") {
				fenced = true;
				controller.abort(new DurableLeaseLost());
				return;
			}
			if (beat.cancellationRequested) {
				cancelled = true;
				controller.abort(new DOMException("Run cancelled", "AbortError"));
			}
			if (beat.deadlineExpired) {
				// A non-cooperative attempt must not renew its lease past its deadline.
				deadlineExpired = true;
				clearInterval(timer);
				controller.abort(new DOMException("Attempt deadline", "AbortError"));
			}
		};
		timer = setInterval(() => {
			void observe().catch(() => undefined);
		}, heartbeatMilliseconds);
		try {
			return await input.attemptExecution(
				Object.freeze({
					capability: available.capability,
					attemptId: claim.attemptId,
					attemptNumber: claim.attemptNumber,
					contextInput,
					dispatchId: claim.dispatchId,
					principal: claim.principal,
					resource: claim.resource,
					runId: claim.runId,
					signal: controller.signal,
				}),
				{
					...(preparationError === undefined ? {} : { preparationError }),
					failure: async (error) => {
						if (error instanceof DurableLeaseLost) fenced = true;
						else if (!cancelled) return settle(classify(error), null);
						return settle(null, null);
					},
					use: async (execution) => {
						let failureCode: DurableFailureCode | null = null;
						let resultBytes: Uint8Array | null = null;
						try {
							const decodedInput = decodeRuntimeCodec(
								definition.input,
								JSON.parse(new TextDecoder().decode(claim.payloadBytes)),
								`$${available.capability}.input`,
							);
							const common = {
								claim,
								input: decodedInput,
								contextInput,
								principal: claim.principal,
								signal: controller.signal,
								attempt: Object.freeze({
									number: claim.attemptNumber,
									heartbeat: observe,
								}),
								errors: errorFactories(definition),
								assertResolvedTenant(tenantId: string) {
									if (tenantId !== claim.tenantId)
										throw new DurableRunAsDenied();
								},
							};
							const result = await input.execute(
								available.capability === "reaction"
									? Object.freeze({
											...common,
											capability: "reaction" as const,
											reaction: available.definition,
											run: createDurableRunHandle({
												ledger: input.ledger,
												claim,
												declaredEffects: available.definition.effects,
												signal: controller.signal,
											}),
										})
									: Object.freeze({
											...common,
											capability: "job" as const,
											job: available.definition,
											run: Object.freeze({
												id: claim.runId,
												dispatchId: claim.dispatchId,
											}),
										}),
								execution,
							);
							const validated = decodeRuntimeCodec(
								definition.output,
								encodeRuntimeCodec(
									definition.output,
									result,
									`$${available.capability}.result`,
								),
								`$${available.capability}.result`,
							);
							const bytes = canonicalMutationBytes(
								encodeRuntimeCodec(
									definition.output,
									validated,
									`$${available.capability}.result`,
								),
							);
							if (bytes.byteLength > resultBytesLimit)
								failureCode = "RESOURCE_LIMIT";
							else resultBytes = bytes;
						} catch (error) {
							if (error instanceof DurableLeaseLost) fenced = true;
							else if (cancelled) failureCode = null;
							else failureCode = classify(error);
						}
						return settle(failureCode, resultBytes);
					},
				},
			);
		} finally {
			clearInterval(timer);
		}
	};

	return Object.freeze<DurableWorker>({
		workerId,
		get draining() {
			return draining;
		},
		beginDrain() {
			draining = true;
		},
		async poll() {
			if (draining)
				return Object.freeze({
					workerId,
					admitted: 0,
					cancelled: 0,
					claimed: 0,
					refusedIncompatible: 0,
					outcomes: Object.freeze([]),
				});
			const cancelled = await input.kernel.reapCancelled(claimBatch);
			const admissions = await input.kernel.admit(claimBatch);
			const outcomes: DurableWorkerOutcome[] = [];
			let claimed = 0;
			let refusedIncompatible = 0;
			for (const admission of admissions) {
				const available = availableDefinition(
					admission.resource,
					admission.executableDigest,
					input,
				);
				if (!available) {
					refusedIncompatible += 1;
					outcomes.push(
						Object.freeze({
							runId: admission.runId,
							resource: admission.resource,
							attemptNumber: 0,
							outcome: "refusedIncompatible" as const,
							failureCode: "EXECUTABLE_RETIRED" as const,
						}),
					);
					continue;
				}
				const outcome = await input.kernel.claim({
					runId: admission.runId,
					workerId,
					leaseMilliseconds,
					attemptDeadlineMilliseconds,
				});
				if (outcome.status === "refused") {
					refusedIncompatible += 1;
					outcomes.push(
						Object.freeze({
							runId: admission.runId,
							resource: admission.resource,
							attemptNumber: 0,
							outcome: "refusedIncompatible" as const,
							failureCode: outcome.code,
						}),
					);
					continue;
				}
				if (outcome.status === "skipped") {
					outcomes.push(
						Object.freeze({
							runId: admission.runId,
							resource: admission.resource,
							attemptNumber: 0,
							outcome: "skipped" as const,
							failureCode: null,
						}),
					);
					continue;
				}
				claimed += 1;
				outcomes.push(await runAttempt(outcome.claim, available));
			}
			return Object.freeze({
				workerId,
				admitted: admissions.length,
				cancelled,
				claimed,
				refusedIncompatible,
				outcomes: Object.freeze(outcomes),
			});
		},
	});
}
