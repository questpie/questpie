import {
	QuestpiePostgresError,
	type PostgresDatabase,
	type PostgresDatabaseConfiguration,
} from "./contract";
import { createPostgresDatabase } from "./index";
import {
	createPostgresListener,
	type PostgresChannel,
	type PostgresListener,
	type PostgresReconcileReason,
} from "./listener";

type ListenerInput = Readonly<{
	channel: PostgresChannel;
	fallbackIntervalMs: number;
	reconcile(
		input: Readonly<{
			reason: PostgresReconcileReason;
			database: PostgresDatabase;
			signal: AbortSignal;
		}>,
	): Promise<void>;
}>;

export interface RuntimePostgres {
	transaction: PostgresDatabase["transaction"];
	listen(input: ListenerInput): Promise<PostgresListener>;
	rotate(
		input: Readonly<{
			configuration: PostgresDatabaseConfiguration;
			deadlineAt: number;
			verify(candidate: PostgresDatabase): Promise<void>;
		}>,
	): Promise<void>;
	facts(): Readonly<{
		state: "ready" | "rotating" | "draining" | "closed";
		generation: number;
		pool: ReturnType<PostgresDatabase["facts"]>["pool"];
		listener: "disabled" | ReturnType<PostgresListener["facts"]>;
		counters: Readonly<{
			checkoutTimeouts: number;
			statementTimeouts: number;
			cancellations: number;
			destroyedConnections: number;
			rotations: number;
		}>;
	}>;
	close(input: Readonly<{ deadlineAt: number }>): Promise<void>;
}

type Generation = {
	configuration: PostgresDatabaseConfiguration;
	database: PostgresDatabase;
	listener?: PostgresListener;
};

async function beforeDeadline<Value>(
	work: Promise<Value>,
	deadlineAt: number,
): Promise<Value> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			work,
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(
					() =>
						reject(
							new QuestpiePostgresError({
								code: "connectTimeout",
								phase: "connect",
							}),
						),
					Math.max(0, deadlineAt - Date.now()),
				);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

async function settleBeforeDeadline(
	work: Promise<unknown>,
	deadlineAt: number,
): Promise<void> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	await Promise.race([
		work.catch(() => {}),
		new Promise<void>((resolve) => {
			timer = setTimeout(resolve, Math.max(0, deadlineAt - Date.now()));
		}),
	]);
	if (timer) clearTimeout(timer);
}

