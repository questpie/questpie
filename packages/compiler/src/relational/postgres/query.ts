import type {
	DataQueryTemplateV1,
	QueryOperandV1,
	RootQueryFilterV1,
	ScalarCodecV1,
	ScalarQueryFilterV1,
} from "../types";
import {
	postgresType,
	quoteIdentifier,
	requiredField,
	type PostgresCatalog,
	type PostgresField,
} from "./model";
import { PostgresParameters } from "./parameters";

export interface QuerySqlContext {
	readonly catalog: PostgresCatalog;
	readonly parameters: PostgresParameters;
	readonly template: DataQueryTemplateV1;
	readonly alias: string;
}

function parameterCodec(
	template: DataQueryTemplateV1,
	name: string,
): ScalarCodecV1 {
	const parameter = template.parameters.find(
		(candidate) => candidate.name === name,
	);
	if (!parameter || parameter.kind === "cursor")
		throw new TypeError(`unknown scalar Query parameter ${name}`);
	return parameter.codec;
}

export function queryParameter(
	context: QuerySqlContext,
	name: string,
	list = false,
): string {
	const codec = parameterCodec(context.template, name);
	return context.parameters.add({
		kind: "queryParameter",
		parameter: name,
		postgresType: `${postgresType(codec)}${list ? "[]" : ""}`,
	});
}

function queryOperand(
	operand: QueryOperandV1,
	context: QuerySqlContext,
): string {
	if (operand.kind === "parameter")
		return queryParameter(context, operand.parameter);
	return context.parameters.literal(operand.value, operand.codec.kind);
}

function fieldSql(fieldIdentity: string, context: QuerySqlContext): string {
	const field = requiredField(context.catalog, fieldIdentity as never);
	return `${quoteIdentifier(context.alias)}.${quoteIdentifier(field.postgresName)}`;
}

function scalarFilterSql(
	filter: ScalarQueryFilterV1,
	context: QuerySqlContext,
): string {
	const left = fieldSql(filter.field, context);
	switch (filter.kind) {
		case "isNull":
			return `(${left} IS NULL)`;
		case "isNotNull":
			return `(${left} IS NOT NULL)`;
		case "in":
		case "notIn": {
			const negate = filter.kind === "notIn";
			const set = filter.set;
			if (set.kind === "parameter") {
				const right = queryParameter(context, set.parameter, true);
				return `(${left} ${negate ? "<> ALL" : "= ANY"}(${right}))`;
			}
			if (set.values.length === 0) return negate ? "TRUE" : "FALSE";
			const values = set.values.map((value) =>
				context.parameters.literal(value, set.codec.kind),
			);
			return `(${left} ${negate ? "NOT IN" : "IN"} (${values.join(", ")}))`;
		}
		default: {
			const operator = {
				equal: "=",
				notEqual: "<>",
				lessThan: "<",
				lessThanOrEqual: "<=",
				greaterThan: ">",
				greaterThanOrEqual: ">=",
			}[filter.kind];
			return `(${left} ${operator} ${queryOperand(filter.operand, context)})`;
		}
	}
}

export function queryFilterSql(
	filter: RootQueryFilterV1,
	context: QuerySqlContext,
): string {
	switch (filter.kind) {
		case "and":
		case "or":
			if (filter.expressions.length === 0)
				return filter.kind === "and" ? "TRUE" : "FALSE";
			return `(${filter.expressions
				.map((expression) => queryFilterSql(expression, context))
				.join(filter.kind === "and" ? " AND " : " OR ")})`;
		case "not":
			return `(NOT ${queryFilterSql(filter.expression, context)})`;
		case "relationExists":
		case "relationNotExists":
			throw new TypeError(
				"Relation filters require the disclosure-policy lowering slice",
			);
		default:
			return scalarFilterSql(filter, context);
	}
}

export function filterParameters(
	filter: RootQueryFilterV1 | null,
	result = new Set<string>(),
): ReadonlySet<string> {
	if (!filter) return result;
	switch (filter.kind) {
		case "and":
		case "or":
			for (const expression of filter.expressions)
				filterParameters(expression, result);
			return result;
		case "not":
			return filterParameters(filter.expression, result);
		case "relationExists":
		case "relationNotExists":
			if (filter.filter.kind !== "true")
				filterParameters(filter.filter as RootQueryFilterV1, result);
			return result;
		case "in":
		case "notIn":
			if (filter.set.kind === "parameter") result.add(filter.set.parameter);
			return result;
		case "isNull":
		case "isNotNull":
			return result;
		default:
			if (filter.operand.kind === "parameter")
				result.add(filter.operand.parameter);
			return result;
	}
}

export function orderSql(
	template: DataQueryTemplateV1,
	catalog: PostgresCatalog,
	alias: string,
): string {
	return template.order
		.map((term) => {
			const field = requiredField(catalog, term.field);
			return `${quoteIdentifier(alias)}.${quoteIdentifier(field.postgresName)} ${term.direction.toUpperCase()} NULLS ${term.nulls.toUpperCase()}`;
		})
		.join(", ");
}

function cursorComparison(
	field: PostgresField,
	value: string,
	direction: "asc" | "desc",
	nulls: "first" | "last",
	alias: string,
): string {
	const row = `${quoteIdentifier(alias)}.${quoteIdentifier(field.postgresName)}`;
	const comparison = direction === "asc" ? ">" : "<";
	if (!field.nullable) return `(${row} ${comparison} ${value})`;
	if (nulls === "first")
		return `((${value} IS NULL AND ${row} IS NOT NULL) OR (${value} IS NOT NULL AND ${row} ${comparison} ${value}))`;
	return `(${value} IS NOT NULL AND (${row} ${comparison} ${value} OR ${row} IS NULL))`;
}

export function cursorSql(context: QuerySqlContext): string {
	const after = context.template.page.after.parameter;
	const present = context.parameters.add({
		kind: "cursorPresent",
		parameter: after,
		postgresType: "boolean",
	});
	const comparisons: string[] = [];
	const equalPrefix: string[] = [];
	for (const term of context.template.order) {
		const field = requiredField(context.catalog, term.field);
		const value = context.parameters.add({
			kind: "cursorValue",
			parameter: after,
			field: field.identity,
			postgresType: postgresType(field.codec),
		});
		comparisons.push(
			`(${[...equalPrefix, cursorComparison(field, value, term.direction, term.nulls, context.alias)].join(" AND ")})`,
		);
		equalPrefix.push(
			`${fieldSql(field.identity, context)} IS NOT DISTINCT FROM ${value}`,
		);
	}
	return `(NOT ${present} OR (${comparisons.join(" OR ")}))`;
}
