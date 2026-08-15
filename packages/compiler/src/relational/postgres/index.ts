import { compareAscii, digest } from "../../canonical";
import type { PolicyScopeBindingV1 } from "../binding";
import type {
	DataQueryTemplateV1,
	FieldQuerySelectionV1,
	PolicyProgramV1,
	QueryParameterV1,
	RootQuerySelectionV1,
	ScalarCodecV1,
} from "../types";
import {
	buildPostgresCatalog,
	fieldValueSql,
	qualifiedTable,
	quoteIdentifier,
	requiredCollection,
	requiredField,
	type PostgresCatalog,
} from "./model";
import {
	lowerPostgresKeyedLookupProof,
	type PostgresKeyedLookupProofV1,
} from "./nondisclosure";
import {
	PostgresParameters,
	type PostgresQueryParameterV1,
} from "./parameters";
import { policyExpressionSql } from "./policy";
import {
	cursorSql,
	filterParameters,
	orderSql,
	queryFilterSql,
	queryParameter,
	type QuerySqlContext,
} from "./query";

export type PostgresQueryResultV1 =
	| Readonly<{
			kind: "field";
			key: string;
			field: string;
			column: string;
			codec: ScalarCodecV1;
			nullable: boolean;
			guardColumn?: string;
	  }>
	| Readonly<{
			kind: "toOne";
			key: string;
			relation: string;
			presenceColumn: string;
			fields: readonly Readonly<{
				key: string;
				field: string;
				column: string;
				codec: ScalarCodecV1;
				nullable: boolean;
			}>[];
	  }>;

export interface PostgresQueryPlanV1 {
	readonly format: "questpie.postgres-query-plan";
	readonly version: 1;
	readonly queryDigest: string;
	readonly templateDigest: string;
	readonly policy: string;
	readonly policyProgramDigest: string;
	readonly usedExecutionFacts: readonly (
		| "authorityKind"
		| "principalId"
		| "tenantId"
	)[];
	readonly admission: "authenticated" | "public" | "system";
	readonly binding: Readonly<{
		parameters: readonly QueryParameterV1[];
	}>;
	readonly page: Readonly<{
		kind: "forwardCursor";
		first: Readonly<{ parameter: string; minimum: number; maximum: number }>;
		after: Readonly<{ parameter: string }>;
		scopeParameters: readonly string[];
		order: readonly Readonly<{
			field: string;
			codec: string;
			nullable: boolean;
			withTimezone?: boolean;
		}>[];
	}>;
	readonly sql: string;
	readonly parameters: readonly PostgresQueryParameterV1[];
	readonly result: readonly PostgresQueryResultV1[];
	readonly nondisclosure: Readonly<{
		keyedLookup: PostgresKeyedLookupProofV1;
	}>;
}

export interface PostgresQueryPlansV1 {
	readonly format: "questpie.postgres-query-plans";
	readonly version: 1;
	readonly plans: readonly PostgresQueryPlanV1[];
}

interface PolicyProjectionEntry {
	readonly program: PolicyProgramV1;
	readonly scopeBindings: readonly PolicyScopeBindingV1[];
}

interface QueryProjectionEntry {
	readonly digest: string;
	readonly policy: string;
	readonly template: DataQueryTemplateV1;
}

function record(
	value: unknown,
	label: string,
): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new TypeError(`${label} must be an object`);
	return value as Readonly<Record<string, unknown>>;
}

function projectionEntries(
	value: unknown,
	format: string,
	key: "policies" | "queries",
): readonly unknown[] {
	const projection = record(value, format);
	if (
		projection.format !== format ||
		projection.version !== 1 ||
		!Array.isArray(projection[key])
	)
		throw new TypeError(`invalid ${format}`);
	return projection[key];
}

function usedExecutionFacts(
	parameters: readonly PostgresQueryParameterV1[],
): readonly ("authorityKind" | "principalId" | "tenantId")[] {
	const used = new Set<"authorityKind" | "principalId" | "tenantId">();
	for (const parameter of parameters) {
		if (parameter.kind !== "executionFact") continue;
		const path = parameter.path.join(".");
		if (parameter.source === "authority" && path === "kind")
			used.add("authorityKind");
		else if (parameter.source === "principal" && path === "id")
			used.add("principalId");
		else if (parameter.source === "tenant" && path === "id")
			used.add("tenantId");
		else
			throw new TypeError(
				`unsupported Policy cursor fact ${parameter.source}.${path}`,
			);
	}
	return (["authorityKind", "principalId", "tenantId"] as const).filter(
		(fact) => used.has(fact),
	);
}

