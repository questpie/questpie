import { compareAscii } from "../canonical";
import { CompilerDiagnosticError } from "../diagnostic";

type RecordValue = Readonly<Record<string, unknown>>;

function invalid(label: string, requirement: string): never {
	throw new CompilerDiagnosticError(
		"QP-SCHEMA-001",
		"invalidDefinition",
		`${label} ${requirement}`,
	);
}

function record(value: unknown, label: string): RecordValue {
	if (!value || typeof value !== "object" || Array.isArray(value))
		invalid(label, "must be an object");
	return value as RecordValue;
}

function string(value: unknown, label: string): string {
	if (typeof value !== "string") invalid(label, "must be a string");
	return value;
}

function entries(value: unknown): [string, RecordValue][] {
	return Object.entries(record(value, "member map"))
		.map(([key, item]) => [key, record(item, key)] as [string, RecordValue])
		.sort(([left], [right]) => compareAscii(left, right));
}

function exactKeys(
	value: RecordValue,
	allowed: readonly string[],
	label: string,
): void {
	const unexpected = Object.keys(value)
		.filter((key) => !allowed.includes(key))
		.sort(compareAscii);
	if (unexpected.length > 0)
		invalid(label, `has unsupported member ${unexpected[0]}`);
}

function boolean(value: unknown, label: string): boolean {
	if (typeof value !== "boolean") invalid(label, "must be a boolean");
	return value;
}

function memberKey(value: string, label: string): void {
	if (!/^[a-z][A-Za-z0-9]{0,62}$/.test(value))
		invalid(label, "must use the 1-to-63 lower-camel ASCII member grammar");
}

function boundedInteger(
	value: unknown,
	label: string,
	minimum: number,
	maximum: number,
): number | null {
	if (value === null || value === undefined) return null;
	if (
		typeof value !== "number" ||
		!Number.isSafeInteger(value) ||
		value < minimum ||
		value > maximum
	)
		invalid(label, `must be an integer from ${minimum} through ${maximum}`);
	return value;
}

function textType(options: RecordValue, label: string): RecordValue {
	exactKeys(options, ["maxLength", "minLength"], `${label}.options`);
	const minLength = boundedInteger(
		options.minLength,
		`${label}.minLength`,
		0,
		Number.MAX_SAFE_INTEGER,
	);
	const maxLength = boundedInteger(
		options.maxLength,
		`${label}.maxLength`,
		0,
		Number.MAX_SAFE_INTEGER,
	);
	if (minLength !== null && maxLength !== null && minLength > maxLength)
		invalid(label, "requires minLength less than or equal to maxLength");
	return {
		kind: "text",
		minLength,
		maxLength,
		collation: "questpie.binary",
	};
}

function integerType(options: RecordValue, label: string): RecordValue {
	exactKeys(options, ["maximum", "minimum"], `${label}.options`);
	const minimum = boundedInteger(
		options.minimum,
		`${label}.minimum`,
		-2_147_483_648,
		2_147_483_647,
	);
	const maximum = boundedInteger(
		options.maximum,
		`${label}.maximum`,
		-2_147_483_648,
		2_147_483_647,
	);
	if (minimum !== null && maximum !== null && minimum > maximum)
		invalid(label, "requires minimum less than or equal to maximum");
	return { kind: "integer", minimum, maximum };
}

function canonicalBigint(value: unknown, label: string): string | null {
	if (value === null || value === undefined) return null;
	if (
		typeof value !== "string" ||
		!/^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$/.test(value)
	)
		invalid(label, "must be canonical bigint text");
	const parsed = BigInt(value);
	if (
		parsed < -9_223_372_036_854_775_808n ||
		parsed > 9_223_372_036_854_775_807n
	)
		invalid(label, "must be within PostgreSQL int8");
	return value;
}

function bigintType(options: RecordValue, label: string): RecordValue {
	exactKeys(options, ["maximum", "minimum"], `${label}.options`);
	const minimum = canonicalBigint(options.minimum, `${label}.minimum`);
	const maximum = canonicalBigint(options.maximum, `${label}.maximum`);
	if (minimum !== null && maximum !== null && BigInt(minimum) > BigInt(maximum))
		invalid(label, "requires minimum less than or equal to maximum");
	return { kind: "bigint", minimum, maximum };
}

function numericType(options: RecordValue, label: string): RecordValue {
	exactKeys(options, ["precision", "scale"], `${label}.options`);
	const precision = boundedInteger(
		options.precision,
		`${label}.precision`,
		1,
		1_000,
	);
	if (precision === null) invalid(`${label}.precision`, "is required");
	const scale = boundedInteger(options.scale, `${label}.scale`, 0, precision);
	if (scale === null) invalid(`${label}.scale`, "is required");
	return { kind: "numeric", precision, scale };
}

