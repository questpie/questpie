export type StaticScheduleProducerOutcome =
	| Readonly<{
			status: "active" | "inactive";
			accepted: number;
			examined: number;
	  }>
	| Readonly<{ status: "failed"; code: "SCHEDULE_PRODUCER_FAILED" }>
	| Readonly<{ status: "draining" }>;

export interface StaticScheduleProducer {
	poll(): Promise<StaticScheduleProducerOutcome>;
	beginDrain(): void;
}

/** The existing worker owns polling and drain; this is no timer or second worker. */
export function createStaticScheduleProducer(
	input: Readonly<{
		signal: AbortSignal;
		reconcile(request: Readonly<{ signal: AbortSignal }>): Promise<
			Readonly<{
				status: "active" | "inactive";
				accepted: number;
				examined: number;
			}>
		>;
	}>,
): StaticScheduleProducer {
	const controller = new AbortController();
	const signal = AbortSignal.any([input.signal, controller.signal]);
	let pending: Promise<StaticScheduleProducerOutcome> | undefined;
	return Object.freeze({
		poll() {
			if (signal.aborted)
				return Promise.resolve(Object.freeze({ status: "draining" as const }));
			if (pending) return pending;
			pending = Promise.resolve()
				.then(() => {
					signal.throwIfAborted();
					return input.reconcile({ signal });
				})
				.then(
					(outcome): StaticScheduleProducerOutcome => {
						if (signal.aborted) return Object.freeze({ status: "draining" });
						if (
							(outcome.status !== "active" && outcome.status !== "inactive") ||
							!Number.isSafeInteger(outcome.accepted) ||
							!Number.isSafeInteger(outcome.examined) ||
							outcome.accepted < 0 ||
							outcome.examined < outcome.accepted ||
							outcome.examined > 64
						)
							return Object.freeze({
								status: "failed",
								code: "SCHEDULE_PRODUCER_FAILED",
							});
						return Object.freeze({
							status: outcome.status,
							accepted: outcome.accepted,
							examined: outcome.examined,
						});
					},
					(): StaticScheduleProducerOutcome =>
						signal.aborted
							? Object.freeze({ status: "draining" })
							: Object.freeze({
									status: "failed",
									code: "SCHEDULE_PRODUCER_FAILED",
								}),
				)
				.finally(() => {
					pending = undefined;
				});
			return pending;
		},
		beginDrain() {
			controller.abort(
				new DOMException("Durable worker draining", "AbortError"),
			);
		},
	});
}
