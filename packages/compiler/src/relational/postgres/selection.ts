import type { PolicyScopeBindingV1 } from "../binding";
import type {
	DataQueryTemplate,
	FieldQuerySelectionV1,
	PolicyProgramV1,
	QuerySelectionV2,
} from "../types";
import {
	fieldValueSql,
	qualifiedTable,
	quoteIdentifier,
	requiredCollection,
	requiredField,
	type PostgresCatalog,
} from "./model";
import { PostgresParameters } from "./parameters";
import type {
	PostgresInverseListResultV2,
	PostgresQueryResultV1,
} from "./plan";
import { policyExpressionSql } from "./policy";
import { queryFilterSql } from "./query";

export interface PolicyProjectionEntry {
	readonly program: PolicyProgramV1;
	readonly scopeBindings: readonly PolicyScopeBindingV1[];
}

function admissionSql(
	admission: "authenticated" | "public" | "system",
	parameters: PostgresParameters,
): string {
	if (admission === "public") return "TRUE";
	if (admission === "system")
		return `(${parameters.execution("authority", ["kind"], "authority")} IS NOT DISTINCT FROM ${parameters.literal("system", "authority")})`;
	return `(${parameters.execution("principal", ["kind"], "text")} IS DISTINCT FROM ${parameters.literal("anonymous", "text")})`;
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
	selection: Extract<QuerySelectionV2, { kind: "toOne" }>,
	path: readonly number[],
	rootAlias: string,
	catalog: PostgresCatalog,
	parameters: PostgresParameters,
	policies: readonly PolicyProjectionEntry[],
): Readonly<{
	join: string;
	columns: readonly string[];
	columnNames: readonly string[];
	result: Extract<PostgresQueryResultV1, { kind: "toOne" }>;
}> {
	const relation = catalog.relations.get(selection.relation);
	if (!relation) throw new TypeError(`unknown Relation ${selection.relation}`);
	const target = requiredCollection(catalog, relation.target);
	const policy = defaultPolicy(target.identity, policies);
	const read = policy.program.operations.read;
	if (!read)
		throw new TypeError(`Policy ${policy.program.identity} denies read`);
	const pathKey = path.join("_");
	const rowAlias = `qp_relation_${pathKey}_row`;
	const relationAlias = `qp_relation_${pathKey}`;
	const aliases = new Map([["row", rowAlias]]);
	const rowDisclosure = policyExpressionSql(read.rows, {
		catalog,
		parameters,
		aliases,
	});
	const disclosure = admissionSql(read.admission.kind, parameters);
	const correlations = relation.fields.map((source, relationIndex) => {
		const targetIdentity = relation.references[relationIndex];
		if (!targetIdentity)
			throw new TypeError(`invalid Relation ${relation.identity}`);
		const sourceField = requiredField(catalog, source);
		const targetField = requiredField(catalog, targetIdentity);
		return `${quoteIdentifier(rowAlias)}.${quoteIdentifier(targetField.postgresName)} IS NOT DISTINCT FROM ${quoteIdentifier(rootAlias)}.${quoteIdentifier(sourceField.postgresName)}`;
	});
	const selected = selection.select
		.filter(
			(selection): selection is FieldQuerySelectionV1 =>
				selection.kind === "field",
		)
		.map((fieldSelection, fieldIndex) => {
			const field = requiredField(catalog, fieldSelection.field);
			const column = `qp_relation_${pathKey}_value_${fieldIndex}`;
			const rule = policy.program.fields?.selectedOutput.find(
				(candidate) =>
					JSON.stringify(candidate.path) === JSON.stringify(field.path),
			);
			const guardColumn = `qp_relation_${pathKey}_allowed_${fieldIndex}`;
			const guardAlias = `qp_relation_${pathKey}_guard_${fieldIndex}`;
			const guard = rule
				? policyExpressionSql(rule.when, { catalog, parameters, aliases })
				: null;
			return {
				inner:
					guard === null
						? [
								`${fieldValueSql(field, rowAlias)} AS ${quoteIdentifier(column)}`,
							]
						: [
								`CASE WHEN ${quoteIdentifier(guardAlias)}."allowed" THEN ${fieldValueSql(field, rowAlias)} ELSE NULL END AS ${quoteIdentifier(column)}`,
								`${quoteIdentifier(guardAlias)}."allowed" AS ${quoteIdentifier(guardColumn)}`,
							],
				guardJoin:
					guard === null
						? null
						: `CROSS JOIN LATERAL (SELECT ${guard} AS "allowed") AS ${quoteIdentifier(guardAlias)}`,
				result: {
					key: fieldSelection.key,
					field: field.identity,
					column,
					codec: field.codec,
					nullable: field.nullable,
					...(guard === null ? {} : { guardColumn }),
				},
			};
		});
	const nested = selection.select
		.filter(
			(selection): selection is Extract<QuerySelectionV2, { kind: "toOne" }> =>
				selection.kind === "toOne",
		)
		.map((child, index) =>
			relationJoin(
				child,
				[...path, index],
				rowAlias,
				catalog,
				parameters,
				policies,
			),
		);
	const presenceColumn = `qp_relation_${pathKey}_present`;
	const innerColumns = [
		`TRUE AS ${quoteIdentifier(presenceColumn)}`,
		...selected.flatMap(({ inner }) => inner),
		...nested.flatMap(({ columns }) => columns),
	];
	const columnNames = [
		presenceColumn,
		...selected.flatMap(({ result }) => [
			result.column,
			...(result.guardColumn === undefined ? [] : [result.guardColumn]),
		]),
		...nested.flatMap(({ columnNames }) => columnNames),
	];
	const ownedJoins = [
		...selected.flatMap(({ guardJoin }) =>
			guardJoin === null ? [] : [guardJoin],
		),
		...nested.map(({ join }) => join),
	];
	const join = `LEFT JOIN LATERAL (SELECT ${innerColumns.join(", ")} FROM ${qualifiedTable(catalog, target)} AS ${quoteIdentifier(rowAlias)}${ownedJoins.length > 0 ? ` ${ownedJoins.join(" ")}` : ""} WHERE ${[...correlations, disclosure, rowDisclosure].join(" AND ")} LIMIT 1) AS ${quoteIdentifier(relationAlias)} ON TRUE`;
	return {
		join,
		columns: columnNames.map(
			(column) =>
				`${quoteIdentifier(relationAlias)}.${quoteIdentifier(column)} AS ${quoteIdentifier(column)}`,
		),
		columnNames,
		result: {
			kind: "toOne",
			key: selection.key,
			relation: relation.identity,
			collection: target.identity,
			presenceColumn,
			fields: selected.map(({ result }) => result),
			relations: nested.map(({ result }) => result),
		},
	};
}

