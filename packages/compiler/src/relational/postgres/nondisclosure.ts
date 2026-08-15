import type { DataQueryTemplateV1, PolicyProgramV1 } from "../types";
import {
	fieldValueSql,
	postgresType,
	qualifiedTable,
	quoteIdentifier,
	requiredField,
	type PostgresCatalog,
	type PostgresCollection,
} from "./model";
import {
	PostgresParameters,
	type PostgresQueryParameterV1,
} from "./parameters";
import { policyExpressionSql } from "./policy";

export type PostgresKeyedLookupParameterV1 =
	| PostgresQueryParameterV1
	| Readonly<{
			position: number;
			kind: "key";
			postgresType: string;
	  }>;

export interface PostgresKeyedLookupProofV1 {
	readonly sql: string;
	readonly parameters: readonly PostgresKeyedLookupParameterV1[];
	readonly keyField: string;
	readonly outcomeColumn: "qp_key_outcome";
}

export function lowerPostgresKeyedLookupProof(
	input: Readonly<{
		catalog: PostgresCatalog;
		collection: PostgresCollection;
		policy: PolicyProgramV1;
		template: DataQueryTemplateV1;
	}>,
): PostgresKeyedLookupProofV1 {
	const read = input.policy.operations.read;
	if (!read) throw new TypeError(`Policy ${input.policy.identity} denies read`);
	const keyIdentity = input.template.order.at(-1)?.field;
	if (!keyIdentity)
		throw new TypeError("keyed nondisclosure proof requires a total order key");
	const keyField = requiredField(input.catalog, keyIdentity);
	const parameters = new PostgresParameters();
	const authorizedAlias = "qp_row";
	const policySql = policyExpressionSql(read.rows, {
		catalog: input.catalog,
		parameters,
		aliases: new Map([["row", authorizedAlias]]),
	});
	const policyParameters = parameters.values();
	const keyPosition = policyParameters.length + 1;
	const keyParameter = `$${keyPosition}::${postgresType(keyField.codec)}`;
	const keyColumn = fieldValueSql(keyField, "qp_key_row");
	return Object.freeze({
		sql: `WITH "qp_authorized" AS MATERIALIZED (SELECT ${quoteIdentifier(authorizedAlias)}.* FROM ${qualifiedTable(input.catalog, input.collection)} AS ${quoteIdentifier(authorizedAlias)} WHERE ${policySql}) SELECT CASE WHEN EXISTS (SELECT 1 FROM "qp_authorized" AS "qp_key_row" WHERE ${keyColumn} IS NOT DISTINCT FROM ${keyParameter}) THEN 'found' ELSE 'notFound' END AS "qp_key_outcome";\n`,
		parameters: Object.freeze([
			...policyParameters,
			Object.freeze({
				position: keyPosition,
				kind: "key" as const,
				postgresType: postgresType(keyField.codec),
			}),
		]),
		keyField: keyField.identity,
		outcomeColumn: "qp_key_outcome",
	});
}
