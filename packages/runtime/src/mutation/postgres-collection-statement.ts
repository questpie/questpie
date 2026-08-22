import { runtimeArtifactDigest } from "../application/artifact-protocol";
import {
	definePostgresStatement,
	type PostgresParameter,
} from "../postgres/contract";
import {
	decodeRelationalScalar,
	decodeRelationalScalarCodec,
} from "../relational/scalar";
import {
	decodePostgresExecutionFact,
	decodePostgresLiteralCodec,
	postgresTypeForScalarCodec,
} from "./postgres-program-codec";
import type {
	PostgresCollectionStatement,
	PostgresParameterV1,
	PostgresResultV1,
	RecordValue,
} from "./postgres-program-types";

function fail(message: string): never {
	throw new TypeError(
		`Invalid PostgreSQL Collection Operation plan: ${message}`,
	);
}

function record(value: unknown, label: string): RecordValue {
	if (!value || typeof value !== "object" || Array.isArray(value))
		fail(`${label} must be an object`);
	return value as RecordValue;
}

function exact(
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
		fail(`${label} has invalid keys`);
}

function array(value: unknown, label: string): readonly unknown[] {
	if (!Array.isArray(value)) fail(`${label} must be an array`);
	return value;
}

function text(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0 || value.includes("\0"))
		fail(`${label} is invalid`);
	return value;
}

function path(value: unknown, label: string): readonly string[] {
	const result = array(value, label);
	if (
		result.length === 0 ||
		result.some((part) => typeof part !== "string" || part.length === 0)
	)
		fail(`${label} is invalid`);
	return Object.freeze(result as string[]);
}

function scanPlaceholders(
	statement: string,
	parameters: readonly PostgresParameterV1[],
	label: string,
): ReadonlySet<number> {
	const referenced = new Set<number>();
	let index = 0;
	while (index < statement.length) {
		const character = statement[index]!;
		if (character === "'" || character === '"') {
			const quote = character;
			const escaped =
				quote === "'" &&
				((/[Ee]/.test(statement[index - 1] ?? "") &&
					!/[A-Za-z0-9_$]/.test(statement[index - 2] ?? "")) ||
					statement.slice(Math.max(0, index - 2), index).toUpperCase() ===
						"U&");
			index += 1;
			let closed = false;
			while (index < statement.length) {
				if (escaped && statement[index] === "\\") {
					index += 2;
					continue;
				}
				if (statement[index] !== quote) {
					index += 1;
					continue;
				}
				if (statement[index + 1] === quote) {
					index += 2;
					continue;
				}
				index += 1;
				closed = true;
				break;
			}
			if (!closed) fail(`${label} SQL quoted value is invalid`);
			continue;
		}
		if (statement.startsWith("--", index)) {
			const newline = statement.indexOf("\n", index + 2);
			index = newline < 0 ? statement.length : newline + 1;
			continue;
		}
		if (statement.startsWith("/*", index)) {
			let depth = 1;
			index += 2;
			while (index < statement.length && depth > 0) {
				if (statement.startsWith("/*", index)) {
					depth += 1;
					index += 2;
				} else if (statement.startsWith("*/", index)) {
					depth -= 1;
					index += 2;
				} else {
					index += 1;
				}
			}
			if (depth !== 0) fail(`${label} SQL comment is invalid`);
			continue;
		}
		if (character !== "$") {
			index += 1;
			continue;
		}
		const tail = statement.slice(index);
		const dollarQuote = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(tail)?.[0];
		if (dollarQuote) {
			const closing = statement.indexOf(
				dollarQuote,
				index + dollarQuote.length,
			);
			if (closing < 0) fail(`${label} SQL dollar quote is invalid`);
			index = closing + dollarQuote.length;
			continue;
		}
		const placeholder = /^\$(\d+)/.exec(tail);
		if (!placeholder) {
			index += 1;
			continue;
		}
		const digits = placeholder[1]!;
		const position = Number(digits);
		if (
			String(position) !== digits ||
			position < 1 ||
			position > parameters.length
		)
			fail(`${label} SQL placeholder is invalid`);
		const parameter = parameters[position - 1]!;
		const cast = `::${parameter.postgresType}`;
		const castStart = index + placeholder[0].length;
		if (!statement.startsWith(cast, castStart))
			fail(`${label} SQL placeholder cast is invalid`);
		const boundary = statement[castStart + cast.length];
		if (boundary !== undefined && /[A-Za-z0-9_$[\].]/.test(boundary))
			fail(`${label} SQL placeholder cast is invalid`);
		referenced.add(position);
		index = castStart + cast.length;
	}
	return referenced;
}

