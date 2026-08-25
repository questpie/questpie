import {
	createPostgresLiveQueryRetention,
	createPostgresRealtimeScopeStore,
	reconcilePostgresChangeLedger,
	type PostgresLiveQueryInvalidationEffect,
} from "../../live-query";
import {
	definePostgresChannel,
	type PostgresListener,
	type PostgresTransactionRunner,
	type RuntimePostgres,
} from "../../postgres";

export type PostgresCoordinatorRuntimeSelection = Readonly<{
	postgres: Pick<RuntimePostgres, "transaction" | "listen">;
}>;

type RuntimeInput = PostgresCoordinatorRuntimeSelection &
	Readonly<{
		applicationName: string;
		effect: PostgresLiveQueryInvalidationEffect;
		hmacKey: Uint8Array;
		signal?: AbortSignal;
	}>;

export function createPostgresCoordinatorRuntime(input: RuntimeInput) {
	const stableDatabase: PostgresTransactionRunner = Object.freeze({
		transaction: input.postgres.transaction,
	});
	const persistence = (database?: PostgresTransactionRunner) => {
		const current = database ?? stableDatabase;
		return Object.freeze({
			store: createPostgresRealtimeScopeStore({ database: current }),
			retention: createPostgresLiveQueryRetention({
				database: current,
				hmacKey: input.hmacKey,
			}),
		});
	};
	const reconcileLedger = (
		database: PostgresTransactionRunner | undefined,
		signal: AbortSignal,
	) =>
		reconcilePostgresChangeLedger({
			database: database ?? stableDatabase,
			application: input.applicationName,
			consumer: input.effect.consumer,
			apply() {},
			effect: input.effect,
			signal,
		});
	const drainController = new AbortController();
	const boundedSignal = (signal: AbortSignal): AbortSignal =>
		AbortSignal.any(
			[
				input.signal,
				signal,
				drainController.signal,
				AbortSignal.timeout(10_000),
			].filter(
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
		database: PostgresTransactionRunner,
		signal: AbortSignal,
	): Promise<void> => {
		if (!reconcileFull)
			return Promise.reject(
				new Error("Live Query coordinator reconciliation is not bound"),
			);
		return reconcileFull(database, signal);
	};
	let listener: PostgresListener | undefined;
	let draining = false;
	let drainDeadlineAt: number | undefined;

	return Object.freeze({
		databaseMode: true,
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
			const started = await input.postgres.listen({
				channel: definePostgresChannel("questpie_change"),
				fallbackIntervalMs: 10_000,
				reconcile: ({ admission, database, signal }) => {
					drainController.signal.throwIfAborted();
					const bounded = boundedSignal(signal);
					bounded.throwIfAborted();
					return admission === "candidate"
						? reconcileLedger(database, bounded).then(() => undefined)
						: runFullReconciliation(database, bounded);
				},
			});
			if (draining) {
				await started.close({ deadlineAt: drainDeadlineAt ?? Date.now() });
				throw new Error("Live Query coordinator stopped during startup");
			}
			listener = started;
		},
		requestScan(): Promise<void> {
			if (listener) return listener.requestReconcile();
			return Promise.reject(new Error("Live Query coordinator is not started"));
		},
		async drain(input: Readonly<{ deadlineAt: number }>): Promise<void> {
			draining = true;
			drainDeadlineAt ??= input.deadlineAt;
			drainController.abort(
				new DOMException("Live Query coordinator draining", "AbortError"),
			);
			await listener?.close({ deadlineAt: drainDeadlineAt });
			listener = undefined;
		},
	});
}
