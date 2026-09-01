import {
	canonicalBytes,
	digest,
} from "../../../../../packages/compiler/src/canonical";
import type { DataQueryTemplateV1 } from "../../../../../packages/compiler/src/relational/types";
import { inverseListSql } from "../postgres/proof-kernel";

type FieldSelection = Readonly<{
	kind: "field";
	key: string;
	field: `collection:${string}/field:${string}`;
}>;

type ToOneSelectionV2 = Readonly<{
	kind: "toOne";
	key: string;
	relation: `collection:${string}/relation:${string}`;
	select: readonly QuerySelectionV2[];
}>;

type ToManyListSelectionV2 = Readonly<{
	kind: "toManyList";
	key: string;
	relation: `collection:${string}/relation:${string}`;
	source: `collection:${string}`;
	first: number;
	where: Readonly<{
		kind: "notEqual";
		field: `collection:${string}/field:${string}`;
		operand: Readonly<{
			kind: "literal";
			codec: Readonly<{
				kind: "text";
				minLength: number | null;
				maxLength: number | null;
				collation: "questpie.binary";
			}>;
			value: string;
		}>;
	}>;
	order: readonly Readonly<{
		field: `collection:${string}/field:${string}`;
		direction: "asc" | "desc";
	}>[];
	select: readonly QuerySelectionV2[];
}>;

export type QuerySelectionV2 =
	| FieldSelection
	| ToOneSelectionV2
	| ToManyListSelectionV2;

export type DataQueryTemplateV1Proof = DataQueryTemplateV1;

export type DataQueryTemplateV2Proof = Omit<
	DataQueryTemplateV1Proof,
	"version" | "select"
> &
	Readonly<{
		version: 2;
		maximumRelationEdges: 4;
		select: readonly QuerySelectionV2[];
	}>;

export type QueryTemplateProof =
	| DataQueryTemplateV1Proof
	| DataQueryTemplateV2Proof;

export const v1Vector: DataQueryTemplateV1Proof = Object.freeze({
	format: "questpie.data-query-template",
	version: 1,
	from: "collection:tickets",
	schemaProjectionDigest: "a".repeat(64),
	dataContractProjectionDigest: "b".repeat(64),
	parameters: Object.freeze([
		Object.freeze({
			name: "first",
			kind: "scalar",
			codec: Object.freeze({ kind: "integer", minimum: 1, maximum: 100 }),
			nullable: false,
		}),
		Object.freeze({ name: "after", kind: "cursor", nullable: true }),
	]),
	select: Object.freeze([
		Object.freeze({
			kind: "field",
			key: "id",
			field: "collection:tickets/field:id",
		}),
	]),
	filter: null,
	order: Object.freeze([
		Object.freeze({
			field: "collection:tickets/field:id",
			direction: "asc",
			nulls: "last",
		}),
	]),
	page: Object.freeze({
		kind: "forwardCursor",
		first: Object.freeze({ kind: "parameter", parameter: "first" }),
		after: Object.freeze({ kind: "parameter", parameter: "after" }),
		uniqueConstraint: "collection:tickets/constraint:primary",
	}),
});

export const recursiveV1Vector: DataQueryTemplateV1Proof = Object.freeze({
	...v1Vector,
	select: Object.freeze([
		...v1Vector.select,
		Object.freeze({
			kind: "toOne" as const,
			key: "reporter",
			relation: "collection:tickets/relation:reporter",
			select: Object.freeze([
				Object.freeze({
					kind: "toOne" as const,
					key: "principal",
					relation: "collection:memberships/relation:principal",
					select: Object.freeze([
						Object.freeze({
							kind: "field" as const,
							key: "id",
							field: "collection:principals/field:id",
						}),
					]),
				}),
			]),
		}),
	]),
});

