import { createHash } from "node:crypto";

import type { RuntimeExecutionObservation } from "../observation";
import { assertOperationAdmission } from "../operation";
import type { PostgresParameter, PostgresTransactionRunner } from "../postgres";
import type { PostgresTransaction } from "../postgres";
import { createCursorBindingV2, type CursorScalar } from "./cursor";
import {
	executeLinkedPostgresQueryPlan,
	type LinkedPostgresQueryPlan,
} from "./postgres-database";
import {
	DataQueryExecutionError,
	type DataQueryDiagnosticCode,
} from "./query-error";
import type {
	PostgresInverseListResultV2,
	PostgresQueryParameterV1,
	PostgresQueryPlan,
	PostgresQueryResultV1,
	QueryParameterV1,
	ScalarValue,
} from "./query-plan";
import {
	decodePostgresInversePage,
	decodePostgresQueryRow,
	positivePostgresOrdinal,
	postgresQueryCursorValues,
	postgresQueryOrderTerms,
	type PostgresQueryRow,
} from "./query-result";
import { isValidRelationalScalar } from "./scalar";

export type { ScalarCodecV1 } from "./scalar";
export { DataQueryExecutionError } from "./query-error";
export type { DataQueryDiagnosticCode } from "./query-error";
export type {
	PostgresInverseListResultV2,
	PostgresQueryParameterV1,
	PostgresQueryPlan,
	PostgresQueryPlanV1,
	PostgresQueryPlanV2,
	PostgresQueryResultV1,
	QueryParameterV1,
} from "./query-plan";

export type DataQueryBindingV1 = Readonly<{
	templateDigest: string;
	values: readonly Readonly<{
		parameter: string;
		value: null | ScalarValue | readonly ScalarValue[];
	}>[];
}>;

export type QueryExecutionFacts = Readonly<{
	authority: Readonly<{ kind: "ordinary" | "system" }>;
	principal: Readonly<{
		id: string;
		kind: "anonymous" | "service" | "user";
	}>;
	tenant: Readonly<{ id: string }>;
}>;

export type { PostgresQueryRow } from "./query-result";

export type PostgresQueryObservationV1 = Readonly<{
	templateDigest: string;
	primaryCollection: string;
	tenantId: string;
	scope: readonly Readonly<{
		parameter: string;
		value: null | ScalarValue | readonly ScalarValue[];
	}>[];
	after: string | null;
	first: number;
	observed: number;
	hasNextPage: boolean;
	order: readonly string[];
	relations: readonly Readonly<{
		relation: string;
		collection: string;
		endpoints: number;
		misses: number;
		kind?: "inverseList" | "toOne";
		policyProgramDigest?: string;
		correlation?: readonly Readonly<{ field: string; reference: string }>[];
		first?: number;
		statementDigest?: string;
	}>[];
}>;

export interface PostgresQueryObserver {
	recordPostgresQuery(observation: PostgresQueryObservationV1): void;
}

export type DataQueryPage = Readonly<{
	nodes: readonly Readonly<Record<string, unknown>>[];
	pageInfo: Readonly<{ endCursor: string | null; hasNextPage: boolean }>;
}>;

const digestPattern = /^[0-9a-f]{64}$/;

function hasLoneUnicodeSurrogate(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const codeUnit = value.charCodeAt(index);
		if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
			const next = value.charCodeAt(index + 1);
			if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
			index += 1;
			continue;
		}
		if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return true;
	}
	return false;
}

function quote(value: string): string {
	if (hasLoneUnicodeSurrogate(value)) throw new TypeError("invalid Unicode");
	return JSON.stringify(value);
}

function canonicalScalar(value: ScalarValue): string {
	if (
		typeof value === "number" &&
		(!Number.isFinite(value) || Object.is(value, -0))
	)
		throw new TypeError("invalid number");
	return typeof value === "string" ? quote(value) : JSON.stringify(value);
}

function canonicalValue(
	value: null | ScalarValue | readonly ScalarValue[],
): string {
	if (value === null) return "null";
	if (Array.isArray(value)) return `[${value.map(canonicalScalar).join(",")}]`;
	return canonicalScalar(value as ScalarValue);
}

