import {
	buildPostgresCatalog,
	qualifiedTable,
	type PostgresField,
	requiredCollection,
} from "./postgres/model";
import {
	PostgresParameters,
	type PostgresQueryParameterV1,
} from "./postgres/parameters";
import { policyExpressionSql } from "./postgres/policy";
import type { PolicyExpressionV1, ScalarCodecV1 } from "./types";

export interface PostgresMutationFieldV1 {
	readonly identity: string;
	readonly path: readonly string[];
	readonly column: string;
	readonly codec: ScalarCodecV1;
	readonly nullable: boolean;
	readonly defaultValue: PostgresField["defaultValue"];
}

export interface PostgresMutationCollectionV1 {
	readonly identity: string;
	readonly table: string;
	readonly fields: readonly PostgresMutationFieldV1[];
}

export function postgresMutationCollection(
	schema: unknown,
	identity: `collection:${string}`,
): PostgresMutationCollectionV1 {
	const catalog = buildPostgresCatalog(schema);
	const collection = requiredCollection(catalog, identity);
	return Object.freeze({
		identity,
		table: qualifiedTable(catalog, collection),
		fields: Object.freeze(
			[...collection.fields.values()].map((field) =>
				Object.freeze({
					identity: field.identity,
					path: field.path,
					column: field.postgresName,
					codec: field.codec,
					nullable: field.nullable,
					defaultValue: field.defaultValue,
				}),
			),
		),
	});
}

function evidenceCollections(
	expression: PolicyExpressionV1,
	output = new Set<`collection:${string}`>(),
): ReadonlySet<`collection:${string}`> {
	if (expression.kind === "exists") {
		output.add(expression.collection);
		evidenceCollections(expression.predicate, output);
	} else if (expression.kind === "and" || expression.kind === "or") {
		for (const item of expression.items) evidenceCollections(item, output);
	} else if (expression.kind === "not") {
		evidenceCollections(expression.expression, output);
	}
	return output;
}

export function lowerPostgresMutationPolicyCheck(
	input: Readonly<{
		schema: unknown;
		expression: PolicyExpressionV1;
		aliases: Readonly<Record<string, string>>;
	}>,
): Readonly<{
	sql: string;
	parameters: readonly PostgresQueryParameterV1[];
	mutableEvidenceCollections: readonly `collection:${string}`[];
}> {
	const lowered = lowerPostgresMutationPolicyChecks({
		schema: input.schema,
		checks: [{ expression: input.expression, aliases: input.aliases }],
	});
	return Object.freeze({
		...lowered.checks[0]!,
		parameters: lowered.parameters,
	});
}

export function lowerPostgresMutationPolicyChecks(
	input: Readonly<{
		schema: unknown;
		checks: readonly Readonly<{
			expression: PolicyExpressionV1;
			aliases: Readonly<Record<string, string>>;
		}>[];
	}>,
): Readonly<{
	checks: readonly Readonly<{
		sql: string;
		mutableEvidenceCollections: readonly `collection:${string}`[];
	}>[];
	parameters: readonly PostgresQueryParameterV1[];
}> {
	const catalog = buildPostgresCatalog(input.schema);
	const parameters = new PostgresParameters();
	return Object.freeze({
		checks: Object.freeze(
			input.checks.map((check) =>
				Object.freeze({
					sql: policyExpressionSql(check.expression, {
						catalog,
						parameters,
						aliases: new Map(Object.entries(check.aliases)),
					}),
					mutableEvidenceCollections: Object.freeze(
						[...evidenceCollections(check.expression)].sort(),
					),
				}),
			),
		),
		parameters: Object.freeze(parameters.values()),
	});
}
