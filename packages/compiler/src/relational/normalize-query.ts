import { compareAscii } from "../canonical";
import {
	array,
	cloneJson,
	compareCanonical,
	invalidOperator,
	record,
	string,
} from "./shared";
import type {
	CollectionIdentity,
	DataQueryTemplateV1,
	QueryParameterV1,
	RootQueryFilterV1,
	RootQuerySelectionV1,
	ScalarCodecV1,
} from "./types";

const scalarOperators = new Set([
	"equal",
	"greaterThan",
	"greaterThanOrEqual",
	"in",
	"isNotNull",
	"isNull",
	"lessThan",
	"lessThanOrEqual",
	"notEqual",
	"notIn",
]);

function normalizeLiteralSet(value: unknown): unknown {
	const set = record(value, "Query set");
	if (set.kind !== "literal") return cloneJson(set);
	const values = array(set.values, "Query literal set values")
		.map(cloneJson)
		.sort(compareCanonical)
		.filter(
			(value, index, items) =>
				index === 0 || compareCanonical(value, items[index - 1]) !== 0,
		);
	return { ...set, values };
}

function normalizeFilter(value: unknown, related: boolean): RootQueryFilterV1 {
	const filter = record(value, "Query filter");
	const kind = string(filter.kind, "Query filter kind");
	if (kind === "and" || kind === "or")
		return {
			kind,
			expressions: array(filter.expressions, `${kind} expressions`).map(
				(child) => normalizeFilter(child, related),
			),
		} as RootQueryFilterV1;
	if (kind === "not")
		return {
			kind,
			expression: normalizeFilter(filter.expression, related),
		} as RootQueryFilterV1;
	if (kind === "relationExists" || kind === "relationNotExists") {
		if (related)
			throw new TypeError("nested Relation predicates are not supported in v1");
		const nested = record(filter.filter, "Relation filter");
		return {
			kind,
			relation: string(filter.relation, "Relation identity") as never,
			filter:
				nested.kind === "true"
					? { kind: "true" }
					: normalizeFilter(nested, true),
		} as RootQueryFilterV1;
	}
	if (!scalarOperators.has(kind)) invalidOperator(kind);
	if (kind === "in" || kind === "notIn")
		return { ...filter, kind, set: normalizeLiteralSet(filter.set) } as never;
	return cloneJson(filter) as RootQueryFilterV1;
}

function normalizeSelection(value: unknown): RootQuerySelectionV1 {
	const selection = record(value, "Query selection");
	if (selection.kind === "field") return cloneJson(selection) as never;
	if (selection.kind !== "toOne")
		throw new TypeError(
			`unsupported Query selection ${String(selection.kind)}`,
		);
	return {
		...selection,
		select: array(selection.select, "toOne selection")
			.map((child) =>
				record(cloneJson(record(child, "Field selection")), "Field selection"),
			)
			.sort((left, right) =>
				compareAscii(
					string(left.key, "selection key"),
					string(right.key, "selection key"),
				),
			),
	} as never;
}

function normalizeParameter(value: unknown): QueryParameterV1 {
	const parameter = record(value, "Query parameter");
	const name = string(parameter.name, "parameter name");
	if (parameter.kind === "cursor")
		return { kind: "cursor", name, nullable: true };
	const codec = cloneJson(parameter.codec) as ScalarCodecV1;
	if (parameter.kind === "scalar")
		return { kind: "scalar", name, codec, nullable: false };
	if (parameter.kind === "list")
		return {
			kind: "list",
			name,
			codec,
			maximumItems: Number(parameter.maximumItems),
			nullable: false,
			semantics: "set",
		};
	throw new TypeError(`unsupported Query parameter ${String(parameter.kind)}`);
}

export function normalizeDataQueryTemplate(
	value: unknown,
	digests: Readonly<{
		schemaProjectionDigest: string;
		dataContractProjectionDigest: string;
	}>,
): DataQueryTemplateV1 {
	const input = record(value, "Data Query Template");
	const parameters = array(input.parameters, "Query parameters")
		.map(normalizeParameter)
		.sort((left, right) => compareAscii(left.name, right.name));
	const select = array(input.select, "Query selection")
		.map(normalizeSelection)
		.sort((left, right) => compareAscii(left.key, right.key));
	return {
		format: "questpie.data-query-template",
		version: 1,
		from: string(input.from, "Query from") as CollectionIdentity,
		schemaProjectionDigest: digests.schemaProjectionDigest,
		dataContractProjectionDigest: digests.dataContractProjectionDigest,
		parameters,
		select,
		filter: input.filter === null ? null : normalizeFilter(input.filter, false),
		order: cloneJson(
			array(input.order, "Query order"),
		) as DataQueryTemplateV1["order"],
		page: cloneJson(
			record(input.page, "Query page"),
		) as DataQueryTemplateV1["page"],
	};
}