function sha256(domain: string, bytes: string): string {
	return createHash("sha256").update(`${domain}\0`).update(bytes).digest("hex");
}

function dataQueryScopeBytes(
	templateDigest: string,
	parameterNames: readonly string[],
	values: ReadonlyMap<string, null | ScalarValue | readonly ScalarValue[]>,
): string {
	const entries = parameterNames.map((parameter) => {
		const value = values.get(parameter);
		if (value === undefined)
			throw new TypeError(
				`invalid compiled Query scope parameter ${parameter}`,
			);
		return `{"parameter":${quote(parameter)},"value":${canonicalValue(value)}}`;
	});
	return `{"format":"questpie.data-query-scope","templateDigest":${quote(templateDigest)},"values":[${entries.join(",")}],"version":1}\n`;
}

function bindError(code: DataQueryDiagnosticCode): never {
	throw new DataQueryExecutionError(code, "bind");
}

function normalizeSet(
	value: unknown,
	parameter: Extract<QueryParameterV1, { kind: "list" }>,
): null | readonly ScalarValue[] {
	if (value === null && parameter.nullable) return null;
	if (!Array.isArray(value)) bindError("QP-DATA-006");
	if (value.length > parameter.maximumItems) bindError("QP-DATA-006");
	const unique = new Map<string, ScalarValue>();
	for (const item of value) {
		if (!isValidRelationalScalar(item, parameter.codec))
			bindError("QP-DATA-006");
		unique.set(canonicalScalar(item), item);
	}
	return [...unique.entries()]
		.sort(([left], [right]) =>
			Buffer.compare(Buffer.from(left), Buffer.from(right)),
		)
		.map(([, item]) => item);
}

function normalizeBinding(
	plan: PostgresQueryPlan,
	binding: DataQueryBindingV1,
	maximumPageSize: number,
): ReadonlyMap<string, null | ScalarValue | readonly ScalarValue[]> {
	if (
		binding.templateDigest !== plan.templateDigest ||
		!Array.isArray(binding.values)
	)
		bindError("QP-DATA-014");
	const supplied = new Map<string, unknown>();
	for (const entry of binding.values) {
		if (
			!entry ||
			typeof entry !== "object" ||
			typeof entry.parameter !== "string" ||
			supplied.has(entry.parameter)
		)
			bindError("QP-DATA-014");
		supplied.set(entry.parameter, entry.value);
	}
	if (supplied.size !== plan.binding.parameters.length)
		bindError("QP-DATA-014");
	const normalized = new Map<
		string,
		null | ScalarValue | readonly ScalarValue[]
	>();
	for (const parameter of plan.binding.parameters) {
		if (!supplied.has(parameter.name)) bindError("QP-DATA-014");
		const value = supplied.get(parameter.name);
		if (parameter.kind === "cursor") {
			if (value !== null && typeof value !== "string") bindError("QP-DATA-001");
			normalized.set(parameter.name, value as string | null);
			continue;
		}
		if (parameter.kind === "list") {
			normalized.set(parameter.name, normalizeSet(value, parameter));
			continue;
		}
		if (value === null && parameter.nullable) {
			normalized.set(parameter.name, null);
			continue;
		}
		if (!isValidRelationalScalar(value, parameter.codec))
			bindError("QP-DATA-001");
		normalized.set(parameter.name, value);
	}
	const first = normalized.get(plan.page.first.parameter);
	if (
		typeof first !== "number" ||
		first < plan.page.first.minimum ||
		first > plan.page.first.maximum
	)
		bindError("QP-DATA-001");
	if (first > maximumPageSize) bindError("QP-DATA-012");
	return normalized;
}

function executionFact(
	parameter: Extract<PostgresQueryParameterV1, { kind: "executionFact" }>,
	facts: QueryExecutionFacts,
): ScalarValue {
	const path = parameter.path.join(".");
	if (parameter.source === "authority" && path === "kind")
		return facts.authority.kind;
	if (parameter.source === "principal" && path === "kind")
		return facts.principal.kind;
	if (parameter.source === "principal" && path === "id")
		return facts.principal.id;
	if (parameter.source === "tenant" && path === "id") return facts.tenant.id;
	throw new TypeError(
		`invalid compiled execution fact ${parameter.source}.${path}`,
	);
}

