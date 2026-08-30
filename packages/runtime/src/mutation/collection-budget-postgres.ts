import {
	transactionBrand,
	type PostgresStatement,
	type PostgresTransaction,
} from "../postgres/contract";
import type { CollectionExecutionBudget } from "./collection-budget";

/** Accounts one narrow PostgreSQL capability against its owning Collection budget. */
export function budgetPostgresTransaction(
	transaction: PostgresTransaction,
	budget: CollectionExecutionBudget,
): PostgresTransaction {
	return Object.freeze({
		[transactionBrand]: true as const,
		async execute<Input, Output>(
			statement: PostgresStatement<Input, Output>,
			input: Input,
		): Promise<Output> {
			budget.consumeStatement();
			const output = await transaction.execute(statement, input);
			if (!Array.isArray(output))
				throw new TypeError("Budgeted PostgreSQL result must be rows");
			budget.consumeRows(output.length);
			return output as Output;
		},
	});
}
