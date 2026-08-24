import {
	transactionBrand,
	type PostgresStatement,
	type PostgresTransaction,
	type PostgresTransactionRunner,
} from "../../packages/runtime/src/postgres";

export const pb05RepresentativeOperations = Object.freeze({
	readiness: Object.freeze(["startup"]),
	context: Object.freeze(["rootBootstrap"]),
	query: Object.freeze(["firstPage", "cursorPage"]),
	mutation: Object.freeze(["fresh", "replay"]),
	realtime: Object.freeze(["reconciliation", "apply", "retention"]),
	durable: Object.freeze([
		"claim",
		"heartbeat",
		"effectReserve",
		"effectSettle",
		"terminal",
		"maintenance",
	]),
});

type Population = keyof typeof pb05RepresentativeOperations;
type ContentionOwner = "maintenance" | "reconciliation" | "retention";

type StatementObservation = Readonly<{
	population: string;
	operation: string;
	name: string;
	transaction: string;
	startedAtMs: number;
	finishedAtMs: number;
}>;

type IdleGapObservation = Readonly<{
	population: string;
	operation: string;
	phase: string;
	startedAtMs: number;
	finishedAtMs: number;
}>;

type ContentionObservation = Readonly<{
	owner: string;
	lockIdentity: string;
	startedAtMs: number;
	acquiredAtMs: number;
	finishedAtMs: number;
	outcome: "acquired" | "refused";
}>;

function finiteTime(value: number): boolean {
	return Number.isFinite(value) && value >= 0;
}

function population(value: string): value is Population {
	return Object.hasOwn(pb05RepresentativeOperations, value);
}

function operation(populationName: string, value: string): boolean {
	return (
		population(populationName) &&
		(
			pb05RepresentativeOperations[populationName] as readonly string[]
		).includes(value)
	);
}

function validStatement(value: StatementObservation): boolean {
	return (
		operation(value.population, value.operation) &&
		value.name.length > 0 &&
		value.transaction.length > 0 &&
		finiteTime(value.startedAtMs) &&
		finiteTime(value.finishedAtMs) &&
		value.finishedAtMs >= value.startedAtMs
	);
}

function validIdleGap(value: IdleGapObservation): boolean {
	const supported =
		(value.population === "mutation" &&
			value.operation === "fresh" &&
			value.phase === "handler") ||
		(value.population === "realtime" &&
			value.operation === "apply" &&
			value.phase === "apply");
	return (
		supported &&
		finiteTime(value.startedAtMs) &&
		finiteTime(value.finishedAtMs) &&
		value.finishedAtMs >= value.startedAtMs
	);
}

type Pb05IdleGapCallback =
	| Readonly<{
			population: "mutation";
			operation: "fresh";
			phase: "handler";
	  }>
	| Readonly<{
			population: "realtime";
			operation: "apply";
			phase: "apply";
	  }>;

function validIdleGapCallback(
	value: Readonly<{ population: string; operation: string; phase: string }>,
): value is Pb05IdleGapCallback {
	return (
		(value.population === "mutation" &&
			value.operation === "fresh" &&
			value.phase === "handler") ||
		(value.population === "realtime" &&
			value.operation === "apply" &&
			value.phase === "apply")
	);
}

function contentionOwner(value: string): value is ContentionOwner {
	return ["maintenance", "reconciliation", "retention"].includes(value);
}

function validContention(value: ContentionObservation): boolean {
	return (
		contentionOwner(value.owner) &&
		value.lockIdentity.length > 0 &&
		finiteTime(value.startedAtMs) &&
		finiteTime(value.acquiredAtMs) &&
		finiteTime(value.finishedAtMs) &&
		value.acquiredAtMs >= value.startedAtMs &&
		value.finishedAtMs >= value.acquiredAtMs &&
		(value.outcome === "acquired" ||
			(value.outcome === "refused" &&
				value.acquiredAtMs === value.finishedAtMs))
	);
}

function emptyContention() {
	return { samples: 0, waitMs: 0, heldMs: 0, acquired: 0 };
}

