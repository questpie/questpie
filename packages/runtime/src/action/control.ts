import type { ExecutionFacts } from "../execution";
import { OperationFailure } from "../operation";

type ActionExecutionFacts = ExecutionFacts<
	Readonly<{ tenant: Readonly<{ id: string }>; values: unknown }>
>;

export type RuntimeActionLimits = Readonly<{
	inputBytes: number;
	resultBytes: number;
	durationMilliseconds: number;
}>;

function positiveSafeInteger(value: unknown): boolean {
	return Number.isSafeInteger(value) && Number(value) > 0;
}

export function validActionLimits(
	value: unknown,
): value is RuntimeActionLimits {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const limits = value as Readonly<Record<string, unknown>>;
	const keys = Object.keys(limits).sort();
	return (
		keys.length === 3 &&
		keys[0] === "durationMilliseconds" &&
		keys[1] === "inputBytes" &&
		keys[2] === "resultBytes" &&
		positiveSafeInteger(limits.inputBytes) &&
		positiveSafeInteger(limits.resultBytes) &&
		Number.isSafeInteger(limits.durationMilliseconds) &&
		Number(limits.durationMilliseconds) >= 0
	);
}

export type RuntimeActionClock = Readonly<{
	cancel(timer: unknown): void;
	monotonicNow(): number;
	rootRemainingMilliseconds(facts: ActionExecutionFacts): number | null;
	schedule(callback: () => void, delayMilliseconds: number): unknown;
}>;

const maximumHostTimerDelay = 2_147_483_647;

export function actionMonotonicNow(clock: RuntimeActionClock): number {
	let current: number;
	try {
		current = clock.monotonicNow();
	} catch {
		throw new OperationFailure("INTERNAL");
	}
	if (!Number.isFinite(current) || current < 0)
		throw new OperationFailure("INTERNAL");
	return current;
}

function saturatedDeadline(startedAt: number, duration: number): number {
	return Math.min(Number.MAX_SAFE_INTEGER, startedAt + duration);
}

export function createActionControl(
	facts: ActionExecutionFacts,
	durationMilliseconds: number,
	startedAt: number,
	clock: RuntimeActionClock,
): Readonly<{
	signal: AbortSignal;
	throwIfExpired(): void;
	close(): void;
}> {
	let rootRemaining: number | null;
	try {
		rootRemaining = clock.rootRemainingMilliseconds(facts);
	} catch {
		throw new OperationFailure("INTERNAL");
	}
	if (
		rootRemaining !== null &&
		(!Number.isFinite(rootRemaining) || rootRemaining < 0)
	)
		throw new OperationFailure("INTERNAL");
	const deadline = Math.min(
		saturatedDeadline(startedAt, durationMilliseconds),
		rootRemaining === null
			? Number.MAX_SAFE_INTEGER
			: saturatedDeadline(startedAt, rootRemaining),
	);
	const deadlineReason = new OperationFailure("DEADLINE_EXCEEDED");
	const remaining = deadline - actionMonotonicNow(clock);
	if (durationMilliseconds === 0 || remaining <= 0) throw deadlineReason;
	const controller = new AbortController();
	const onRootAbort = () => controller.abort(facts.signal.reason);
	if (facts.signal.aborted) onRootAbort();
	else facts.signal.addEventListener("abort", onRootAbort, { once: true });
	let closed = false;
	let timer: unknown;
	let timerArmed = false;
	const arm = (): void => {
		if (closed || controller.signal.aborted) return;
		let current: number;
		try {
			current = actionMonotonicNow(clock);
		} catch (error) {
			controller.abort(error);
			return;
		}
		const localRemaining = deadline - current;
		if (localRemaining <= 0) {
			controller.abort(deadlineReason);
			return;
		}
		let scheduleReturned = false;
		try {
			timer = clock.schedule(
				() => {
					timerArmed = false;
					if (!scheduleReturned) {
						controller.abort(new OperationFailure("INTERNAL"));
						return;
					}
					arm();
				},
				Math.min(localRemaining, maximumHostTimerDelay),
			);
			timerArmed = true;
			scheduleReturned = true;
		} catch {
			controller.abort(new OperationFailure("INTERNAL"));
		}
	};
	arm();
	return Object.freeze({
		signal: controller.signal,
		throwIfExpired() {
			if (!controller.signal.aborted)
				try {
					if (actionMonotonicNow(clock) >= deadline)
						controller.abort(deadlineReason);
				} catch (error) {
					controller.abort(error);
				}
			controller.signal.throwIfAborted();
		},
		close() {
			closed = true;
			try {
				if (timerArmed) clock.cancel(timer);
			} catch {
				// Timer cleanup is terminal and cannot replace the Action outcome.
			} finally {
				timerArmed = false;
				facts.signal.removeEventListener("abort", onRootAbort);
			}
		},
	});
}