function selectedPolicy(
	identity: string,
	policies: readonly PolicyProjectionEntry[],
): PolicyProjectionEntry {
	const candidates = policies.filter(
		({ program }) => program.identity === identity,
	);
	if (candidates.length !== 1)
		throw new TypeError(`expected one Policy ${identity}`);
	const policy = candidates[0]!;
	if (
		!policy.scopeBindings.some(
			(binding) =>
				binding.scope === "row" &&
				binding.collection === policy.program.target &&
				binding.parentScope === null,
		)
	)
		throw new TypeError(`Policy ${identity} has no bound root scope`);
	return policy;
}

function defaultPolicy(
	collection: string,
	policies: readonly PolicyProjectionEntry[],
): PolicyProjectionEntry {
	const candidates = policies.filter(
		({ program }) =>
			program.target === collection && program.attachment.kind === "default",
	);
	if (candidates.length !== 1)
		throw new TypeError(`expected one default Policy for ${collection}`);
	return candidates[0]!;
}

function relationJoin(
	selection: Extract<RootQuerySelectionV1, { kind: "toOne" }>,
	index: number,
	rootAlias: string,
	catalog: PostgresCatalog,
	parameters: PostgresParameters,
	policies: readonly PolicyProjectionEntry[],
): Readonly<{
	join: string;
	columns: readonly string[];
	result: PostgresQueryResultV1;
}> {
	const relation = catalog.relations.get(selection.relation);
	if (!relation) throw new TypeError(`unknown Relation ${selection.relation}`);
	const target = requiredCollection(catalog, relation.target);
	const policy = defaultPolicy(target.identity, policies);
	const read = policy.program.operations.read;
	if (!read)
		throw new TypeError(`Policy ${policy.program.identity} denies read`);
	if ((policy.program.fields?.selectedOutput.length ?? 0) > 0)
		throw new TypeError(
			"nested conditional output requires a later lowering slice",
		);
	const rowAlias = `qp_relation_${index}_row`;
	const relationAlias = `qp_relation_${index}`;
	const aliases = new Map([["row", rowAlias]]);
	const disclosure = policyExpressionSql(read.rows, {
		catalog,
		parameters,
		aliases,
	});
	const correlations = relation.fields.map((source, relationIndex) => {
		const targetIdentity = relation.references[relationIndex];
		if (!targetIdentity)
			throw new TypeError(`invalid Relation ${relation.identity}`);
		const sourceField = requiredField(catalog, source);
		const targetField = requiredField(catalog, targetIdentity);
		return `${quoteIdentifier(rowAlias)}.${quoteIdentifier(targetField.postgresName)} IS NOT DISTINCT FROM ${quoteIdentifier(rootAlias)}.${quoteIdentifier(sourceField.postgresName)}`;
	});
	const selected = selection.select.map((fieldSelection, fieldIndex) => {
		const field = requiredField(catalog, fieldSelection.field);
		const innerColumn = `qp_value_${fieldIndex}`;
		const column = `qp_${selection.key}_${fieldSelection.key}`;
		return {
			inner: `${fieldValueSql(field, rowAlias)} AS ${quoteIdentifier(innerColumn)}`,
			outer: `${quoteIdentifier(relationAlias)}.${quoteIdentifier(innerColumn)} AS ${quoteIdentifier(column)}`,
			result: {
				key: fieldSelection.key,
				field: field.identity,
				column,
				codec: field.codec,
				nullable: field.nullable,
			},
		};
	});
	const presenceColumn = `qp_${selection.key}_present`;
	const join = `LEFT JOIN LATERAL (SELECT TRUE AS "qp_present"${selected.length > 0 ? `, ${selected.map(({ inner }) => inner).join(", ")}` : ""} FROM ${qualifiedTable(catalog, target)} AS ${quoteIdentifier(rowAlias)} WHERE ${[...correlations, disclosure].join(" AND ")} LIMIT 1) AS ${quoteIdentifier(relationAlias)} ON TRUE`;
	return {
		join,
		columns: [
			`${quoteIdentifier(relationAlias)}."qp_present" AS ${quoteIdentifier(presenceColumn)}`,
			...selected.map(({ outer }) => outer),
		],
		result: {
			kind: "toOne",
			key: selection.key,
			relation: relation.identity,
			presenceColumn,
			fields: selected.map(({ result }) => result),
		},
	};
}

