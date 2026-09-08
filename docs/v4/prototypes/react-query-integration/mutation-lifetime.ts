import type { QueryClient } from "@tanstack/query-core";

import type { MutationDescriptor } from "./projection-contract";

type RetiredOutcome =
	| Readonly<{ kind: "not-dispatched" }>
	| Readonly<{ kind: "committed"; callId: string; transactionId?: string }>
	| Readonly<{ kind: "unknown" | "rejected"; callId: string }>;

export class RetiredMutation extends Error {
	readonly code = "SCOPE_RETIRED";
	readonly outcome: RetiredOutcome;
	constructor(outcome: RetiredOutcome) {
		super("SCOPE_RETIRED");
		this.outcome = Object.freeze(outcome);
		Object.freeze(this);
	}
}

/** Native Mutation state remains owned by TanStack; this only retires a scope. */
export function createMutationLifetime(
	client: QueryClient,
	prefix: readonly string[],
) {
	let retired = false;
	const cache = client.getMutationCache();
	const observers = new Map<object, () => void>();
	const owns = (key: readonly unknown[] | undefined) =>
		key !== undefined && key[0] === prefix[0] && key[1] === prefix[1];
	const unsubscribe = cache.subscribe((event) => {
		if (event.type === "observerRemoved") {
			observers.delete(event.observer);
			return;
		}
		if (
			event.type === "observerAdded" &&
			owns(event.mutation.options.mutationKey)
		)
			observers.set(event.observer, () => event.observer.reset());
	});
	return {
		async invoke<Input, Output>(
			descriptor: MutationDescriptor<Input, Output, unknown>,
			input: Input,
		): Promise<Output> {
			if (retired) throw new RetiredMutation({ kind: "not-dispatched" });
			const callId = crypto.randomUUID();
			let result: Output;
			try {
				result = await descriptor.invoke(input, { callId });
			} catch (error) {
				if (retired) {
					const failure = descriptor.failure(error);
					throw new RetiredMutation(
						failure?.callId === callId ? failure : { kind: "unknown", callId },
					);
				}
				throw error;
			}
			if (retired) throw new RetiredMutation({ kind: "committed", callId });
			return result;
		},
		dispose() {
			retired = true;
			unsubscribe();
			const failures: unknown[] = [];
			for (const reset of observers.values()) {
				try {
					reset();
				} catch (error) {
					failures.push(error);
				}
			}
			observers.clear();
			for (const mutation of cache.getAll()) {
				if (!owns(mutation.options.mutationKey)) continue;
				try {
					cache.remove(mutation);
				} catch (error) {
					failures.push(error);
				}
			}
			if (failures.length)
				throw new AggregateError(
					failures,
					"Mutation subscriber cleanup failed",
				);
		},
	};
}