export const v2Vector: DataQueryTemplateV2Proof = Object.freeze({
	format: "questpie.data-query-template",
	version: 2,
	from: "collection:tickets",
	schemaProjectionDigest: v1Vector.schemaProjectionDigest,
	dataContractProjectionDigest: v1Vector.dataContractProjectionDigest,
	parameters: v1Vector.parameters,
	maximumRelationEdges: 4,
	select: Object.freeze([
		Object.freeze({
			kind: "field",
			key: "id",
			field: "collection:tickets/field:id",
		}),
		Object.freeze({
			kind: "field",
			key: "title",
			field: "collection:tickets/field:title",
		}),
		Object.freeze({
			kind: "toManyList",
			key: "comments",
			relation: "collection:tickets/relation:comments",
			source: "collection:comments",
			first: 50,
			where: Object.freeze({
				kind: "notEqual",
				field: "collection:comments/field:body",
				operand: Object.freeze({
					kind: "literal",
					codec: Object.freeze({
						kind: "text",
						minLength: 0,
						maxLength: null,
						collation: "questpie.binary",
					}),
					value: "filtered",
				}),
			}),
			order: Object.freeze([
				Object.freeze({
					field: "collection:comments/field:createdAt",
					direction: "desc",
				}),
				Object.freeze({
					field: "collection:comments/field:id",
					direction: "desc",
				}),
			]),
			select: Object.freeze([
				Object.freeze({
					kind: "field",
					key: "id",
					field: "collection:comments/field:id",
				}),
				Object.freeze({
					kind: "field",
					key: "body",
					field: "collection:comments/field:body",
				}),
				Object.freeze({
					kind: "field",
					key: "createdAt",
					field: "collection:comments/field:createdAt",
				}),
			]),
		}),
	]),
	filter: null,
	order: v1Vector.order,
	page: v1Vector.page,
});

export function templateDigest(template: QueryTemplateProof): string {
	return digest(`questpie-data-query-template-v${template.version}`, template);
}

export type QueryProjectionProof = Readonly<{
	format: "questpie.query-projection";
	version: 1 | 2;
	queries: readonly Readonly<{
		templateVersion: 1 | 2;
		templateDigest: string;
		template: QueryTemplateProof;
	}>[];
}>;

export type PostgresPlansProof = Readonly<{
	format: "questpie.postgres-query-plans";
	version: 1 | 2;
	plans: readonly Readonly<{
		templateVersion: 1 | 2;
		templateDigest: string;
		resultColumns: readonly string[];
		ordinalColumns: readonly string[];
		statement: null | Readonly<{
			sql: string;
			parameterOrder: readonly string[];
			parameterBindings: readonly Readonly<{
				name: string;
				source:
					| Readonly<{ kind: "executionFact"; fact: "tenant" }>
					| Readonly<{
							kind: "decodedCursorOrder";
							parameter: "after";
							field: `collection:${string}/field:${string}`;
							templateDigest: string;
					  }>
					| Readonly<{ kind: "queryParameter"; parameter: "first" }>
					| Readonly<{ kind: "artifactLiteral"; value: number }>;
			}>[];
			result: readonly Readonly<{
				name: string;
				codec: "boolean" | "integer" | "text";
				nullable: boolean;
			}>[];
			policyProgramDigest: string;
			statementDigest: string;
		}>;
	}>[];
}>;

type StatementBase = Readonly<{
	sql: string;
	parameterOrder: readonly string[];
	parameterBindings: readonly Readonly<{
		name: string;
		source:
			| Readonly<{ kind: "executionFact"; fact: "tenant" }>
			| Readonly<{
					kind: "decodedCursorOrder";
					parameter: "after";
					field: `collection:${string}/field:${string}`;
					templateDigest: string;
			  }>
			| Readonly<{ kind: "queryParameter"; parameter: "first" }>
			| Readonly<{ kind: "artifactLiteral"; value: number }>;
	}>[];
	result: readonly Readonly<{
		name: string;
		codec: "boolean" | "integer" | "text";
		nullable: boolean;
	}>[];
	policyProgramDigest: string;
}>;