export function createPb05OperationalMeasurement() {
	const statements: StatementObservation[] = [];
	const idleGaps: IdleGapObservation[] = [];
	const contention: ContentionObservation[] = [];

	return Object.freeze({
		statement(value: StatementObservation): void {
			if (!validStatement(value))
				throw new TypeError("invalid PB-05 statement observation");
			statements.push(Object.freeze({ ...value }));
		},
		idleGap(value: IdleGapObservation): void {
			if (!validIdleGap(value))
				throw new TypeError("invalid PB-05 idle-gap observation");
			idleGaps.push(Object.freeze({ ...value }));
		},
		contention(value: ContentionObservation): void {
			if (!validContention(value))
				throw new TypeError("invalid PB-05 contention observation");
			contention.push(Object.freeze({ ...value }));
		},
		snapshot(options: Readonly<{ requireCompleteInventory?: boolean }> = {}) {
			if (options.requireCompleteInventory !== false)
				for (const [populationName, operations] of Object.entries(
					pb05RepresentativeOperations,
				))
					for (const operationName of operations)
						if (
							!statements.some(
								(statement) =>
									statement.population === populationName &&
									statement.operation === operationName,
							)
						)
							throw new TypeError(
								`missing PB-05 representative operation ${populationName}:${operationName}`,
							);

			const populations = Object.fromEntries(
				Object.keys(pb05RepresentativeOperations).map((populationName) => {
					const observed = statements.filter(
						(statement) => statement.population === populationName,
					);
					return [
						populationName,
						Object.freeze({
							statementExecutions: observed.length,
							distinctStatements: new Set(observed.map(({ name }) => name))
								.size,
							transactions: new Set(
								observed.map(({ transaction }) => transaction),
							).size,
						}),
					];
				}),
			);
			const operations = Object.fromEntries(
				Object.entries(pb05RepresentativeOperations).flatMap(
					([populationName, operationNames]) =>
						operationNames.map((operationName) => {
							const observed = statements.filter(
								(statement) =>
									statement.population === populationName &&
									statement.operation === operationName,
							);
							const startedAtMs = Math.min(
								...observed.map(({ startedAtMs }) => startedAtMs),
							);
							const finishedAtMs = Math.max(
								...observed.map(({ finishedAtMs }) => finishedAtMs),
							);
							return [
								`${populationName}:${operationName}`,
								Object.freeze({
									statementExecutions: observed.length,
									distinctStatements: Object.freeze([
										...new Set(observed.map(({ name }) => name)),
									]),
									transactions: new Set(
										observed.map(({ transaction }) => transaction),
									).size,
									durationMs:
										observed.length === 0 ? 0 : finishedAtMs - startedAtMs,
								}),
							];
						}),
				),
			);
			const gapSummary = Object.fromEntries(
				[
					...new Set(
						idleGaps.map(
							({ population, operation, phase }) =>
								`${population}:${operation}:${phase}`,
						),
					),
				].map((identity) => {
					const durations = idleGaps
						.filter(
							({ population, operation, phase }) =>
								`${population}:${operation}:${phase}` === identity,
						)
						.map(({ startedAtMs, finishedAtMs }) => finishedAtMs - startedAtMs);
					return [
						identity,
						Object.freeze({
							count: durations.length,
							totalMs: durations.reduce((total, value) => total + value, 0),
							maxMs: Math.max(...durations),
						}),
					];
				}),
			);
			const contentionSummary = {
				maintenance: emptyContention(),
				reconciliation: emptyContention(),
				retention: emptyContention(),
			};
			for (const sample of contention) {
				const summary = contentionSummary[sample.owner as ContentionOwner];
				summary.samples += 1;
				summary.waitMs += sample.acquiredAtMs - sample.startedAtMs;
				summary.heldMs += sample.finishedAtMs - sample.acquiredAtMs;
				if (sample.outcome === "acquired") summary.acquired += 1;
			}
			return Object.freeze({
				status: "PROVISIONAL_INTERNAL_EVIDENCE" as const,
				publicCeilings: false as const,
				populations: Object.freeze(populations),
				operations: Object.freeze(operations),
				idleGaps: Object.freeze(gapSummary),
				contention: Object.freeze(
					Object.fromEntries(
						Object.entries(contentionSummary).map(([owner, summary]) => [
							owner,
							Object.freeze(summary),
						]),
					),
				),
			});
		},
	});
}