function embeddedValueContract(
	value: RecordValue,
	depth = 0,
	ancestors: ReadonlySet<object> = new Set(),
): RecordValue {
	if (ancestors.has(value)) invalid("embedded value", "cannot be cyclic");
	const nextAncestors = new Set(ancestors).add(value);
	exactKeys(value, ["kind", "nullable", "options"], "embedded value");
	const kind = string(value.kind, "embedded value kind");
	const options = record(value.options ?? {}, `${kind} embedded value options`);
	const base = { kind, nullable: boolean(value.nullable, `${kind}.nullable`) };
	if (kind === "text") return { ...textType(options, "value.text"), ...base };
	if (kind === "integer")
		return { ...integerType(options, "value.integer"), ...base };
	if (kind === "bigint")
		return { ...bigintType(options, "value.bigint"), ...base };
	if (kind === "numeric")
		return { ...numericType(options, "value.numeric"), ...base };
	if (kind === "timestamp") {
		exactKeys(options, ["withTimezone"], "value.timestamp.options");
		return {
			...base,
			withTimezone: boolean(
				options.withTimezone,
				"value.timestamp.withTimezone",
			),
		};
	}
	if (kind === "object") {
		exactKeys(options, ["properties"], "value.object.options");
		if (depth >= 8)
			invalid("value.object", "exceeds the container depth limit");
		return {
			...base,
			properties: entries(options.properties).map(([key, child]) => {
				memberKey(key, "embedded property");
				return {
					key,
					codec: embeddedValueContract(child, depth + 1, nextAncestors),
				};
			}),
		};
	}
	if (kind === "array") {
		exactKeys(options, ["items", "maximumItems"], "value.array.options");
		if (depth >= 8) invalid("value.array", "exceeds the container depth limit");
		const maximumItems = boundedInteger(
			options.maximumItems,
			"value.array.maximumItems",
			1,
			1_000,
		);
		if (maximumItems === null)
			invalid("value.array.maximumItems", "is required");
		return {
			...base,
			maximumItems,
			items: embeddedValueContract(
				record(options.items, "array items"),
				depth + 1,
				nextAncestors,
			),
		};
	}
	if (["uuid", "boolean", "date"].includes(kind)) {
		exactKeys(options, [], `value.${kind}.options`);
		return base;
	}
	invalid("embedded value", `has unsupported kind ${kind}`);
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
	for (const segment of path) memberKey(segment, "Field path segment");
	exactKeys(
		value,
		["default", "kind", "nullable", "options", "postgresName", "scalar"],
		`field.${key}`,
	);
	if (value.kind !== "field") invalid(`field.${key}.kind`, "must be field");
	const scalar = string(value.scalar, `${key}.scalar`);
	const options = record(value.options ?? {}, `${key}.options`);
	let type: RecordValue;
	if (scalar === "text") type = textType(options, `field.${key}`);
	else if (scalar === "timestamp") {
		exactKeys(options, ["withTimezone"], `field.${key}.options`);
		type = {
			kind: "timestamp",
			withTimezone:
				options.withTimezone === undefined
					? false
					: boolean(options.withTimezone, `field.${key}.withTimezone`),
		};
	} else if (scalar === "integer") type = integerType(options, `field.${key}`);
	else if (scalar === "bigint") type = bigintType(options, `field.${key}`);
	else if (scalar === "numeric") type = numericType(options, `field.${key}`);
	else if (scalar === "object") {
		exactKeys(options, ["properties"], `field.${key}.options`);
		type = {
			kind: "object",
			properties: entries(options.properties).map(([propertyKey, child]) => {
				memberKey(propertyKey, "embedded property");
				return {
					key: propertyKey,
					codec: embeddedValueContract(child),
				};
			}),
		};
	} else if (scalar === "array") {
		exactKeys(options, ["items", "maximumItems"], `field.${key}.options`);
		const maximumItems = boundedInteger(
			options.maximumItems,
			`field.${key}.maximumItems`,
			1,
			1_000,
		);
		if (maximumItems === null)
			invalid(`field.${key}.maximumItems`, "is required");
		type = {
			kind: "array",
			maximumItems,
			items: embeddedValueContract(record(options.items, `${key}.items`)),
		};
	} else if (["uuid", "boolean", "date", "json"].includes(scalar)) {
		exactKeys(options, [], `field.${key}.options`);
		type = { kind: scalar };
	} else invalid(`field.${key}`, `has unsupported scalar ${scalar}`);
	const rawDefault = value.default;
	let normalizedDefault: RecordValue | null = null;
	if (rawDefault !== null && rawDefault !== undefined) {
		if (scalar === "uuid" && rawDefault === "randomUuid")
			normalizedDefault = { kind: "randomUuid" };
		else if (scalar === "timestamp" && rawDefault === "now")
			normalizedDefault = { kind: "now" };
		else if (scalar === "text" && typeof rawDefault === "string") {
			if (rawDefault.normalize("NFC") !== rawDefault)
				invalid(`field.${key}.default`, "must be NFC text");
			const length = [...rawDefault].length;
			if (
				(typeof type.minLength === "number" && length < type.minLength) ||
				(typeof type.maxLength === "number" && length > type.maxLength)
			)
				invalid(`field.${key}.default`, "violates its text bounds");
			normalizedDefault = { kind: "literal", value: rawDefault };
		} else if (scalar === "boolean" && typeof rawDefault === "boolean")
			normalizedDefault = { kind: "literal", value: rawDefault };
		else if (scalar === "integer" && typeof rawDefault === "number") {
			boundedInteger(
				rawDefault,
				`field.${key}.default`,
				-2_147_483_648,
				2_147_483_647,
			);
			if (
				(typeof type.minimum === "number" && rawDefault < type.minimum) ||
				(typeof type.maximum === "number" && rawDefault > type.maximum)
			)
				invalid(`field.${key}.default`, "violates its integer bounds");
			normalizedDefault = { kind: "literal", value: rawDefault };
		} else invalid(`field.${key}`, "does not accept that default");
	}
	return {
		path,
		type,
		nullable: boolean(value.nullable, `field.${key}.nullable`),
		default: normalizedDefault,
		postgresName:
			value.postgresName === null
				? null
				: string(value.postgresName, `field.${key}.postgresName`),
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
