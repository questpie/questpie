import { canonicalMutationBytes } from "./canonical";
import { decodeMutationFieldCodec } from "./field-codec";
import type {
	FieldPath,
	LinkedPostgresCreateOperationPlanV1,
	OutputAuthorityV1,
	PostgresResultV1,
	RecordValue,
} from "./postgres-program-types";
import type { LinkedCollectionOperationProgramV1 } from "./program";

export function fail(message: string): never {
	throw new TypeError(
		`Invalid PostgreSQL Collection Operation plan: ${message}`,
	);
}

export function record(value: unknown, label: string): RecordValue {
	if (!value || typeof value !== "object" || Array.isArray(value))
		fail(`${label} must be an object`);
	return value as RecordValue;
}

export function exact(
	value: RecordValue,
	keys: readonly string[],
	label: string,
): void {
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	if (
		actual.length !== expected.length ||
		expected.some((key, index) => key !== actual[index])
	)
		fail(
			`${label} has invalid keys (actual ${actual.join(",")}; expected ${expected.join(",")})`,
		);
}

export function array(value: unknown, label: string): readonly unknown[] {
	if (!Array.isArray(value)) fail(`${label} must be an array`);
	return value;
}

export function text(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0 || value.includes("\0"))
		fail(`${label} is invalid`);
	return value;
}

export function path(value: unknown, label: string): FieldPath {
	const result = array(value, label);
	if (
		result.length === 0 ||
		result.some((part) => typeof part !== "string" || part.length === 0)
	)
		fail(`${label} is invalid`);
	return Object.freeze(result as string[]);
}

export function candidateFields(
	value: unknown,
	identity: string,
): LinkedPostgresCreateOperationPlanV1["candidate"]["fields"] {
	const fields = array(value, `${identity} candidate fields`).map(
		(raw, index) => {
			const field = record(raw, `${identity} candidate field ${index}`);
			exact(
				field,
				["path", "column", "codec", "nullable", "requiredInput"],
				`${identity} candidate field ${index}`,
			);
			if (typeof field.nullable !== "boolean")
				fail(`${identity} candidate field ${index} nullable is invalid`);
			if (typeof field.requiredInput !== "boolean")
				fail(`${identity} candidate field ${index} requiredInput is invalid`);
			return Object.freeze({
				path: path(field.path, `${identity} candidate field ${index} path`),
				column: text(
					field.column,
					`${identity} candidate field ${index} column`,
				),
				codec: decodeMutationFieldCodec(
					field.codec,
					`${identity} candidate field ${index} codec`,
				),
				nullable: field.nullable,
				requiredInput: field.requiredInput,
			});
		},
	);
	if (
		new Set(fields.map(({ path: fieldPath }) => JSON.stringify(fieldPath)))
			.size !== fields.length ||
		new Set(fields.map(({ column }) => column)).size !== fields.length
	)
		fail(`${identity} candidate fields and columns must be unique`);
	return Object.freeze(fields);
}

export function same(left: unknown, right: unknown): boolean {
	return (
		Buffer.compare(
			canonicalMutationBytes(left),
			canonicalMutationBytes(right),
		) === 0
	);
}

export function evidence(value: unknown, label: string): readonly string[] {
	const result = array(value, label).map((item, index) => {
		const identity = text(item, `${label} ${index}`);
		if (
			!identity.startsWith("collection:") ||
			identity.length === "collection:".length
		)
			fail(`${label} ${index} is invalid`);
		return identity;
	});
	if (new Set(result).size !== result.length) fail(`${label} must be unique`);
	return Object.freeze(result);
}