export function relationPolicyClosure(
	selection: readonly QuerySelectionV2[],
	catalog: PostgresCatalog,
	policies: readonly PolicyProjectionEntry[],
): readonly PolicyProgramV1[] {
	return selection.flatMap((selected) => {
		if (selected.kind === "field") return [];
		const relation = catalog.relations.get(selected.relation);
		if (!relation) throw new TypeError(`unknown Relation ${selected.relation}`);
		const target =
			selected.kind === "inverseList" ? selected.source : relation.target;
		const policy = defaultPolicy(target, policies);
		return [
			policy.program,
			...relationPolicyClosure(selected.select, catalog, policies),
		];
	});
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

function inverseListJoin(
	selection: Extract<QuerySelectionV2, { kind: "inverseList" }>,
	index: number,
	rootAlias: string,
	rootCollection: string,
	template: DataQueryTemplate,
	catalog: PostgresCatalog,
	parameters: PostgresParameters,
	policies: readonly PolicyProjectionEntry[],
): Readonly<{
	join: string;
	columns: readonly string[];
	result: PostgresInverseListResultV2;
	policy: PolicyProgramV1;
}> {
	const relation = catalog.relations.get(selection.relation);
	if (
		!relation ||
		relation.source !== selection.source ||
		relation.target !== rootCollection
	)
		throw new TypeError("unresolved inverse Relation identity");
	const source = requiredCollection(catalog, selection.source);
	const policy = defaultPolicy(source.identity, policies);
	const read = policy.program.operations.read;
	if (!read)
		throw new TypeError(`Policy ${policy.program.identity} denies read`);
	const rowAlias = `qp_inverse_${index}_row`;
	const listAlias = `qp_inverse_${index}`;
	const aliases = new Map([["row", rowAlias]]);
	const disclosure = admissionSql(read.admission.kind, parameters);
	const rowPolicy = policyExpressionSql(read.rows, {
		catalog,
		parameters,
		aliases,
	});
	const correlations = relation.fields.map((fieldIdentity, relationIndex) => {
		const referenceIdentity = relation.references[relationIndex];
		if (!referenceIdentity)
			throw new TypeError(`invalid Relation ${relation.identity}`);
		const field = requiredField(catalog, fieldIdentity);
		const reference = requiredField(catalog, referenceIdentity);
		return `${fieldValueSql(field, rowAlias)} IS NOT DISTINCT FROM ${fieldValueSql(reference, rootAlias)}`;
	});
	const filter = selection.filter
		? queryFilterSql(selection.filter, {
				catalog,
				parameters,
				template,
				alias: rowAlias,
			})
		: "TRUE";
	const ordering = selection.order
		.map((term) => {
			const field = requiredField(catalog, term.field);
			if (field.collection !== source.identity)
				throw new TypeError("inverse order Field is outside its source");
			return `${fieldValueSql(field, rowAlias)} ${term.direction.toUpperCase()} NULLS ${term.nulls.toUpperCase()}`;
		})
		.join(", ");
	const selected = selection.select
		.filter(
			(selection): selection is FieldQuerySelectionV1 =>
				selection.kind === "field",
		)
		.map((fieldSelection, fieldIndex) => {
			const field = requiredField(catalog, fieldSelection.field);
			if (field.collection !== source.identity)
				throw new TypeError("inverse selected Field is outside its source");
			const column = `qp_inverse_${index}_value_${fieldIndex}`;
			const rule = policy.program.fields?.selectedOutput.find(
				(candidate) =>
					JSON.stringify(candidate.path) === JSON.stringify(field.path),
			);
			const guardColumn = `qp_inverse_${index}_allowed_${fieldIndex}`;
			const guardAlias = `qp_inverse_${index}_guard_${fieldIndex}`;
			const guard = rule
				? policyExpressionSql(rule.when, { catalog, parameters, aliases })
				: null;
			return {
				inner:
					guard === null
						? `${fieldValueSql(field, rowAlias)} AS ${quoteIdentifier(column)}`
						: `CASE WHEN ${quoteIdentifier(guardAlias)}."allowed" THEN ${fieldValueSql(field, rowAlias)} ELSE NULL END AS ${quoteIdentifier(column)}, ${quoteIdentifier(guardAlias)}."allowed" AS ${quoteIdentifier(guardColumn)}`,
				guardJoin:
					guard === null
						? null
						: `CROSS JOIN LATERAL (SELECT ${guard} AS "allowed") AS ${quoteIdentifier(guardAlias)}`,
				result: {
					key: fieldSelection.key,
					field: field.identity,
					column,
					codec: field.codec,
					nullable: field.nullable,
					...(guard === null ? {} : { guardColumn }),
				},
			};
		});
	const nested = selection.select
		.filter(
			(selection): selection is Extract<QuerySelectionV2, { kind: "toOne" }> =>
				selection.kind === "toOne",
		)
		.map((child, nestedIndex) =>
			relationJoin(
				child,
				[index, nestedIndex],
				rowAlias,
				catalog,
				parameters,
				policies,
			),
		);
	const ordinalColumn = `qp_inverse_${index}_ordinal`;
	const innerColumns = [
		...selected.map(({ inner }) => inner),
		...nested.flatMap(({ columns }) => columns),
		`ROW_NUMBER() OVER (ORDER BY ${ordering}) AS ${quoteIdentifier(ordinalColumn)}`,
	];
	const columnNames = [
		...selected.flatMap(({ result }) => [
			result.column,
			...(result.guardColumn === undefined ? [] : [result.guardColumn]),
		]),
		...nested.flatMap(({ columnNames }) => columnNames),
		ordinalColumn,
	];
	const joins = [
		...selected.flatMap(({ guardJoin }) =>
			guardJoin === null ? [] : [guardJoin],
		),
		...nested.map(({ join }) => join),
	];
	const limit = parameters.literal(selection.first, "integer");
	return {
		join: `LEFT JOIN LATERAL (SELECT ${innerColumns.join(", ")} FROM ${qualifiedTable(catalog, source)} AS ${quoteIdentifier(rowAlias)}${joins.length > 0 ? ` ${joins.join(" ")}` : ""} WHERE ${[...correlations, disclosure, rowPolicy, filter].join(" AND ")} ORDER BY ${ordering} LIMIT ${limit}) AS ${quoteIdentifier(listAlias)} ON TRUE`,
		columns: columnNames.map(
			(column) =>
				`${quoteIdentifier(listAlias)}.${quoteIdentifier(column)} AS ${quoteIdentifier(column)}`,
		),
		policy: policy.program,
		result: {
			kind: "inverseList",
			key: selection.key,
			relation: relation.identity,
			source: source.identity,
			correlation: relation.fields.map((field, relationIndex) => ({
				field,
				reference: relation.references[relationIndex]!,
			})),
			first: selection.first,
			ordinalColumn,
			fields: selected.map(({ result }) => result),
			relations: nested.map(({ result }) => result),
		},
	};
}

export function lowerPostgresSelections(
	input: Readonly<{
		selection: readonly QuerySelectionV2[];
		rootAlias: string;
		rootCollection: string;
		template: DataQueryTemplate;
		rootPolicy: PolicyProjectionEntry;
		catalog: PostgresCatalog;
		parameters: PostgresParameters;
		policies: readonly PolicyProjectionEntry[];
	}>,
): Readonly<{
	columns: readonly string[];
	joins: readonly string[];
	result: readonly (PostgresQueryResultV1 | PostgresInverseListResultV2)[];
	inversePolicy: PolicyProgramV1 | null;
	inverseOrdinal: string | null;
}> {
	const columns: string[] = [];
	const joins: string[] = [];
	const result: (PostgresQueryResultV1 | PostgresInverseListResultV2)[] = [];
	let inversePolicy: PolicyProgramV1 | null = null;
	let inverseOrdinal: string | null = null;
	for (const [index, selection] of input.selection.entries()) {
		if (selection.kind === "field") {
			const rendered = rootFieldResult(
				selection,
				index,
				input.rootAlias,
				input.rootPolicy,
				input.catalog,
				input.parameters,
			);
			columns.push(...rendered.columns);
			joins.push(...rendered.joins);
			result.push(rendered.result);
			continue;
		}
		if (selection.kind === "inverseList") {
			const rendered = inverseListJoin(
				selection,
				index,
				input.rootAlias,
				input.rootCollection,
				input.template,
				input.catalog,
				input.parameters,
				input.policies,
			);
			columns.push(...rendered.columns);
			joins.push(rendered.join);
			result.push(rendered.result);
			inversePolicy = rendered.policy;
			inverseOrdinal = rendered.result.ordinalColumn;
			continue;
		}
		const rendered = relationJoin(
			selection,
			[index],
			input.rootAlias,
			input.catalog,
			input.parameters,
			input.policies,
		);
		columns.push(...rendered.columns);
		joins.push(rendered.join);
		result.push(rendered.result);
	}
	return { columns, joins, result, inversePolicy, inverseOrdinal };
}
