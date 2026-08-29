import { fail } from "./postgres-program-decode";
import type { FieldPath, PostgresParameterV1 } from "./postgres-program-types";

type CandidateField = Readonly<{
	path: FieldPath;
	column: string;
}>;

function quote(value: string): string {
	return `"${value.replaceAll('"', '""')}"`;
}

function samePath(left: FieldPath, right: FieldPath): boolean {
	return (
		left.length === right.length &&
		left.every((segment, index) => segment === right[index])
	);
}

function parameterSql(parameter: PostgresParameterV1): string {
	return `$${parameter.position}::${parameter.postgresType}`;
}

function orderedParameters(
	parameters: readonly PostgresParameterV1[],
	kind: "candidateValue" | "key",
	paths: readonly FieldPath[],
	label: string,
): readonly PostgresParameterV1[] {
	const selected = parameters.filter((parameter) => parameter.kind === kind);
	if (
		selected.length !== paths.length ||
		selected.some((parameter, index) =>
			"path" in parameter ? !samePath(parameter.path, paths[index]!) : true,
		)
	)
		fail(`${label} parameters are invalid`);
	return selected;
}

function candidateColumns(
	parameters: readonly PostgresParameterV1[],
	fields: readonly CandidateField[],
	label: string,
): string {
	const values = orderedParameters(
		parameters,
		"candidateValue",
		fields.map(({ path }) => path),
		label,
	);
	return values
		.map(
			(parameter, index) =>
				`${parameterSql(parameter)} AS ${quote(fields[index]!.column)}`,
		)
		.join(", ");
}

export function validateCreateCandidatePolicySql(input: {
	sql: string;
	policySql: string;
	parameters: readonly PostgresParameterV1[];
	fields: readonly CandidateField[];
	label: string;
}): void {
	const expected = `WITH ${quote("qp_candidate")} AS (SELECT ${candidateColumns(input.parameters, input.fields, input.label)}) SELECT TRUE FROM ${quote("qp_candidate")} WHERE ${input.policySql} LIMIT 1`;
	if (input.sql !== expected) fail(`${input.label} omits Policy`);
}

export function validateUpdateCandidatePolicySql(input: {
	sql: string;
	policySql: string;
	parameters: readonly PostgresParameterV1[];
	fields: readonly CandidateField[];
	keyFields: readonly FieldPath[];
	lockSql: string;
	label: string;
}): void {
	const table = input.lockSql.match(
		/^SELECT TRUE AS "qp_locked" FROM ((?:"(?:[^"]|"")+"\.)?"(?:[^"]|"")+") AS "qp_lock_row" WHERE /,
	)?.[1];
	if (!table) fail(`${input.label} table binding is invalid`);
	const keys = orderedParameters(
		input.parameters,
		"key",
		input.keyFields,
		input.label,
	);
	const keyPredicates = keys.map((parameter, index) => {
		const field = input.fields.find(({ path }) =>
			samePath(path, input.keyFields[index]!),
		);
		if (!field) fail(`${input.label} key Field is invalid`);
		return `${quote("qp_current")}.${quote(field.column)} IS NOT DISTINCT FROM ${parameterSql(parameter)}`;
	});
	const expected = `WITH ${quote("qp_current")} AS (SELECT * FROM ${table} AS ${quote("qp_current")} WHERE ${keyPredicates.join(" AND ")} LIMIT 1), ${quote("qp_candidate")} AS (SELECT ${candidateColumns(input.parameters, input.fields, input.label)}) SELECT TRUE FROM ${quote("qp_current")} CROSS JOIN ${quote("qp_candidate")} WHERE ${input.policySql} LIMIT 1`;
	if (input.sql !== expected) fail(`${input.label} omits Policy`);
}