function decodeResults(
	value: unknown,
	statement: string,
	expectedPaths: readonly FieldPath[],
	label: string,
	columnPrefix = "qp_result",
): readonly PostgresResultV1[] {
	const decoded = array(value, `${label} result`).map((raw, index) => {
		const source = record(raw, `${label} result ${index}`);
		const hasGuard = Object.hasOwn(source, "guardColumn");
		exact(
			source,
			hasGuard
				? ["path", "column", "codec", "nullable", "guardColumn"]
				: ["path", "column", "codec", "nullable"],
			`${label} result ${index}`,
		);
		if (typeof source.nullable !== "boolean")
			fail(`${label} result ${index} nullable is invalid`);
		const column = text(source.column, `${label} result ${index} column`);
		if (
			column !== `${columnPrefix}_${index}` ||
			!statement.includes(`AS "${column}"`)
		)
			fail(`${label} result ${index} column is not projected by SQL`);
		const guardColumn = hasGuard
			? text(source.guardColumn, `${label} result ${index} guardColumn`)
			: undefined;
		if (
			guardColumn !== undefined &&
			(guardColumn !== `${column}_allowed` ||
				!statement.includes(`AS "${guardColumn}"`))
		)
			fail(`${label} result ${index} guard is not projected by SQL`);
		return Object.freeze({
			path: path(source.path, `${label} result ${index} path`),
			column,
			codec: decodeMutationFieldCodec(
				source.codec,
				`${label} result ${index} codec`,
			),
			nullable: source.nullable,
			...(guardColumn === undefined ? {} : { guardColumn }),
		});
	});
	if (
		decoded.length !== expectedPaths.length ||
		decoded.some((item, index) => !same(item.path, expectedPaths[index])) ||
		new Set(decoded.map(({ column }) => column)).size !== decoded.length
	)
		fail(`${label} result does not match the Collection Operation selection`);
	return Object.freeze(decoded);
}

export function results(
	value: unknown,
	statement: string,
	operation: LinkedCollectionOperationProgramV1,
	label: string,
): readonly PostgresResultV1[] {
	return decodeResults(value, statement, operation.selectedFieldPaths, label);
}

export function candidateResults(
	value: unknown,
	statement: string,
	fields: LinkedPostgresCreateOperationPlanV1["candidate"]["fields"],
	label: string,
	columnPrefix = "qp_result",
): readonly PostgresResultV1[] {
	const decoded = decodeResults(
		value,
		statement,
		fields.map(({ path: fieldPath }) => fieldPath),
		label,
		columnPrefix,
	);
	if (decoded.some(({ guardColumn }) => guardColumn !== undefined))
		fail(`${label} candidate result must not be conditionally disclosed`);
	if (
		decoded.some(
			(item, index) =>
				item.nullable !== fields[index]?.nullable ||
				!same(item.codec, fields[index]?.codec),
		)
	)
		fail(`${label} candidate result does not match its Field codecs`);
	return decoded;
}

export function outputAuthority(
	value: unknown,
	result: readonly PostgresResultV1[],
	label: string,
): OutputAuthorityV1 {
	const source = record(value, label);
	exact(source, ["freshAfterRowLockWait", "selectedPaths"], label);
	if (source.freshAfterRowLockWait !== true) fail(`${label} is not fresh`);
	const selectedPaths = array(
		source.selectedPaths,
		`${label} selectedPaths`,
	).map((raw, index) => {
		const item = record(raw, `${label} selectedPath ${index}`);
		const conditional = item.conditional;
		exact(
			item,
			conditional === true
				? ["path", "conditional", "guardColumn", "mutableEvidenceCollections"]
				: ["path", "conditional", "mutableEvidenceCollections"],
			`${label} selectedPath ${index}`,
		);
		if (typeof conditional !== "boolean")
			fail(`${label} selectedPath ${index} conditional is invalid`);
		const guardColumn = conditional
			? text(item.guardColumn, `${label} selectedPath ${index} guardColumn`)
			: undefined;
		return Object.freeze({
			path: path(item.path, `${label} selectedPath ${index} path`),
			conditional,
			...(guardColumn === undefined ? {} : { guardColumn }),
			mutableEvidenceCollections: evidence(
				item.mutableEvidenceCollections,
				`${label} selectedPath ${index} evidence`,
			),
		});
	});
	if (
		selectedPaths.length !== result.length ||
		selectedPaths.some(
			(item, index) =>
				!same(item.path, result[index]?.path) ||
				item.guardColumn !== result[index]?.guardColumn,
		)
	)
		fail(`${label} does not match result guards`);
	return Object.freeze({
		freshAfterRowLockWait: true,
		selectedPaths: Object.freeze(selectedPaths),
	});
}

export function header(
	plan: RecordValue,
	operation: LinkedCollectionOperationProgramV1,
	member: "create" | "get" | "update",
): void {
	if (
		plan.identity !== operation.identity ||
		plan.target !== operation.target ||
		plan.member !== member ||
		plan.policy !== operation.policy ||
		plan.outputCardinality !== operation.outputCardinality
	)
		fail(`${operation.identity} does not match its Collection Operation`);
}