function postgresStatementDigest(
	templateDigestValue: string,
	statement: StatementBase,
): string {
	return digest("questpie-postgres-query-statement-v2", {
		templateDigest: templateDigestValue,
		...statement,
	});
}

export function projectArtifacts(template: QueryTemplateProof): Readonly<{
	query: QueryProjectionProof;
	plans: PostgresPlansProof;
	appContract: Readonly<{
		comments?: readonly Readonly<{ key: string; optional: boolean }>[];
	}>;
	runtimeBuildDigest: string;
}> {
	const selectedList = template.select.find(
		(selection) => selection.kind === "toManyList",
	) as ToManyListSelectionV2 | undefined;
	const version = template.version;
	const linkedDigest = templateDigest(template);
	const statementBase: StatementBase | null = selectedList
		? Object.freeze({
				sql: inverseListSql,
				parameterOrder: Object.freeze([
					"tenant",
					"afterId",
					"first",
					"childFirst",
				]),
				parameterBindings: Object.freeze([
					Object.freeze({
						name: "tenant",
						source: Object.freeze({
							kind: "executionFact" as const,
							fact: "tenant" as const,
						}),
					}),
					Object.freeze({
						name: "afterId",
						source: Object.freeze({
							kind: "decodedCursorOrder" as const,
							parameter: "after" as const,
							field: "collection:tickets/field:id" as const,
							templateDigest: linkedDigest,
						}),
					}),
					Object.freeze({
						name: "first",
						source: Object.freeze({
							kind: "queryParameter" as const,
							parameter: "first" as const,
						}),
					}),
					Object.freeze({
						name: "childFirst",
						source: Object.freeze({
							kind: "artifactLiteral" as const,
							value: selectedList.first,
						}),
					}),
				]),
				result: Object.freeze([
					Object.freeze({
						name: "root_id",
						codec: "text" as const,
						nullable: false,
					}),
					Object.freeze({
						name: "root_title",
						codec: "text" as const,
						nullable: false,
					}),
					Object.freeze({
						name: "root_ordinal",
						codec: "integer" as const,
						nullable: false,
					}),
					Object.freeze({
						name: "child_id",
						codec: "text" as const,
						nullable: true,
					}),
					Object.freeze({
						name: "child_body",
						codec: "text" as const,
						nullable: true,
					}),
					Object.freeze({
						name: "child_body_allowed",
						codec: "boolean" as const,
						nullable: true,
					}),
					Object.freeze({
						name: "child_created_at",
						codec: "integer" as const,
						nullable: true,
					}),
					Object.freeze({
						name: "child_ordinal",
						codec: "integer" as const,
						nullable: true,
					}),
				]),
				policyProgramDigest: digest("questpie-policy-program-proof-v1", {
					root: "policy:tickets.default",
					child: "policy:comments.default",
					selectedOutput: ["collection:comments/field:body"],
				}),
			})
		: null;
	const statement = statementBase
		? Object.freeze({
				...statementBase,
				statementDigest: postgresStatementDigest(linkedDigest, statementBase),
			})
		: null;
	const query = Object.freeze({
		format: "questpie.query-projection" as const,
		version,
		queries: Object.freeze([
			Object.freeze({
				templateVersion: version,
				templateDigest: linkedDigest,
				template,
			}),
		]),
	});
	const plans = Object.freeze({
		format: "questpie.postgres-query-plans" as const,
		version,
		plans: Object.freeze([
			Object.freeze({
				templateVersion: version,
				templateDigest: linkedDigest,
				resultColumns: Object.freeze(
					selectedList
						? [
								"root_id",
								"root_title",
								"child_id",
								"child_body",
								"child_body_allowed",
								"child_created_at",
							]
						: ["root_id"],
				),
				ordinalColumns: Object.freeze(
					selectedList ? ["root_ordinal", "child_ordinal"] : [],
				),
				statement,
			}),
		]),
	});
	const appContract = selectedList
		? Object.freeze({
				comments: Object.freeze(
					selectedList.select
						.filter(
							(selection): selection is FieldSelection =>
								selection.kind === "field",
						)
						.map(({ key, field }) =>
							Object.freeze({
								key,
								optional: field === "collection:comments/field:body",
							}),
						),
				),
			})
		: Object.freeze({});
	return Object.freeze({
		query,
		plans,
		appContract,
		runtimeBuildDigest: digest("questpie-runtime-build-proof-v1", {
			query,
			plans,
			appContract,
		}),
	});
}

