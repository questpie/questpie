import { compareAscii, digest } from "../../canonical";
import type { DataQueryTemplate } from "../types";
import {
	buildPostgresCatalog,
	qualifiedTable,
	quoteIdentifier,
	requiredCollection,
	requiredField,
} from "./model";
import { lowerPostgresKeyedLookupProof } from "./nondisclosure";
import {
	PostgresParameters,
	type PostgresQueryParameterV1,
} from "./parameters";
import type {
	PostgresQueryPlan,
	PostgresQueryPlansV1,
	PostgresQueryPlansV2,
	PostgresQueryPlanV1,
	PostgresQueryPlanV2,
} from "./plan";
import { policyExpressionSql } from "./policy";
import {
	cursorSql,
	filterParameters,
	orderSql,
	queryFilterSql,
	queryParameter,
	type QuerySqlContext,
} from "./query";
import {
	lowerPostgresSelections,
	relationPolicyClosure,
	type PolicyProjectionEntry,
} from "./selection";

export type {
	PostgresInverseListResultV2,
	PostgresQueryPlan,
	PostgresQueryPlansV1,
	PostgresQueryPlansV2,
	PostgresQueryPlanV1,
	PostgresQueryPlanV2,
	PostgresQueryResultV1,
} from "./plan";

interface QueryProjectionEntry {
	readonly digest: string;
	readonly policy: string;
	readonly templateVersion?: 1 | 2;
	readonly template: DataQueryTemplate;
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
		(projection.version !== 1 &&
			!(format === "questpie.query-projection" && projection.version === 2)) ||
		!Array.isArray(projection[key])
	)
		throw new TypeError(`invalid ${format}`);
	return projection[key];
}

