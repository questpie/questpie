import { expect, test } from "bun:test";

import { createCollectionExecutionBudget } from "../../packages/runtime/src/mutation/collection-budget";
import { budgetPostgresTransaction } from "../../packages/runtime/src/mutation/collection-budget-postgres";
import { createCollectionLifecycleDoom } from "../../packages/runtime/src/mutation/lifecycle";
import {
	definePostgresStatement,
	transactionBrand,
	type PostgresTransaction,
} from "../../packages/runtime/src/postgres/contract";

const statement = definePostgresStatement<
	readonly unknown[],
	readonly Readonly<{ id: string }>[]
>({
	name: "lifecycle.job.budget",
	text: "SELECT id",
	parameterCount: 0,
	parameters: (input) => input,
	decode: (rows) => rows as readonly Readonly<{ id: string }>[],
});

test("charges lifecycle Job PostgreSQL statements before execution", async () => {
	const doom = createCollectionLifecycleDoom();
	const budget = createCollectionExecutionBudget({
		doom,
		maxStatements: 0,
		maxDependencies: 1,
		maxRows: 1,
		maxDurationMilliseconds: 1_000,
	});
	let executions = 0;
	const transaction: PostgresTransaction = {
		[transactionBrand]: true,
		async execute() {
			executions += 1;
			return [] as never;
		},
	};

	await expect(
		budgetPostgresTransaction(transaction, budget).execute(statement, []),
	).rejects.toThrow("Collection statement budget exceeded");
	expect(executions).toBe(0);
	expect(() => budget.assertAvailable()).toThrow(
		"Collection statement budget exceeded",
	);
});

test("charges lifecycle Job PostgreSQL result rows and dooms the root", async () => {
	const doom = createCollectionLifecycleDoom();
	const budget = createCollectionExecutionBudget({
		doom,
		maxStatements: 1,
		maxDependencies: 1,
		maxRows: 1,
		maxDurationMilliseconds: 1_000,
	});
	const transaction: PostgresTransaction = {
		[transactionBrand]: true,
		async execute() {
			return [{ id: "one" }, { id: "two" }] as never;
		},
	};

	await expect(
		budgetPostgresTransaction(transaction, budget).execute(statement, []),
	).rejects.toThrow("Collection row budget exceeded");
	expect(() => budget.assertAvailable()).toThrow(
		"Collection row budget exceeded",
	);
});