export function linkArtifacts(
	input: ReturnType<typeof projectArtifacts>,
): void {
	if (input.query.version !== input.plans.version)
		throw new TypeError("readiness: query/plan version mismatch");
	const query = input.query.queries[0];
	const plan = input.plans.plans[0];
	if (!query || !plan) throw new TypeError("readiness: missing query plan");
	if (query.templateVersion !== input.query.version)
		throw new TypeError("readiness: unknown template version");
	if (query.templateDigest !== templateDigest(query.template))
		throw new TypeError("readiness: template digest mismatch");
	if (
		plan.templateVersion !== query.templateVersion ||
		plan.templateDigest !== query.templateDigest
	)
		throw new TypeError("readiness: plan/template mismatch");
	if (query.template.version === 2) {
		const list = query.template.select.find(
			(selection) => selection.kind === "toManyList",
		) as ToManyListSelectionV2 | undefined;
		if (!list || list.source !== "collection:comments")
			throw new TypeError("readiness: unresolved inverse list");
		if (!plan.statement)
			throw new TypeError("readiness: missing executable statement");
		if (
			canonicalBytes(plan.ordinalColumns) !==
			canonicalBytes(["root_ordinal", "child_ordinal"])
		)
			throw new TypeError("readiness: invalid ordinal columns");
		const expectedColumns = [
			"root_id",
			"root_title",
			"child_id",
			"child_body",
			"child_body_allowed",
			"child_created_at",
		];
		if (canonicalBytes(plan.resultColumns) !== canonicalBytes(expectedColumns))
			throw new TypeError("readiness: invalid result column");
		if (plan.statement.sql !== inverseListSql)
			throw new TypeError("readiness: SQL/template mismatch");
		if (
			canonicalBytes(plan.statement.parameterOrder) !==
			canonicalBytes(["tenant", "afterId", "first", "childFirst"])
		)
			throw new TypeError("readiness: invalid statement parameters");
		const cursorBinding = plan.statement.parameterBindings.find(
			(binding) => binding.name === "afterId",
		);
		if (
			!cursorBinding ||
			cursorBinding.source.kind !== "decodedCursorOrder" ||
			cursorBinding.source.parameter !== "after" ||
			cursorBinding.source.field !== "collection:tickets/field:id" ||
			cursorBinding.source.templateDigest !== query.templateDigest
		)
			throw new TypeError("readiness: invalid cursor binding");
		if (
			canonicalBytes(plan.statement.result.map(({ name }) => name)) !==
			canonicalBytes([
				"root_id",
				"root_title",
				"root_ordinal",
				"child_id",
				"child_body",
				"child_body_allowed",
				"child_created_at",
				"child_ordinal",
			])
		)
			throw new TypeError("readiness: invalid result descriptor");
		const { statementDigest, ...statementBase } = plan.statement;
		if (
			statementDigest !==
			postgresStatementDigest(query.templateDigest, statementBase)
		)
			throw new TypeError("readiness: statement digest mismatch");
	}
	const expectedBuild = digest("questpie-runtime-build-proof-v1", {
		query: input.query,
		plans: input.plans,
		appContract: input.appContract,
	});
	if (input.runtimeBuildDigest !== expectedBuild)
		throw new TypeError("readiness: Runtime Build digest mismatch");
}