function usedExecutionFacts(
	parameters: readonly PostgresQueryParameterV1[],
): readonly ("authorityKind" | "principalKind" | "principalId" | "tenantId")[] {
	const used = new Set<
		"authorityKind" | "principalKind" | "principalId" | "tenantId"
	>();
	for (const parameter of parameters) {
		if (parameter.kind !== "executionFact") continue;
		const path = parameter.path.join(".");
		if (parameter.source === "authority" && path === "kind")
			used.add("authorityKind");
		else if (parameter.source === "principal" && path === "kind")
			used.add("principalKind");
		else if (parameter.source === "principal" && path === "id")
			used.add("principalId");
		else if (parameter.source === "tenant" && path === "id")
			used.add("tenantId");
		else
			throw new TypeError(
				`unsupported Policy cursor fact ${parameter.source}.${path}`,
			);
	}
	return (
		["authorityKind", "principalKind", "principalId", "tenantId"] as const
	).filter((fact) => used.has(fact));
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

export function lowerPostgresQueryPlan(
	input: Readonly<{
		schema: unknown;
		query: QueryProjectionEntry;
		policies: readonly PolicyProjectionEntry[];
	}>,
): PostgresQueryPlan {
	if (
		input.query.templateVersion !== undefined &&
		input.query.templateVersion !== input.query.template.version
	)
		throw new TypeError("Query Projection template version mismatch");
	const catalog = buildPostgresCatalog(input.schema);
	const rootCollection = requiredCollection(catalog, input.query.template.from);
	const policy = selectedPolicy(input.query.policy, input.policies);
	if (policy.program.target !== rootCollection.identity)
		throw new TypeError("Query Policy target does not match Query Collection");
	const read = policy.program.operations.read;
	if (!read)
		throw new TypeError(`Policy ${policy.program.identity} denies read`);
	const relatedPolicies = relationPolicyClosure(
		input.query.template.select,
		catalog,
		input.policies,
	);
	for (const related of relatedPolicies) {
		const relatedRead = related.operations.read;
		if (!relatedRead)
			throw new TypeError(`Policy ${related.identity} denies read`);
	}
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

	const { columns, joins, result, inversePolicy, inverseOrdinal } =
		lowerPostgresSelections({
			selection: input.query.template.select,
			rootAlias: pageAlias,
			rootCollection: rootCollection.identity,
			template: input.query.template,
			rootPolicy: policy,
			catalog,
			parameters,
			policies: input.policies,
		});

	const v2 = input.query.template.version === 2;
	if (v2 && (!inversePolicy || !inverseOrdinal))
		throw new TypeError("Template v2 requires one inverse list");
	const rootOrdinal = "qp_root_ordinal";
	const sql = `WITH "qp_page" AS MATERIALIZED (SELECT ${quoteIdentifier(pageAlias)}.*${v2 ? `, ROW_NUMBER() OVER (ORDER BY ${ordering}) AS ${quoteIdentifier(rootOrdinal)}` : ""} FROM ${qualifiedTable(catalog, rootCollection)} AS ${quoteIdentifier(pageAlias)} WHERE ${policySql} AND ${filterSql} AND ${boundarySql} ORDER BY ${ordering} LIMIT (${first} + 1)) SELECT ${v2 ? `${quoteIdentifier(pageAlias)}.${quoteIdentifier(rootOrdinal)} AS ${quoteIdentifier(rootOrdinal)}, ` : ""}${columns.join(", ")} FROM "qp_page" AS ${quoteIdentifier(pageAlias)}${joins.length > 0 ? ` ${joins.join(" ")}` : ""} ORDER BY ${v2 ? `${quoteIdentifier(pageAlias)}.${quoteIdentifier(rootOrdinal)}, ${quoteIdentifier(inverseOrdinal!)}` : ordering};\n`;
	const positionalParameters = parameters.values();
	const keyedLookup = lowerPostgresKeyedLookupProof({
		catalog,
		collection: rootCollection,
		policy: policy.program,
		template: input.query.template,
	});
	const base = {
		format: "questpie.postgres-query-plan",
		version: input.query.template.version,
		queryDigest: input.query.digest,
		templateDigest: input.query.digest,
		policy: policy.program.identity,
		policyProgramDigest: digest("questpie-policy-program-v1", policy.program),
		disclosureProgramDigest: digest("questpie-query-policy-closure-v1", {
			root: policy.program,
			relations: relatedPolicies,
		}),
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
	} as const;
	if (!v2) return Object.freeze(base) as PostgresQueryPlanV1;
	const linked = {
		...base,
		version: 2 as const,
		templateVersion: 2 as const,
		inversePolicyProgramDigest: digest(
			"questpie-policy-program-v1",
			inversePolicy!,
		),
		ordinalColumns: [rootOrdinal, inverseOrdinal!] as const,
	};
	return Object.freeze({
		...linked,
		statementDigest: digest("questpie-postgres-query-statement-v2", linked),
	}) as PostgresQueryPlanV2;
}

export function lowerPostgresQueryPlans(
	input: Readonly<{
		schema: unknown;
		queryProjection: unknown;
		policyProjection: unknown;
	}>,
): PostgresQueryPlansV1 | PostgresQueryPlansV2 {
	const queryProjection = record(
		input.queryProjection,
		"questpie.query-projection",
	);
	const version = queryProjection.version;
	if (version !== 1 && version !== 2)
		throw new TypeError("invalid questpie.query-projection");
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
	const loweredPlans = queries
		.map((query) =>
			lowerPostgresQueryPlan({ schema: input.schema, query, policies }),
		)
		.sort((left, right) => compareAscii(left.queryDigest, right.queryDigest));
	const plans =
		version === 1
			? loweredPlans
			: loweredPlans.map((plan) =>
					plan.version === 1 ? { ...plan, templateVersion: 1 as const } : plan,
				);
	return Object.freeze({
		format: "questpie.postgres-query-plans",
		version,
		plans: Object.freeze(plans),
	}) as PostgresQueryPlansV1 | PostgresQueryPlansV2;
}

export type { PostgresQueryParameterV1 } from "./parameters";
