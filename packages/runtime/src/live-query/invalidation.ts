import { matchesObservedLiveQueryPlan } from "./dependency-plan";
import type { ObservedLiveQueryPlanV1 } from "./observation";
import type { ChangeLedgerFactV1 } from "./postgres";
import type { LinkedLiveQueryProgramV1 } from "./program";

export type LiveQueryRecomputeResultV1 =
	| Readonly<{
			status: "success";
			plan: ObservedLiveQueryPlanV1;
	  }>
	| Readonly<{ status: "failed" | "revoked" }>;

export type LiveQueryInvalidationResultV1 = Readonly<{
	batches: readonly number[];
	recomputed: number;
	failed: readonly string[];
	revoked: readonly string[];
}>;

export type PreparedLiveQueryInvalidationV1 = Readonly<{
	result: LiveQueryInvalidationResultV1;
	commit(): void;
}>;

export interface LiveQueryInvalidation {
	register(
		input: Readonly<{
			watch: string;
			plan: ObservedLiveQueryPlanV1;
			recompute():
				| LiveQueryRecomputeResultV1
				| Promise<LiveQueryRecomputeResultV1>;
		}>,
	): () => void;
	invalidate(
		facts: readonly ChangeLedgerFactV1[],
	): Promise<LiveQueryInvalidationResultV1>;
	prepare(
		facts: readonly ChangeLedgerFactV1[],
	): Promise<PreparedLiveQueryInvalidationV1>;
	currentPlan(watch: string): ObservedLiveQueryPlanV1 | undefined;
}

type Watch = {
	plan: ObservedLiveQueryPlanV1;
	recompute(): LiveQueryRecomputeResultV1 | Promise<LiveQueryRecomputeResultV1>;
};

function matches(
	plan: ObservedLiveQueryPlanV1,
	facts: readonly ChangeLedgerFactV1[],
): boolean {
	return facts.some((fact) => matchesObservedLiveQueryPlan(plan, fact));
}

export function createLiveQueryInvalidation(
	program: LinkedLiveQueryProgramV1,
): LiveQueryInvalidation {
	const watches = new Map<string, Watch>();
	const dirty = new Set<string>();
	let drainPromise: Promise<LiveQueryInvalidationResultV1> | undefined;

	const assertPlanWithinLimit = (plan: ObservedLiveQueryPlanV1): void => {
		if (plan.tokens.length > program.limits.dependencyTokensPerPlan)
			throw new TypeError("Live Query dependency token limit exceeded");
	};

	const drain = async (): Promise<LiveQueryInvalidationResultV1> => {
		const batches: number[] = [];
		const failed: string[] = [];
		const revoked: string[] = [];
		let recomputed = 0;
		while (dirty.size > 0) {
			const identities = [...dirty].slice(0, program.limits.fanoutPerBatch);
			for (const identity of identities) dirty.delete(identity);
			const batch = identities.flatMap((identity) => {
				const watch = watches.get(identity);
				return watch ? [[identity, watch] as const] : [];
			});
			if (batch.length === 0) continue;
			batches.push(batch.length);
			recomputed += batch.length;
			await Promise.all(
				batch.map(async ([identity, watch]) => {
					try {
						const result = await watch.recompute();
						if (result.status === "success") {
							assertPlanWithinLimit(result.plan);
							if (watches.get(identity) === watch) watch.plan = result.plan;
						} else if (result.status === "failed") failed.push(identity);
						else revoked.push(identity);
					} catch {
						failed.push(identity);
					}
				}),
			);
		}
		return Object.freeze({
			batches: Object.freeze(batches),
			recomputed,
			failed: Object.freeze(failed.toSorted()),
			revoked: Object.freeze(revoked.toSorted()),
		});
	};

	const invalidation: LiveQueryInvalidation = {
		register(input) {
			if (watches.has(input.watch))
				throw new TypeError(
					`Live Query watch ${input.watch} is already registered`,
				);
			assertPlanWithinLimit(input.plan);
			const watch: Watch = {
				plan: input.plan,
				recompute: input.recompute,
			};
			watches.set(input.watch, watch);
			return () => {
				if (watches.get(input.watch) === watch) {
					watches.delete(input.watch);
					dirty.delete(input.watch);
				}
			};
		},
		invalidate(facts) {
			for (const [identity, watch] of watches)
				if (matches(watch.plan, facts)) dirty.add(identity);
			if (!drainPromise) {
				drainPromise = Promise.resolve()
					.then(drain)
					.finally(() => {
						drainPromise = undefined;
					});
			}
			return drainPromise;
		},
		async prepare(facts) {
			const matching = [...watches].filter(([, watch]) =>
				matches(watch.plan, facts),
			);
			const batches: number[] = [];
			const failed: string[] = [];
			const revoked: string[] = [];
			const successful: Array<
				readonly [string, Watch, ObservedLiveQueryPlanV1]
			> = [];
			for (
				let offset = 0;
				offset < matching.length;
				offset += program.limits.fanoutPerBatch
			) {
				const batch = matching.slice(
					offset,
					offset + program.limits.fanoutPerBatch,
				);
				batches.push(batch.length);
				await Promise.all(
					batch.map(async ([identity, watch]) => {
						try {
							const result = await watch.recompute();
							if (result.status === "success") {
								assertPlanWithinLimit(result.plan);
								successful.push([identity, watch, result.plan]);
							} else if (result.status === "failed") failed.push(identity);
							else revoked.push(identity);
						} catch {
							failed.push(identity);
						}
					}),
				);
			}
			const result = Object.freeze({
				batches: Object.freeze(batches),
				recomputed: matching.length,
				failed: Object.freeze(failed.toSorted()),
				revoked: Object.freeze(revoked.toSorted()),
			});
			return Object.freeze({
				result,
				commit() {
					if (failed.length > 0 || revoked.length > 0)
						throw new TypeError(
							"failed Live Query invalidation cannot be committed",
						);
					for (const [identity, watch, plan] of successful)
						if (watches.get(identity) === watch) watch.plan = plan;
				},
			});
		},
		currentPlan(watch) {
			return watches.get(watch)?.plan;
		},
	};
	return Object.freeze(invalidation);
}
