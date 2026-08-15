import type { PolicyExpressionV1, PolicyOperandV1 } from "../types";
import {
	fieldAtPath,
	qualifiedTable,
	quoteIdentifier,
	requiredCollection,
	type PostgresCatalog,
} from "./model";
import { PostgresParameters } from "./parameters";

export interface PolicySqlContext {
	readonly catalog: PostgresCatalog;
	readonly parameters: PostgresParameters;
	readonly aliases: ReadonlyMap<string, string>;
}

function operandSql(
	operand: PolicyOperandV1,
	context: PolicySqlContext,
): string {
	if (operand.kind === "executionFact")
		return context.parameters.execution(
			operand.source,
			operand.path,
			operand.codec,
		);
	if (operand.kind === "literal")
		return context.parameters.literal(operand.value, operand.codec);
	const alias = context.aliases.get(operand.scope);
	if (!alias) throw new TypeError(`unbound Policy scope ${operand.scope}`);
	const field = fieldAtPath(context.catalog, operand.collection, operand.path);
	return `${quoteIdentifier(alias)}.${quoteIdentifier(field.postgresName)}`;
}

export function policyExpressionSql(
	expression: PolicyExpressionV1,
	context: PolicySqlContext,
): string {
	switch (expression.kind) {
		case "constant":
			return expression.value ? "TRUE" : "FALSE";
		case "equal":
			return `(${operandSql(expression.left, context)} IS NOT DISTINCT FROM ${operandSql(expression.right, context)})`;
		case "notEqual":
			return `(${operandSql(expression.left, context)} IS DISTINCT FROM ${operandSql(expression.right, context)})`;
		case "and":
			return expression.items.length === 0
				? "TRUE"
				: `(${expression.items.map((item) => policyExpressionSql(item, context)).join(" AND ")})`;
		case "or":
			return expression.items.length === 0
				? "FALSE"
				: `(${expression.items.map((item) => policyExpressionSql(item, context)).join(" OR ")})`;
		case "not":
			return `(NOT ${policyExpressionSql(expression.expression, context)})`;
		case "in": {
			if (expression.values.length === 0) return "FALSE";
			return `(${operandSql(expression.operand, context)} IN (${expression.values.map((value) => operandSql(value, context)).join(", ")}))`;
		}
		case "exists": {
			const collection = requiredCollection(
				context.catalog,
				expression.collection,
			);
			const alias = `qp_${expression.scope}`;
			const aliases = new Map(context.aliases);
			aliases.set(expression.scope, alias);
			const predicate = policyExpressionSql(expression.predicate, {
				...context,
				aliases,
			});
			return `EXISTS (SELECT 1 FROM ${qualifiedTable(context.catalog, collection)} AS ${quoteIdentifier(alias)} WHERE ${predicate})`;
		}
	}
}
