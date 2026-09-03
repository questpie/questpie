import { AsyncLocalStorage } from "node:async_hooks";

import {
	observePostgresTransaction,
	postgresObservationFailure,
	type PrincipalKind,
	type RuntimeExecutionObservation,
} from "../observation";
import type { PostgresTransactionRunner } from "../postgres";

type AttemptObservationDecision = Readonly<{
	observation: RuntimeExecutionObservation;
	principalKind: PrincipalKind;
	signal: AbortSignal | undefined;
}> | null;

declare const durableAttemptPostgresRunnerType: unique symbol;
export type DurableAttemptPostgresTransactionRunner =
	PostgresTransactionRunner &
		Readonly<{ [durableAttemptPostgresRunnerType]: true }>;

const durableAttemptPostgresRunners = new WeakSet<object>();

export function assertDurableAttemptPostgresTransactionRunner(
	database: PostgresTransactionRunner,
): asserts database is DurableAttemptPostgresTransactionRunner {
	if (!durableAttemptPostgresRunners.has(database))
		throw new TypeError("Durable Attempt PostgreSQL runner is required");
}

/** Owns the explicit observation decision for PostgreSQL work inside one Attempt. */
export function createPostgresDatabaseDurableAttemptObservation(
	input: Readonly<{ database: PostgresTransactionRunner }>,
): Readonly<{
	database: DurableAttemptPostgresTransactionRunner;
	run<Result>(
		decision: Readonly<{
			observation: RuntimeExecutionObservation | null;
			principalKind: PrincipalKind;
			signal: AbortSignal | undefined;
			use(): Result | Promise<Result>;
		}>,
	): Promise<Awaited<Result>>;
}> {
	const active = new AsyncLocalStorage<AttemptObservationDecision>();
	const database: PostgresTransactionRunner = Object.freeze({
		transaction: async (transactionInput) => {
			const decision = active.getStore();
			if (decision === undefined)
				throw new TypeError(
					"Durable Attempt PostgreSQL observation decision is required",
				);
			return input.database.transaction({
				...transactionInput,
				use: (rawTransaction) =>
					transactionInput.use(
						decision === null
							? rawTransaction
							: observePostgresTransaction({
									execution: decision.observation,
									failure: (error) =>
										postgresObservationFailure(error, decision.signal),
									principalKind: decision.principalKind,
									transaction: rawTransaction,
								}),
					),
			});
		},
	});
	durableAttemptPostgresRunners.add(database);

	return Object.freeze({
		database: database as DurableAttemptPostgresTransactionRunner,
		async run<Result>(decision: {
			observation: RuntimeExecutionObservation | null;
			principalKind: PrincipalKind;
			signal: AbortSignal | undefined;
			use(): Result | Promise<Result>;
		}): Promise<Awaited<Result>> {
			if (decision.observation === undefined)
				throw new TypeError(
					"Durable Attempt PostgreSQL observation decision is required",
				);
			if (active.getStore() !== undefined)
				throw new TypeError(
					"Durable Attempt PostgreSQL observation decision is already active",
				);
			const store =
				decision.observation === null
					? null
					: Object.freeze({
							observation: decision.observation,
							principalKind: decision.principalKind,
							signal: decision.signal,
						});
			return await active.run(store, decision.use);
		},
	});
}
