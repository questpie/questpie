import {
	definePostgresStatement as actualDefinePostgresStatement,
	type PostgresStatement as ActualPostgresStatement,
	type PostgresTransaction as ActualPostgresTransaction,
	type PostgresTransactionRunner as ActualPostgresTransactionRunner,
	verifyPostgresDatabaseReadinessPrerequisitesInOwnedTransaction as actualVerifyPrerequisites,
} from "../../packages/runtime/src/bundle-core";
import type {
	definePostgresStatement as declaredDefinePostgresStatement,
	PostgresStatement as DeclaredPostgresStatement,
	PostgresTransaction as DeclaredPostgresTransaction,
	PostgresTransactionRunner as DeclaredPostgresTransactionRunner,
	verifyPostgresDatabaseReadinessPrerequisitesInOwnedTransaction as declaredVerifyPrerequisites,
} from "../../packages/runtime/src/bundle-core-types";

type Exact<Left, Right> =
	(<Value>() => Value extends Left ? 1 : 2) extends <
		Value,
	>() => Value extends Right ? 1 : 2
		? (<Value>() => Value extends Right ? 1 : 2) extends <
				Value,
			>() => Value extends Left ? 1 : 2
			? true
			: false
		: false;
type Assert<Value extends true> = Value;

type _FactoryParity = Assert<
	Exact<
		typeof actualDefinePostgresStatement,
		typeof declaredDefinePostgresStatement
	>
>;
type _PrerequisiteParity = Assert<
	Exact<typeof actualVerifyPrerequisites, typeof declaredVerifyPrerequisites>
>;
type _StatementParity = Assert<
	Exact<
		ActualPostgresStatement<void, void>,
		DeclaredPostgresStatement<void, void>
	>
>;
type _TransactionParity = Assert<
	Exact<ActualPostgresTransaction, DeclaredPostgresTransaction>
>;
type _RunnerParity = Assert<
	Exact<ActualPostgresTransactionRunner, DeclaredPostgresTransactionRunner>
>;

const injectedFactory: typeof declaredDefinePostgresStatement =
	actualDefinePostgresStatement;
const injectedPrerequisites: typeof declaredVerifyPrerequisites =
	actualVerifyPrerequisites;
void injectedFactory;
void injectedPrerequisites;