export async function observePb05AcceptedCallback<Result>(
	input: Readonly<{
		population: string;
		operation: string;
		phase: string;
		measurement: ReturnType<typeof createPb05OperationalMeasurement>;
		now?: () => number;
		use(): Promise<Result>;
	}>,
): Promise<Result> {
	if (!validIdleGapCallback(input))
		throw new TypeError("invalid PB-05 idle-gap callback config");
	const now = input.now ?? performance.now.bind(performance);
	const startedAtMs = now();
	if (!finiteTime(startedAtMs))
		throw new TypeError("invalid PB-05 instrumentation clock");
	let result: Result;
	try {
		result = await input.use();
	} catch (primary) {
		try {
			input.measurement.idleGap({
				population: input.population,
				operation: input.operation,
				phase: input.phase,
				startedAtMs,
				finishedAtMs: now(),
			});
		} catch {
			// Observation cannot replace the accepted callback failure it measures.
		}
		throw primary;
	}
	const finishedAtMs = now();
	if (!finiteTime(finishedAtMs))
		throw new TypeError("invalid PB-05 instrumentation clock");
	input.measurement.idleGap({
		population: input.population,
		operation: input.operation,
		phase: input.phase,
		startedAtMs,
		finishedAtMs,
	});
	return result;
}

export function instrumentPb05TransactionRunner(
	input: Readonly<{
		database: PostgresTransactionRunner;
		measurement: ReturnType<typeof createPb05OperationalMeasurement>;
		population: string;
		operation: string;
		now?: () => number;
	}>,
): PostgresTransactionRunner {
	if (!operation(input.population, input.operation))
		throw new TypeError("invalid PB-05 instrumentation config");
	const now = input.now ?? performance.now.bind(performance);
	let transactionOrdinal = 0;
	return Object.freeze({
		async transaction(request) {
			const transaction = `pb05:${input.population}:${input.operation}:${transactionOrdinal++}`;
			return input.database.transaction({
				...request,
				use: (owned) =>
					request.use(
						observedPb05Transaction({
							context: {
								identity: transaction,
								execute: (statement, value) => owned.execute(statement, value),
							},
							measurement: input.measurement,
							population: input.population,
							operation: input.operation,
							now,
						}),
					),
			});
		},
	});
}

const pb05TransactionContext = Symbol("PB-05 transaction observation context");

type Pb05TransactionContext = Readonly<{
	identity: string;
	execute<Input, Output>(
		statement: PostgresStatement<Input, Output>,
		value: Input,
	): Promise<Output>;
}>;

type Pb05ObservedTransaction = PostgresTransaction &
	Readonly<{ [pb05TransactionContext]: Pb05TransactionContext }>;

function observedPb05Transaction(
	input: Readonly<{
		context: Pb05TransactionContext;
		measurement: ReturnType<typeof createPb05OperationalMeasurement>;
		population: string;
		operation: string;
		now: () => number;
	}>,
): Pb05ObservedTransaction {
	const observationTime = (): number => {
		const value = input.now();
		if (!finiteTime(value))
			throw new TypeError("invalid PB-05 instrumentation clock");
		return value;
	};
	return Object.freeze({
		[transactionBrand]: true as const,
		[pb05TransactionContext]: input.context,
		async execute<Input, Output>(
			statement: PostgresStatement<Input, Output>,
			value: Input,
		): Promise<Output> {
			const startedAtMs = observationTime();
			let output: Output;
			try {
				output = await input.context.execute(statement, value);
			} catch (primary) {
				try {
					input.measurement.statement({
						population: input.population,
						operation: input.operation,
						name: statement.name,
						transaction: input.context.identity,
						startedAtMs,
						finishedAtMs: observationTime(),
					});
				} catch {
					// Instrumentation cannot replace the database failure it observes.
				}
				throw primary;
			}
			input.measurement.statement({
				population: input.population,
				operation: input.operation,
				name: statement.name,
				transaction: input.context.identity,
				startedAtMs,
				finishedAtMs: observationTime(),
			});
			return output;
		},
	});
}

export function instrumentPb05OwnedTransaction(
	input: Readonly<{
		transaction: PostgresTransaction;
		measurement: ReturnType<typeof createPb05OperationalMeasurement>;
		population: string;
		operation: string;
		now?: () => number;
	}>,
): PostgresTransaction {
	if (!operation(input.population, input.operation))
		throw new TypeError("invalid PB-05 instrumentation config");
	const context = (input.transaction as Partial<Pb05ObservedTransaction>)[
		pb05TransactionContext
	];
	if (context === undefined)
		throw new TypeError("PB-05 shared transaction is not instrumented");
	return observedPb05Transaction({
		context,
		measurement: input.measurement,
		population: input.population,
		operation: input.operation,
		now: input.now ?? performance.now.bind(performance),
	});
}