function sparseExecutionFacts(
	plan: PostgresQueryPlan,
	facts: QueryExecutionFacts,
) {
	const expected = new Set<string>();
	for (const parameter of plan.parameters) {
		if (parameter.kind !== "executionFact") continue;
		const path = parameter.path.join(".");
		if (parameter.source === "authority" && path === "kind")
			expected.add("authorityKind");
		else if (parameter.source === "principal" && path === "kind")
			expected.add("principalKind");
		else if (parameter.source === "principal" && path === "id")
			expected.add("principalId");
		else if (parameter.source === "tenant" && path === "id")
			expected.add("tenantId");
		else
			throw new TypeError(
				`invalid compiled execution fact ${parameter.source}.${path}`,
			);
	}
	if (
		plan.usedExecutionFacts.length !== expected.size ||
		plan.usedExecutionFacts.some((key) => !expected.has(key))
	)
		throw new TypeError("invalid compiled Policy cursor fact scope");
	const result: {
		authorityKind?: "ordinary" | "system";
		principalKind?: "anonymous" | "service" | "user";
		principalId?: string;
		tenantId?: string;
	} = {};
	for (const key of plan.usedExecutionFacts) {
		if (key === "authorityKind") result.authorityKind = facts.authority.kind;
		else if (key === "principalKind")
			result.principalKind = facts.principal.kind;
		else if (key === "principalId") result.principalId = facts.principal.id;
		else if (key === "tenantId") result.tenantId = facts.tenant.id;
		else
			throw new TypeError(`invalid compiled execution fact ${key as string}`);
	}
	return result;
}

function positionalParameters(
	plan: PostgresQueryPlan,
	values: ReadonlyMap<string, null | ScalarValue | readonly ScalarValue[]>,
	facts: QueryExecutionFacts,
	boundary: readonly CursorScalar[] | null,
): readonly PostgresParameter[] {
	const orderIndex = new Map(
		plan.page.order.map((term, index) => [term.field, index] as const),
	);
	return plan.parameters.map((parameter, index) => {
		if (parameter.position !== index + 1)
			throw new TypeError("invalid compiled PostgreSQL parameter positions");
		if (parameter.kind === "literal") return parameter.value;
		if (parameter.kind === "executionFact")
			return executionFact(parameter, facts);
		if (parameter.kind === "queryParameter") {
			const value = values.get(parameter.parameter);
			if (value === undefined)
				throw new TypeError("invalid compiled Query parameter reference");
			return value;
		}
		if (parameter.parameter !== plan.page.after.parameter)
			throw new TypeError("invalid compiled cursor parameter reference");
		if (parameter.kind === "cursorPresent") return boundary !== null;
		const termIndex = orderIndex.get(parameter.field);
		if (termIndex === undefined)
			throw new TypeError("invalid compiled cursor Field reference");
		return boundary?.[termIndex] ?? null;
	});
}

function collectionOfField(field: string): string {
	const separator = field.indexOf("/field:");
	if (separator < 1) throw new TypeError("invalid compiled Collection Field");
	return field.slice(0, separator);
}