function rootFieldResult(
	selection: FieldQuerySelectionV1,
	index: number,
	rootAlias: string,
	policy: PolicyProjectionEntry,
	catalog: PostgresCatalog,
	parameters: PostgresParameters,
): Readonly<{
	columns: readonly string[];
	joins: readonly string[];
	result: PostgresQueryResultV1;
}> {
	const field = requiredField(catalog, selection.field);
	const column = `qp_${selection.key}`;
	const rule = policy.program.fields?.selectedOutput.find(
		(candidate) =>
			JSON.stringify(candidate.path) === JSON.stringify(field.path),
	);
	if (!rule)
		return {
			columns: [
				`${fieldValueSql(field, rootAlias)} AS ${quoteIdentifier(column)}`,
			],
			joins: [],
			result: {
				kind: "field",
				key: selection.key,
				field: field.identity,
				column,
				codec: field.codec,
				nullable: field.nullable,
			},
		};
	const guardAlias = `qp_guard_${index}`;
	const guardColumn = `qp_${selection.key}_allowed`;
	const guard = policyExpressionSql(rule.when, {
		catalog,
		parameters,
		aliases: new Map([["row", rootAlias]]),
	});
	return {
		columns: [
			`CASE WHEN ${quoteIdentifier(guardAlias)}."allowed" THEN ${fieldValueSql(field, rootAlias)} ELSE NULL END AS ${quoteIdentifier(column)}`,
			`${quoteIdentifier(guardAlias)}."allowed" AS ${quoteIdentifier(guardColumn)}`,
		],
		joins: [
			`CROSS JOIN LATERAL (SELECT ${guard} AS "allowed") AS ${quoteIdentifier(guardAlias)}`,
		],
		result: {
			kind: "field",
			key: selection.key,
			field: field.identity,
			column,
			codec: field.codec,
			nullable: field.nullable,
			guardColumn,
		},
	};
}

