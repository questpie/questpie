import type { SQL } from "bun";

import {
	createPostgresLiveQueryRetention,
	createPostgresRealtimeScopeStore,
	createPostgresReconciliationWake,
	reconcilePostgresChangeLedger,
	type PostgresLiveQueryInvalidationEffect,
	type PostgresWakeTickSource,
} from "../../live-query";
import {
	definePostgresChannel,
	type PostgresListener,
	type PostgresTransactionRunner,
	type RuntimePostgres,
} from "../../postgres";

export type PostgresCoordinatorRuntimeSelection =
	| Readonly<{
			postgres: Pick<RuntimePostgres, "transaction" | "listen">;
			sql?: never;
			tickSource?: never;
	  }>
	| Readonly<{
			postgres?: never;
			sql: SQL;
			tickSource?: PostgresWakeTickSource;
	  }>;

type RuntimeInput = PostgresCoordinatorRuntimeSelection &
	Readonly<{
		applicationName: string;
		effect: PostgresLiveQueryInvalidationEffect;
		hmacKey: Uint8Array;
		signal?: AbortSignal;
	}>;

export function createPostgresCoordinatorRuntime(input: RuntimeInput) {
	const stableDatabase: PostgresTransactionRunner | undefined = input.postgres
		? Object.freeze({ transaction: input.postgres.transaction })
		: undefined;
	const persistence = (database?: PostgresTransactionRunner) => {
		const source = input.postgres
			? { database: database ?? stableDatabase! }
			: { sql: input.sql };
		return Object.freeze({
			store: createPostgresRealtimeScopeStore(source),
			retention: createPostgresLiveQueryRetention({
				...source,
				hmacKey: input.hmacKey,
			}),
		});
	};
	const reconcileLedger = (
		database: PostgresTransactionRunner | undefined,
		signal: AbortSignal,
	) =>
		reconcilePostgresChangeLedger({
			...(input.postgres ? { database: database! } : { sql: input.sql }),
			application: input.applicationName,
			consumer: input.effect.consumer,
			apply() {},
			effect: input.effect,
			signal,
		});
	const boundedSignal = (signal: AbortSignal): AbortSignal =>
		AbortSignal.any(
			[input.signal, signal, AbortSignal.timeout(10_000)].filter(
				(candidate): candidate is AbortSignal => candidate !== undefined,
			),
		);
	let reconcileFull:
		| ((
				database: PostgresTransactionRunner | undefined,
				signal: AbortSignal,
		  ) => Promise<void>)
		| undefined;
	const runFullReconciliation = (
		database: PostgresTransactionRunner | undefined,
		signal: AbortSignal,
	): Promise<void> => {
		if (!reconcileFull)
			return Promise.reject(
				new Error("Live Query coordinator reconciliation is not bound"),
			);
		return reconcileFull(database, signal);
	};
	let wake = input.postgres
		? undefined
		: createPostgresReconciliationWake({
				reconcile: (signal) => runFullReconciliation(undefined, signal),
				tickSource: input.tickSource,
				signal: input.signal,
			});
	let listener: PostgresListener | undefined;

	return Object.freeze({
		databaseMode: input.postgres !== undefined,
		steady: persistence(),
		persistence,
		reconcileLedger,
		bindReconciliation(
			reconcile: (
				database: PostgresTransactionRunner | undefined,
				signal: AbortSignal,
			) => Promise<void>,
		): void {
			if (reconcileFull)
				throw new Error(
					"Live Query coordinator reconciliation is already bound",
				);
			reconcileFull = reconcile;
		},
		async start(): Promise<void> {
			if (input.postgres) {
				listener = await input.postgres.listen({
					channel: definePostgresChannel("questpie_change"),
					fallbackIntervalMs: 10_000,
					reconcile: ({ admission, database, signal }) => {
						const bounded = boundedSignal(signal);
						return admission === "candidate"
							? reconcileLedger(database, bounded).then(() => undefined)
							: runFullReconciliation(database, bounded);
					},
				});
				return;
			}
			await wake!.start();
		},
		requestScan(): Promise<void> {
			if (listener) return listener.requestReconcile();
			if (wake) return wake.requestScan();
			return Promise.reject(new Error("Live Query coordinator is not started"));
		},
		async drain(): Promise<void> {
			await listener?.close({ deadlineAt: Date.now() + 30_000 });
			listener = undefined;
			await wake?.drain();
			wake = undefined;
		},
	});
}