function queryObservation(
	plan: PostgresQueryPlan,
	values: ReadonlyMap<string, null | ScalarValue | readonly ScalarValue[]>,
	facts: QueryExecutionFacts,
	visibleRows: readonly PostgresQueryRow[],
	first: number,
	hasNextPage: boolean,
	flattenedVisibleRows: readonly PostgresQueryRow[] = visibleRows,
): PostgresQueryObservationV1 {
	const primaryCollections = new Set(
		plan.page.order.map(({ field }) => collectionOfField(field)),
	);
	if (primaryCollections.size !== 1)
		throw new TypeError("invalid compiled Query primary Collection");
	const primaryCollection = [...primaryCollections][0]!;
	const scope = plan.page.scopeParameters.map((parameter) => {
		const value = values.get(parameter);
		if (value === undefined)
			throw new TypeError(
				`invalid compiled Query scope parameter ${parameter}`,
			);
		return Object.freeze({ parameter, value });
	});
	const observeRelations = (
		items: readonly (PostgresQueryResultV1 | PostgresInverseListResultV2)[],
		observationRows: readonly PostgresQueryRow[],
	): PostgresQueryObservationV1["relations"] =>
		items.flatMap((item) => {
			if (item.kind === "field") return [];
			if (item.kind === "inverseList") {
				if (plan.version !== 2)
					throw new TypeError("inverse Query result requires plan v2");
				const childRows = flattenedVisibleRows.filter(
					(row) => positivePostgresOrdinal(row[item.ordinalColumn]) !== null,
				);
				return [
					Object.freeze({
						relation: item.relation,
						collection: item.source,
						endpoints: childRows.length,
						misses:
							visibleRows.length -
							new Set(
								childRows.map((row) =>
									positivePostgresOrdinal(row[plan.ordinalColumns[0]]),
								),
							).size,
						kind: "inverseList" as const,
						policyProgramDigest: plan.inversePolicyProgramDigest,
						correlation: item.correlation,
						first: item.first,
						statementDigest: plan.statementDigest,
					}),
					...observeRelations(item.relations, childRows),
				];
			}
			const collections = new Set(
				item.fields.map(({ field }) => collectionOfField(field)),
			);
			if (item.collection !== undefined) collections.add(item.collection);
			if (collections.size !== 1)
				throw new TypeError("invalid compiled Relation target Collection");
			let endpoints = 0;
			let misses = 0;
			for (const row of observationRows) {
				const present = row[item.presenceColumn];
				if (present === true) endpoints += 1;
				else if (present === null) misses += 1;
			}
			return [
				Object.freeze({
					relation: item.relation,
					collection: item.collection ?? [...collections][0]!,
					endpoints,
					misses,
					...(plan.version === 2
						? {
								kind: "toOne" as const,
								policyProgramDigest:
									plan.disclosureProgramDigest ?? plan.policyProgramDigest,
							}
						: {}),
				}),
				...observeRelations(item.relations ?? [], observationRows),
			];
		});
	const relations = observeRelations(plan.result, visibleRows);
	const after = values.get(plan.page.after.parameter);
	if (after !== null && typeof after !== "string")
		throw new TypeError("invalid compiled cursor binding");
	return Object.freeze({
		templateDigest: plan.templateDigest,
		primaryCollection,
		tenantId: facts.tenant.id,
		scope: Object.freeze(scope),
		after,
		first,
		observed: visibleRows.length,
		hasNextPage,
		order: Object.freeze(plan.page.order.map(({ field }) => field)),
		relations: Object.freeze(relations),
	});
}

type PostgresQueryExecutionInput = Readonly<{
	binding: DataQueryBindingV1;
	executionFacts: QueryExecutionFacts;
	maximumPageSize?: number;
	signal?: AbortSignal;
	observer?: PostgresQueryObserver;
}>;