export function lowerPostgresQueryPlan(
	input: Readonly<{
		schema: unknown;
		query: QueryProjectionEntry;
		policies: readonly PolicyProjectionEntry[];
	}>,
): PostgresQueryPlanV1 {
	const catalog = buildPostgresCatalog(input.schema);
	const rootCollection = requiredCollection(catalog, input.query.template.from);
	const policy = selectedPolicy(input.query.policy, input.policies);
	if (policy.program.target !== rootCollection.identity)
		throw new TypeError("Query Policy target does not match Query Collection");
	const read = policy.program.operations.read;
	if (!read)
		throw new TypeError(`Policy ${policy.program.identity} denies read`);
	const parameters = new PostgresParameters();
	const pageAlias = "qp_row";
	const policySql = policyExpressionSql(read.rows, {
		catalog,
		parameters,
		aliases: new Map([["row", pageAlias]]),
	});
	const pageContext: QuerySqlContext = {
		catalog,
		parameters,
		template: input.query.template,
		alias: pageAlias,
	};
	const filterSql = input.query.template.filter
		? queryFilterSql(input.query.template.filter, pageContext)
		: "TRUE";
	const boundarySql = cursorSql(pageContext);
	const first = queryParameter(
		pageContext,
		input.query.template.page.first.parameter,
	);
	const ordering = orderSql(input.query.template, catalog, pageAlias);
	const firstDefinition = input.query.template.parameters.find(
		(parameter) =>
			parameter.name === input.query.template.page.first.parameter &&
			parameter.kind === "scalar",
	);
	if (
		!firstDefinition ||
		firstDefinition.kind !== "scalar" ||
		firstDefinition.codec.kind !== "integer" ||
		typeof firstDefinition.codec.minimum !== "number" ||
		typeof firstDefinition.codec.maximum !== "number"
	)
		throw new TypeError("forward page first parameter requires integer bounds");
	const usedScopeParameters = filterParameters(input.query.template.filter);

	const columns: string[] = [];
	const joins: string[] = [];
	const result: PostgresQueryResultV1[] = [];
	for (const [index, selection] of input.query.template.select.entries()) {
		if (selection.kind === "field") {
			const rendered = rootFieldResult(
				selection,
				index,
				pageAlias,
				policy,
				catalog,
				parameters,
			);
			columns.push(...rendered.columns);
			joins.push(...rendered.joins);
			result.push(rendered.result);
			continue;
		}
		const rendered = relationJoin(
			selection,
			index,
			pageAlias,
			catalog,
			parameters,
			input.policies,
		);
		columns.push(...rendered.columns);
		joins.push(rendered.join);
		result.push(rendered.result);
	}

	const sql = `WITH "qp_page" AS MATERIALIZED (SELECT ${quoteIdentifier(pageAlias)}.* FROM ${qualifiedTable(catalog, rootCollection)} AS ${quoteIdentifier(pageAlias)} WHERE ${policySql} AND ${filterSql} AND ${boundarySql} ORDER BY ${ordering} LIMIT (${first} + 1)) SELECT ${columns.join(", ")} FROM "qp_page" AS ${quoteIdentifier(pageAlias)}${joins.length > 0 ? ` ${joins.join(" ")}` : ""} ORDER BY ${ordering};\n`;
	const positionalParameters = parameters.values();
	const keyedLookup = lowerPostgresKeyedLookupProof({
		catalog,
		collection: rootCollection,
		policy: policy.program,
		template: input.query.template,
	});
	return Object.freeze({
		format: "questpie.postgres-query-plan",
		version: 1,
		queryDigest: input.query.digest,
		templateDigest: input.query.digest,
		policy: policy.program.identity,
		policyProgramDigest: digest("questpie-policy-program-v1", policy.program),
		usedExecutionFacts: usedExecutionFacts(positionalParameters),
		admission: read.admission.kind,
		binding: Object.freeze({
			parameters: input.query.template.parameters,
		}),
		page: Object.freeze({
			kind: "forwardCursor",
			first: Object.freeze({
				parameter: input.query.template.page.first.parameter,
				minimum: firstDefinition.codec.minimum,
				maximum: firstDefinition.codec.maximum,
			}),
			after: Object.freeze({
				parameter: input.query.template.page.after.parameter,
			}),
			scopeParameters: Object.freeze(
				input.query.template.parameters
					.filter(({ name }) => usedScopeParameters.has(name))
					.map(({ name }) => name),
			),
			order: Object.freeze(
				input.query.template.order.map((term) => {
					const field = requiredField(catalog, term.field);
					return Object.freeze({
						field: field.identity,
						codec: field.codec.kind,
						nullable: field.nullable,
						...(field.codec.kind === "timestamp"
							? { withTimezone: field.codec.withTimezone }
							: {}),
					});
				}),
			),
		}),
		sql,
		parameters: positionalParameters,
		result: Object.freeze(result),
		nondisclosure: Object.freeze({ keyedLookup }),
	});
}

export function lowerPostgresQueryPlans(
	input: Readonly<{
		schema: unknown;
		queryProjection: unknown;
		policyProjection: unknown;
	}>,
): PostgresQueryPlansV1 {
	const policies = projectionEntries(
		input.policyProjection,
		"questpie.policy-projection",
		"policies",
	) as readonly PolicyProjectionEntry[];
	const queries = projectionEntries(
		input.queryProjection,
		"questpie.query-projection",
		"queries",
	) as readonly QueryProjectionEntry[];
	const plans = queries
		.map((query) =>
			lowerPostgresQueryPlan({ schema: input.schema, query, policies }),
		)
		.sort((left, right) => compareAscii(left.queryDigest, right.queryDigest));
	return Object.freeze({
		format: "questpie.postgres-query-plans",
		version: 1,
		plans: Object.freeze(plans),
	});
}

export type { PostgresQueryParameterV1 } from "./parameters";
