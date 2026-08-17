import { decodeRuntimeCodec, encodeRuntimeCodec } from "../codec";
import { canonicalMutationBytes } from "../mutation/canonical";
import { DeclaredOperationError } from "../operation";
import {
	createDurableRunHandle,
	DurableEffectAmbiguous,
	DurableEffectConflict,
	DurableLeaseLost,
	type DurableRunHandle,
} from "./effects";
import type { DurableEffectLedger } from "./postgres-effects";
import type {
	DurableClaim,
	DurableFailureCode,
	DurableKernel,
} from "./postgres-kernel";
import type {
	LinkedReactionMember,
	LinkedReactionProjection,
} from "./projection";

export type DurableAttemptHandle = Readonly<{
	number: number;
	heartbeat(progress?: Readonly<{ completed: number }>): Promise<void>;
}>;

export type DurableAttemptRequest = Readonly<{
	claim: DurableClaim;
	reaction: LinkedReactionMember;
	input: unknown;
	contextInput: unknown;
	principal: Readonly<{ kind: "anonymous" | "service" | "user"; id: string }>;
	signal: AbortSignal;
	run: DurableRunHandle;
	attempt: DurableAttemptHandle;
	errors: Readonly<Record<string, (payload?: unknown) => Error>>;
}>;

export type DurableAttemptExecutor = (
	request: DurableAttemptRequest,
) => Promise<unknown>;

export type DurableWorkerOutcome = Readonly<{
	runId: string;
	resource: string;
	attemptNumber: number;
	outcome:
		| "cancelled"
		| "failed"
		| "fenced"
		| "refusedIncompatible"
		| "retryScheduled"
		| "skipped"
		| "succeeded";
	failureCode: DurableFailureCode | "EXECUTABLE_RETIRED" | null;
}>;

export type DurableWorkerTrace = Readonly<{
	workerId: string;
	admitted: number;
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

function errorFactories(
	reaction: LinkedReactionMember,
): Readonly<Record<string, (payload?: unknown) => Error>> {
	return Object.freeze(
		Object.fromEntries(
			Object.entries(reaction.declaredErrors).map(([key, declared]) => [
				key,
				(payload: unknown = null) =>
					new DeclaredOperationError(declared.code, declared.status, payload),
			]),
		),
	);
}

function isRunAsDenial(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	const code = (error as Readonly<{ code?: unknown }>).code;
	return code === "notFound" || code === "unauthenticated";
}

function classify(error: unknown): DurableFailureCode {
	if (error instanceof DeclaredOperationError) return "REACTION_ERROR";
	if (error instanceof DurableEffectAmbiguous) return "EFFECT_AMBIGUOUS";
	if (error instanceof DurableEffectConflict) return "EFFECT_CONFLICT";
	if (isRunAsDenial(error)) return "RUN_AS_DENIED";
	return "HANDLER_FAILED";
}

export function createDurableReactionWorker(
	input: Readonly<{
		kernel: DurableKernel;
		ledger: DurableEffectLedger;
		reactions: LinkedReactionProjection;
		execute: DurableAttemptExecutor;
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
	let draining = false;

	const runAttempt = async (
		claim: DurableClaim,
		reaction: LinkedReactionMember,
	): Promise<DurableWorkerOutcome> => {
		const controller = new AbortController();
		let fenced = false;
		let cancelled = claim.cancellationRequested;
		const observe = async (): Promise<void> => {
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
			if (beat.deadlineExpired)
				controller.abort(new DOMException("Attempt deadline", "AbortError"));
		};
		const timer = setInterval(() => {
			void observe().catch(() => undefined);
		}, heartbeatMilliseconds);
		let failureCode: DurableFailureCode | null = null;
		let resultBytes: Uint8Array | null = null;
		try {
			if (cancelled)
				controller.abort(new DOMException("Run cancelled", "AbortError"));
			const decodedInput = decodeRuntimeCodec(
				reaction.input,
				JSON.parse(new TextDecoder().decode(claim.payloadBytes)),
				"$reaction.input",
			);
			const result = await input.execute({
				claim,
				reaction,
				input: decodedInput,
				contextInput: JSON.parse(
					new TextDecoder().decode(claim.contextInputBytes),
				),
				principal: claim.principal,
				signal: controller.signal,
				run: createDurableRunHandle({
					ledger: input.ledger,
					claim,
					declaredEffects: reaction.effects,
					signal: controller.signal,
				}),
				attempt: Object.freeze({
					number: claim.attemptNumber,
					heartbeat: observe,
				}),
				errors: errorFactories(reaction),
			});
			const validated = decodeRuntimeCodec(
				reaction.output,
				encodeRuntimeCodec(reaction.output, result, "$reaction.result"),
				"$reaction.result",
			);
			const bytes = canonicalMutationBytes(
				encodeRuntimeCodec(reaction.output, validated, "$reaction.result"),
			);
			if (bytes.byteLength > resultBytesLimit) failureCode = "RESOURCE_LIMIT";
			else resultBytes = bytes;
		} catch (error) {
			if (error instanceof DurableLeaseLost) fenced = true;
			else if (cancelled) failureCode = null;
			else failureCode = classify(error);
		} finally {
			clearInterval(timer);
		}
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
		return Object.freeze({
			runId: claim.runId,
			resource: claim.resource,
			attemptNumber: claim.attemptNumber,
			outcome:
				transition.status === "fenced"
					? "fenced"
					: transition.state === "delayed"
						? "retryScheduled"
						: "failed",
			failureCode: code,
		});
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
					claimed: 0,
					refusedIncompatible: 0,
					outcomes: Object.freeze([]),
				});
			const admissions = await input.kernel.admit(claimBatch);
			const outcomes: DurableWorkerOutcome[] = [];
			let claimed = 0;
			let refusedIncompatible = 0;
			for (const admission of admissions) {
				const reaction = input.reactions.byIdentity.get(admission.resource);
				if (
					!reaction ||
					reaction.contractDigest !== admission.executableDigest
				) {
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
				outcomes.push(await runAttempt(outcome.claim, reaction));
			}
			return Object.freeze({
				workerId,
				admitted: admissions.length,
				claimed,
				refusedIncompatible,
				outcomes: Object.freeze(outcomes),
			});
		},
	});
}
