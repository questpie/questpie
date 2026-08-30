import {
	createCollectionLifecycleDoom,
	CollectionLifecycleRecursionError,
	type CollectionLifecycleDoom,
} from "./lifecycle";

export interface CollectionExecutionBudget {
	assertAvailable(): void;
	consumeStatement(): void;
	consumeDependency(): void;
	consumeRows(count: number): void;
	enterLifecycle(reentryLimit: number): () => void;
}

export function createCollectionExecutionBudget(
	input: Readonly<{
		doom: CollectionLifecycleDoom;
		signal?: AbortSignal;
		maxStatements: number;
		maxDependencies: number;
		maxRows: number;
		maxDurationMilliseconds: number;
		clock?: () => number;
	}>,
): CollectionExecutionBudget {
	for (const [name, value] of Object.entries({
		maxStatements: input.maxStatements,
		maxDependencies: input.maxDependencies,
		maxRows: input.maxRows,
		maxDurationMilliseconds: input.maxDurationMilliseconds,
	}))
		if (!Number.isSafeInteger(value) || value < 0)
			throw new TypeError(`Collection ${name} is invalid`);
	const clock = input.clock ?? performance.now.bind(performance);
	const startedAt = clock();
	let statements = 0;
	let dependencies = 0;
	let rows = 0;
	let lifecycleDepth = 0;

	const terminal = (error: unknown): never => {
		input.doom.capture(error);
		throw error;
	};
	const assertAvailable = () => {
		input.doom.throwIfDoomed();
		if (input.signal?.aborted)
			terminal(
				input.signal.reason ?? new DOMException("Aborted", "AbortError"),
			);
		if (clock() - startedAt > input.maxDurationMilliseconds)
			terminal(new TypeError("Collection duration budget exceeded"));
	};
	const spend = (
		kind: "statement" | "dependency" | "row",
		count: number,
		maximum: number,
	) => {
		assertAvailable();
		const next = count + 1;
		if (next > maximum)
			terminal(new TypeError(`Collection ${kind} budget exceeded`));
		return next;
	};

	return Object.freeze({
		assertAvailable,
		consumeStatement() {
			statements = spend("statement", statements, input.maxStatements);
		},
		consumeDependency() {
			dependencies = spend("dependency", dependencies, input.maxDependencies);
		},
		consumeRows(count: number) {
			assertAvailable();
			if (!Number.isSafeInteger(count) || count < 0)
				terminal(new TypeError("Collection row count is invalid"));
			rows += count;
			if (rows > input.maxRows)
				terminal(new TypeError("Collection row budget exceeded"));
		},
		enterLifecycle(reentryLimit: number) {
			assertAvailable();
			if (!Number.isSafeInteger(reentryLimit) || reentryLimit < 1)
				terminal(
					new TypeError("Collection lifecycle re-entry limit is invalid"),
				);
			lifecycleDepth += 1;
			if (lifecycleDepth > reentryLimit) {
				lifecycleDepth -= 1;
				terminal(new CollectionLifecycleRecursionError());
			}
			let active = true;
			return () => {
				if (!active) return;
				active = false;
				lifecycleDepth -= 1;
			};
		},
	});
}

export function createDefaultCollectionExecutionBudget(
	input: Readonly<{
		doom: CollectionLifecycleDoom;
		signal?: AbortSignal;
	}>,
): CollectionExecutionBudget {
	return createCollectionExecutionBudget({
		...input,
		maxStatements: 20,
		maxDependencies: 20,
		maxRows: 100,
		maxDurationMilliseconds: 5_000,
	});
}

export function createCollectionExecutionScope(
	input: Readonly<{
		doom?: CollectionLifecycleDoom;
		budget?: CollectionExecutionBudget;
		signal?: AbortSignal;
		consumeRows(count: number): void;
	}>,
) {
	if (input.budget && !input.doom)
		throw new TypeError("Collection execution budget requires its owning doom");
	const doom = input.doom ?? createCollectionLifecycleDoom();
	const budget =
		input.budget ??
		createDefaultCollectionExecutionBudget({ doom, signal: input.signal });
	return Object.freeze({
		doom,
		budget,
		consumeRows(count: number) {
			budget.consumeRows(count);
			try {
				input.consumeRows(count);
			} catch (error) {
				doom.capture(error);
				throw error;
			}
		},
	});
}

export async function executeCollectionStatement<T>(
	input: Readonly<{
		budget: CollectionExecutionBudget;
		started: number;
		durationMilliseconds: number;
		use(): Promise<T>;
	}>,
): Promise<T> {
	input.budget.assertAvailable();
	input.budget.consumeStatement();
	if (performance.now() - input.started > input.durationMilliseconds)
		throw new TypeError("Collection operation exceeded its duration limit");
	let result: T;
	try {
		result = await input.use();
	} catch (error) {
		input.budget.assertAvailable();
		throw error;
	}
	input.budget.assertAvailable();
	if (performance.now() - input.started > input.durationMilliseconds)
		throw new TypeError("Collection operation exceeded its duration limit");
	return result;
}