export function createRuntimePostgres(
	configuration: PostgresDatabaseConfiguration,
): RuntimePostgres {
	let state: "ready" | "rotating" | "draining" | "closed" = "ready";
	let generation = 1;
	let rotations = 0;
	let current: Generation = {
		configuration,
		database: createPostgresDatabase(configuration),
	};
	let listenerInput: ListenerInput | undefined;
	let listenerStartup: Promise<PostgresListener> | undefined;
	let rotation: Promise<void> | undefined;
	let rotationCandidate: Generation | undefined;
	let closing: Promise<void> | undefined;
	const retired = {
		checkoutTimeouts: 0,
		statementTimeouts: 0,
		cancellations: 0,
		destroyedConnections: 0,
	};

	const transaction: RuntimePostgres["transaction"] = (input) => {
		if (state === "draining" || state === "closed")
			return Promise.reject(
				new QuestpiePostgresError({ code: state, phase: "checkout" }),
			);
		return current.database.transaction(input);
	};

	const createListener = (
		database: PostgresDatabase,
		directConnectionUrl: string,
		input: ListenerInput,
	): Promise<PostgresListener> =>
		createPostgresListener({
			directConnectionUrl,
			database,
			...input,
		});

	const lifecycleFailure = (phase: "connect" | "checkout") =>
		new QuestpiePostgresError({
			code:
				state === "draining" || state === "closed" ? state : "configuration",
			phase,
		});

	const runtime: RuntimePostgres = {
		transaction,
		listen(input: ListenerInput) {
			if (state !== "ready" || listenerInput || listenerStartup || rotation)
				return Promise.reject(lifecycleFailure("connect"));
			listenerInput = input;
			let startup!: Promise<PostgresListener>;
			startup = (async () => {
				let listener: PostgresListener | undefined;
				try {
					listener = await createListener(
						current.database,
						current.configuration.directConnectionUrl,
						input,
					);
					if (state !== "ready") throw lifecycleFailure("connect");
					const ownedListener = listener;
					current.listener = ownedListener;
					const facade: PostgresListener = Object.freeze({
						facts() {
							return current.listener?.facts() ?? ownedListener.facts();
						},
						requestReconcile() {
							current.listener?.requestReconcile();
						},
						async close(closeInput: Readonly<{ deadlineAt: number }>) {
							listenerInput = undefined;
							const active = current.listener;
							current.listener = undefined;
							await active?.close(closeInput);
						},
					});
					return facade;
				} catch (error) {
					listenerInput = undefined;
					await listener?.close({ deadlineAt: Date.now() + 1_000 });
					throw error;
				} finally {
					if (listenerStartup === startup) listenerStartup = undefined;
				}
			})();
			listenerStartup = startup;
			return startup;
		},
		rotate(input) {
			if (state !== "ready" || listenerStartup || rotation)
				return Promise.reject(lifecycleFailure("connect"));
			state = "rotating";
			let operation!: Promise<void>;
			operation = (async () => {
				let candidate: Generation | undefined;
				try {
					candidate = {
						configuration: input.configuration,
						database: createPostgresDatabase(input.configuration),
					};
					rotationCandidate = candidate;
					await beforeDeadline(
						input.verify(candidate.database),
						input.deadlineAt,
					);
					if (state !== "rotating") throw lifecycleFailure("connect");
					if (listenerInput) {
						const startingListener = createListener(
							candidate.database,
							input.configuration.directConnectionUrl,
							listenerInput,
						);
						try {
							candidate.listener = await beforeDeadline(
								startingListener,
								input.deadlineAt,
							);
						} catch (error) {
							void startingListener
								.then((listener) =>
									listener.close({ deadlineAt: input.deadlineAt }),
								)
								.catch(() => {});
							throw error;
						}
					}
					if (state !== "rotating") throw lifecycleFailure("connect");
				} catch (error) {
					await candidate?.listener?.close({ deadlineAt: input.deadlineAt });
					await candidate?.database.close({ deadlineAt: input.deadlineAt });
					if (state === "rotating") state = "ready";
					throw error;
				}

				const previous = current;
				const previousCounters = previous.database.facts().counters;
				retired.checkoutTimeouts += previousCounters.checkoutTimeouts;
				retired.statementTimeouts += previousCounters.statementTimeouts;
				retired.cancellations += previousCounters.cancellations;
				retired.destroyedConnections += previousCounters.destroyedConnections;
				current = candidate;
				rotationCandidate = undefined;
				generation += 1;
				rotations += 1;
				await previous.listener?.close({ deadlineAt: input.deadlineAt });
				await previous.database.close({ deadlineAt: input.deadlineAt });
				if (state !== "rotating") throw lifecycleFailure("connect");
				state = "ready";
			})().finally(() => {
				rotationCandidate = undefined;
				if (rotation === operation) rotation = undefined;
			});
			rotation = operation;
			return operation;
		},
		facts() {
			const facts = current.database.facts();
			return Object.freeze({
				state,
				generation,
				pool: facts.pool,
				listener: current.listener?.facts() ?? "disabled",
				counters: Object.freeze({
					checkoutTimeouts:
						retired.checkoutTimeouts + facts.counters.checkoutTimeouts,
					statementTimeouts:
						retired.statementTimeouts + facts.counters.statementTimeouts,
					cancellations: retired.cancellations + facts.counters.cancellations,
					destroyedConnections:
						retired.destroyedConnections + facts.counters.destroyedConnections,
					rotations,
				}),
			});
		},
		close(input) {
			if (closing) return closing;
			state = "draining";
			closing = (async () => {
				await settleBeforeDeadline(
					Promise.allSettled([rotation, listenerStartup]),
					input.deadlineAt,
				);
				await rotationCandidate?.listener?.close(input);
				await rotationCandidate?.database.close(input);
				await current.listener?.close(input);
				await current.database.close(input);
				state = "closed";
			})();
			return closing;
		},
	};
	return Object.freeze(runtime);
}
