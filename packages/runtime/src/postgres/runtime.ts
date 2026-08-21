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
	let listenerFacade: PostgresListener | undefined;
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

	const runtime: RuntimePostgres = {
		transaction,
		async listen(input: ListenerInput) {
			if (state !== "ready" || listenerInput)
				throw new QuestpiePostgresError({
					code:
						state === "draining" || state === "closed"
							? state
							: "configuration",
					phase: "connect",
				});
			const listener = await createListener(
				current.database,
				current.configuration.directConnectionUrl,
				input,
			);
			listenerInput = input;
			current.listener = listener;
			listenerFacade = Object.freeze({
				facts() {
					return current.listener?.facts() ?? listener.facts();
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
			return listenerFacade;
		},
		async rotate(input) {
			if (state !== "ready")
				throw new QuestpiePostgresError({
					code: state === "rotating" ? "configuration" : state,
					phase: "connect",
				});
			state = "rotating";
			let candidate: Generation | undefined;
			try {
				candidate = {
					configuration: input.configuration,
					database: createPostgresDatabase(input.configuration),
				};
				await input.verify(candidate.database);
				if (listenerInput)
					candidate.listener = await createListener(
						candidate.database,
						input.configuration.directConnectionUrl,
						listenerInput,
					);
			} catch (error) {
				await candidate?.listener?.close({ deadlineAt: input.deadlineAt });
				await candidate?.database.close({ deadlineAt: input.deadlineAt });
				state = "ready";
				throw error;
			}

			const previous = current;
			const previousCounters = previous.database.facts().counters;
			retired.checkoutTimeouts += previousCounters.checkoutTimeouts;
			retired.statementTimeouts += previousCounters.statementTimeouts;
			retired.cancellations += previousCounters.cancellations;
			retired.destroyedConnections += previousCounters.destroyedConnections;
			current = candidate;
			generation += 1;
			rotations += 1;
			await previous.listener?.close({ deadlineAt: input.deadlineAt });
			await previous.database.close({ deadlineAt: input.deadlineAt });
			state = "ready";
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
				await current.listener?.close(input);
				await current.database.close(input);
				state = "closed";
			})();
			return closing;
		},
	};
	return Object.freeze(runtime);
}
