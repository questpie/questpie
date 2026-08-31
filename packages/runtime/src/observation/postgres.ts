import {
	transactionBrand,
	type PostgresStatement,
	type PostgresStatementOperation,
	type PostgresTransaction,
} from "../postgres/contract";
import type { PrincipalKind, RuntimeExecutionObservation } from "./contract";

const observedTransactionBrand = Symbol("questpie.observation.postgres");

type PostgresObservationFailure = Readonly<{
	errorCode?: string;
	outcome: "framework_error" | "cancelled" | "deadline";
}>;

export function observePostgresTransaction(
	input: Readonly<{
		execution: RuntimeExecutionObservation;
		failure(error: unknown): PostgresObservationFailure;
		principalKind: PrincipalKind;
		transaction: PostgresTransaction;
	}>,
): PostgresTransaction {
	if (observedTransactionBrand in input.transaction)
		throw new TypeError("PostgreSQL transaction is already observed");
	return Object.freeze({
		[transactionBrand]: true as const,
		[observedTransactionBrand]: true as const,
		async execute<Input, Output, Operation extends PostgresStatementOperation>(
			statement: PostgresStatement<Input, Output, Operation>,
			value: Input,
		) {
			if (statement.operation === "administrative")
				throw new TypeError(
					"administrative PostgreSQL statement cannot be observed",
				);
			const scope = input.execution.begin({
				databaseOperation: statement.operation,
				kind: "postgresql",
				principalKind: input.principalKind,
				statementIdentity: statement.name,
				suppressPostgres: true,
				trace: { kind: "active-parent" },
			});
			try {
				const result = await scope.run(() =>
					input.transaction.execute(statement, value),
				);
				scope.end({ kind: "postgresql", outcome: "ok" });
				return result;
			} catch (error) {
				scope.end({ kind: "postgresql", ...input.failure(error) });
				throw error;
			}
		},
	});
}