export function decodePostgresCollectionParameters(
	value: unknown,
	statement: string,
	label: string,
): readonly PostgresParameterV1[] {
	const decoded = array(value, `${label} parameters`).map((raw, index) => {
		const source = record(raw, `${label} parameter ${index}`);
		const position = index + 1;
		if (source.position !== position)
			fail(`${label} parameter positions must be contiguous and ordered`);
		const postgresType = text(
			source.postgresType,
			`${label} parameter postgresType`,
		);
		if (source.kind === "callerInput" || source.kind === "key") {
			exact(
				source,
				["position", "postgresType", "kind", "path", "codec"],
				`${label} parameter ${index}`,
			);
			const decodedCodec = decodeRelationalScalarCodec(
				source.codec,
				`${label} parameter ${index} codec`,
			);
			if (postgresType !== postgresTypeForScalarCodec(decodedCodec))
				fail(
					`${label} parameter ${position} PostgreSQL type disagrees with its codec`,
				);
			return Object.freeze({
				position,
				postgresType,
				kind: source.kind,
				path: path(source.path, `${label} parameter ${index} path`),
				codec: decodedCodec,
			});
		}
		if (source.kind === "executionFact") {
			exact(
				source,
				["position", "postgresType", "kind", "source", "path", "codec"],
				`${label} parameter ${index}`,
			);
			const factSource = text(
				source.source,
				`${label} parameter ${index} source`,
			);
			if (
				!new Set(["authority", "operationTime", "principal", "tenant"]).has(
					factSource,
				)
			)
				fail(`${label} parameter ${index} execution source is invalid`);
			const factPath = array(source.path, `${label} parameter ${index} path`);
			if (
				factPath.some((part) => typeof part !== "string" || part.length === 0)
			)
				fail(`${label} parameter ${index} path is invalid`);
			const codec = decodePostgresExecutionFact(
				factSource,
				factPath as readonly string[],
				source.codec,
				postgresType,
				`${label} parameter ${index}`,
			);
			return Object.freeze({
				position,
				postgresType,
				kind: "executionFact" as const,
				source: factSource,
				path: Object.freeze(factPath as string[]),
				codec,
			});
		}
		if (source.kind === "literal") {
			exact(
				source,
				["position", "postgresType", "kind", "value", "codec"],
				`${label} parameter ${index}`,
			);
			if (
				source.value !== null &&
				!["boolean", "number", "string"].includes(typeof source.value)
			)
				fail(`${label} parameter ${index} literal is invalid`);
			if (
				typeof source.value === "number" &&
				(!Number.isFinite(source.value) || Object.is(source.value, -0))
			)
				fail(`${label} parameter ${index} literal is invalid`);
			const literalValue = source.value as null | boolean | number | string;
			return Object.freeze({
				position,
				postgresType,
				kind: "literal" as const,
				value: literalValue,
				codec: decodePostgresLiteralCodec(
					source.codec,
					postgresType,
					literalValue,
					`${label} parameter ${index}`,
				),
			});
		}
		fail(`${label} parameter ${index} kind is invalid`);
	});
	const referenced = scanPlaceholders(statement, decoded, label);
	if (
		referenced.size !== decoded.length ||
		decoded.some((parameter) => !referenced.has(parameter.position))
	)
		fail(`${label} SQL placeholders do not match its parameters`);
	return Object.freeze(decoded);
}

export function bindPostgresCollectionStatement(
	input: Readonly<{
		identity: string;
		leaf: string;
		text: string;
		parameterCount: number;
		result?: readonly PostgresResultV1[];
		booleanResult?: true;
	}>,
): PostgresCollectionStatement {
	const result = input.result ?? [];
	const statementName = `mutation.collection.${runtimeArtifactDigest(
		"questpie-postgres-collection-statement-name-v1",
		Object.freeze({
			identity: input.identity,
			leaf: input.leaf,
			text: input.text,
		}),
	).slice(0, 48)}`;
	return definePostgresStatement({
		name: statementName,
		text: input.text,
		parameterCount: input.parameterCount,
		parameters(value: readonly PostgresParameter[]) {
			if (!Array.isArray(value) || value.length !== input.parameterCount)
				fail(`${input.identity} ${input.leaf} parameters are invalid`);
			return Object.freeze([...value]);
		},
		decode(output) {
			if (
				output.command !== "SELECT" ||
				output.rowCount === null ||
				output.rowCount !== output.rows.length ||
				output.rows.length > 1
			)
				fail(`${input.identity} ${input.leaf} result shape is invalid`);
			return Object.freeze(
				output.rows.map((row) => {
					if (input.booleanResult) {
						if (row.length !== 1 || row[0] !== true)
							fail(`${input.identity} ${input.leaf} boolean result is invalid`);
						return Object.freeze({});
					}
					const expectedWidth = result.reduce(
						(width, item) => width + (item.guardColumn === undefined ? 1 : 2),
						0,
					);
					if (row.length !== expectedWidth)
						fail(`${input.identity} ${input.leaf} result width is invalid`);
					const entries: [string, unknown][] = [];
					let index = 0;
					for (const item of result) {
						const rawValue = row[index++];
						let allowed = true;
						if (item.guardColumn !== undefined) {
							const rawGuard = row[index++];
							if (typeof rawGuard !== "boolean")
								fail(`${input.identity} ${input.leaf} guard is invalid`);
							allowed = rawGuard;
							entries.push([item.guardColumn, rawGuard]);
							if (!allowed && rawValue !== null)
								fail(
									`${input.identity} ${input.leaf} hidden result is invalid`,
								);
						}
						if (rawValue === null) {
							if (allowed && !item.nullable)
								fail(`${input.identity} ${input.leaf} null result is invalid`);
							entries.push([item.column, null]);
							continue;
						}
						entries.push([
							item.column,
							decodeRelationalScalar(rawValue, item.codec, "date"),
						]);
					}
					return Object.freeze(Object.fromEntries(entries));
				}),
			);
		},
	});
}