async function executePostgresQueryWithRows(
	input: PostgresQueryExecutionInput &
		Readonly<{
			plan: PostgresQueryPlan;
			read(
				parameters: readonly PostgresParameter[],
				signal?: AbortSignal,
			): Promise<readonly PostgresQueryRow[]>;
		}>,
): Promise<DataQueryPage> {
	input.signal?.throwIfAborted();
	const plan = input.plan;
	const maximumPageSize = input.maximumPageSize ?? 100;
	if (!Number.isSafeInteger(maximumPageSize) || maximumPageSize < 1)
		throw new TypeError("maximumPageSize must be a positive integer");
	if (
		plan.format !== "questpie.postgres-query-plan" ||
		(plan.version !== 1 && plan.version !== 2) ||
		!digestPattern.test(plan.templateDigest) ||
		!digestPattern.test(plan.policyProgramDigest) ||
		(plan.disclosureProgramDigest !== undefined &&
			!digestPattern.test(plan.disclosureProgramDigest)) ||
		!(["authenticated", "public", "system"] as const).includes(
			plan.admission,
		) ||
		plan.page.kind !== "forwardCursor" ||
		plan.page.order.length === 0 ||
		typeof plan.sql !== "string"
	)
		throw new TypeError("invalid compiled PostgreSQL Query plan");
	assertOperationAdmission(plan.admission, input.executionFacts);
	const values = normalizeBinding(plan, input.binding, maximumPageSize);
	const scopeBytes = dataQueryScopeBytes(
		plan.templateDigest,
		plan.page.scopeParameters,
		values,
	);
	const cursor = createCursorBindingV2({
		templateDigest: plan.templateDigest,
		scopeDigest: sha256("questpie-data-query-scope-v1", scopeBytes),
		policyProgramDigest:
			plan.disclosureProgramDigest ?? plan.policyProgramDigest,
		usedExecutionFacts: sparseExecutionFacts(plan, input.executionFacts),
		order: postgresQueryOrderTerms(plan),
	});
	const after = values.get(plan.page.after.parameter);
	if (after !== null && typeof after !== "string")
		throw new TypeError("invalid compiled cursor binding");
	return cursor.execute(after, async (boundary) => {
		input.signal?.throwIfAborted();
		const parameters = positionalParameters(
			plan,
			values,
			input.executionFacts,
			boundary,
		);
		const rows = await input.read(parameters, input.signal);
		input.signal?.throwIfAborted();
		const first = values.get(plan.page.first.parameter);
		if (typeof first !== "number")
			throw new TypeError("invalid compiled page binding");
		if (plan.version === 1 && rows.length > first + 1)
			throw new TypeError(
				"PostgreSQL Query adapter exceeded compiled row bound",
			);
		const inversePage =
			plan.version === 2 ? decodePostgresInversePage(plan, rows, first) : null;
		const visibleRows = inversePage?.representativeRows ?? rows.slice(0, first);
		const nodes =
			inversePage?.nodes ??
			visibleRows.map((row) => decodePostgresQueryRow(row, plan.result));
		const last = visibleRows.at(-1);
		const page = Object.freeze({
			nodes: Object.freeze(nodes),
			pageInfo: Object.freeze({
				endCursor: last
					? cursor.encode(postgresQueryCursorValues(plan, last))
					: null,
				hasNextPage: inversePage?.hasNextPage ?? rows.length > first,
			}),
		});
		if (
			plan.version === 2 &&
			Buffer.byteLength(JSON.stringify(page), "utf8") > 1_048_576
		)
			throw new DataQueryExecutionError("QP-DATA-012", "execute");
		input.observer?.recordPostgresQuery(
			queryObservation(
				plan,
				values,
				input.executionFacts,
				visibleRows,
				first,
				inversePage?.hasNextPage ?? rows.length > first,
				inversePage?.flattenedVisibleRows ?? visibleRows,
			),
		);
		return page;
	});
}

export function executePostgresDatabaseQuery(
	input: PostgresQueryExecutionInput &
		Readonly<{
			linkedPlan: LinkedPostgresQueryPlan;
			database: PostgresTransactionRunner;
			observation: RuntimeExecutionObservation | null;
		}>,
): Promise<DataQueryPage> {
	return executePostgresQueryWithRows({
		...input,
		plan: input.linkedPlan.plan,
		read: (parameters, signal) =>
			executeLinkedPostgresQueryPlan(
				input.database,
				input.linkedPlan,
				parameters,
				signal,
				input.observation === null
					? null
					: {
							execution: input.observation,
							principalKind: input.executionFacts.principal.kind,
						},
			),
	});
}

/** Executes an already-linked Query plan inside an owning transaction. */
export function executePostgresTransactionQuery(
	input: PostgresQueryExecutionInput &
		Readonly<{
			linkedPlan: LinkedPostgresQueryPlan;
			transaction: PostgresTransaction;
		}>,
): Promise<DataQueryPage> {
	return executePostgresQueryWithRows({
		...input,
		plan: input.linkedPlan.plan,
		read: (parameters) =>
			input.transaction.execute(input.linkedPlan.statement, parameters),
	});
}
