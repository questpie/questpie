import { compareAscii } from "../canonical";
import { CompilerDiagnosticError } from "../diagnostic";

type RecordValue = Readonly<Record<string, unknown>>;

function record(value: unknown, label: string): RecordValue {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new CompilerDiagnosticError(
			"QP-COMPOSE-015",
			"invalidAugmentation",
			`${label} must be an object`,
		);
	return value as RecordValue;
}

function string(value: unknown, label: string): string {
	if (typeof value !== "string")
		throw new CompilerDiagnosticError(
			"QP-COMPOSE-015",
			"invalidAugmentation",
			`${label} must be a string`,
		);
	return value;
}

function entries(value: unknown): [string, RecordValue][] {
	return Object.entries(record(value, "member map"))
		.map(([key, item]) => [key, record(item, key)] as [string, RecordValue])
		.sort(([left], [right]) => compareAscii(left, right));
}

function embeddedValueContract(value: RecordValue): RecordValue {
	const kind = string(value.kind, "embedded value kind");
	const options = record(value.options ?? {}, `${kind} embedded value options`);
	const base = { kind, nullable: value.nullable === true };
	if (kind === "text")
		return {
			...base,
			minLength: options.minLength ?? null,
			maxLength: options.maxLength ?? null,
			collation: "questpie.binary",
		};
	if (kind === "integer" || kind === "bigint")
		return {
			...base,
			minimum: options.minimum ?? null,
			maximum: options.maximum ?? null,
		};
	if (kind === "numeric")
		return {
			...base,
			precision: options.precision,
			scale: options.scale,
		};
	if (kind === "timestamp")
		return { ...base, withTimezone: options.withTimezone === true };
	if (kind === "object")
		return {
			...base,
			properties: entries(options.properties).map(([key, child]) => ({
				key,
				codec: embeddedValueContract(child),
			})),
		};
	if (kind === "array")
		return {
			...base,
			maximumItems: options.maximumItems,
			items: embeddedValueContract(record(options.items, "array items")),
		};
	return base;
}

export function fieldContract(
	path: readonly string[],
	value: RecordValue,
): RecordValue {
	const key = path.at(-1);
	if (!key)
		throw new CompilerDiagnosticError(
			"QP-SCHEMA-001",
			"invalidDefinition",
			"a Field path cannot be empty",
		);
	const scalar = string(value.scalar, `${key}.scalar`);
	const options = record(value.options ?? {}, `${key}.options`);
	let type: RecordValue;
	if (scalar === "text")
		type = {
			kind: "text",
			minLength: options.minLength ?? null,
			maxLength: options.maxLength ?? null,
			collation: "questpie.binary",
		};
	else if (scalar === "timestamp")
		type = { kind: "timestamp", withTimezone: options.withTimezone ?? false };
	else if (scalar === "integer" || scalar === "bigint")
		type = {
			kind: scalar,
			minimum: options.minimum ?? null,
			maximum: options.maximum ?? null,
		};
	else if (scalar === "numeric")
		type = {
			kind: "numeric",
			precision: options.precision,
			scale: options.scale,
		};
	else if (scalar === "object")
		type = {
			kind: "object",
			properties: entries(options.properties).map(([propertyKey, child]) => ({
				key: propertyKey,
				codec: embeddedValueContract(child),
			})),
		};
	else if (scalar === "array")
		type = {
			kind: "array",
			maximumItems: options.maximumItems,
			items: embeddedValueContract(record(options.items, `${key}.items`)),
		};
	else type = { kind: scalar };
	const rawDefault = value.default;
	const normalizedDefault =
		(scalar === "timestamp" && rawDefault === "now") ||
		(scalar === "uuid" && rawDefault === "randomUuid")
			? { kind: rawDefault }
			: typeof rawDefault === "string" ||
				  typeof rawDefault === "boolean" ||
				  typeof rawDefault === "number"
				? { kind: "literal", value: rawDefault }
				: null;
	return {
		path,
		type,
		nullable: value.nullable === true,
		default: normalizedDefault,
		postgresName:
			typeof value.postgresName === "string" ? value.postgresName : null,
	};
}

export function flattenFieldContracts(
	fields: unknown,
	prefix: readonly string[] = [],
): ReadonlyArray<Readonly<{ path: readonly string[]; contract: RecordValue }>> {
	return entries(fields).flatMap(([key, value]) => {
		const path = [...prefix, key];
		if (value.kind !== "inlineShape")
			return [{ path, contract: fieldContract(path, value) }];
		if (path.length > 8)
			throw new CompilerDiagnosticError(
				"QP-SCHEMA-001",
				"invalidDefinition",
				`${path.join("/")} exceeds the inline shape depth limit`,
			);
		const children = record(value.fields, `${path.join("/")}.fields`);
		if (Object.keys(children).length === 0)
			throw new CompilerDiagnosticError(
				"QP-SCHEMA-001",
				"invalidDefinition",
				`${path.join("/")} inline shape cannot be empty`,
			);
		return flattenFieldContracts(children, path);
	});
}
