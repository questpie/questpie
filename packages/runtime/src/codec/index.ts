export type RuntimeCodec =
	| Readonly<{ kind: "boolean" | "integer" | "text" | "timestamp" | "uuid" }>
	| Readonly<{ kind: "array"; items: RuntimeCodec }>
	| Readonly<{ kind: "nullable"; codec: RuntimeCodec }>
	| Readonly<{ kind: "optional"; codec: RuntimeCodec }>
	| Readonly<{
			kind: "object";
			properties: Readonly<Record<string, RuntimeCodec>>;
	  }>;

export class RuntimeCodecError extends TypeError {
	constructor(
		readonly path: string,
		readonly requirement: string,
	) {
		super(`${path} ${requirement}`);
		this.name = "RuntimeCodecError";
	}
}

function invalid(path: string, requirement: string): never {
	throw new RuntimeCodecError(path, requirement);
}

function record(
	value: unknown,
	path: string,
): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		invalid(path, "must be an object");
	return value as Readonly<Record<string, unknown>>;
}

function timestamp(value: unknown, path: string): Date {
	if (value instanceof Date) {
		if (!Number.isFinite(value.getTime()))
			invalid(path, "must be a valid timestamp");
		return value;
	}
	if (
		typeof value !== "string" ||
		!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/.test(
			value,
		)
	)
		invalid(path, "must be a canonical UTC timestamp");
	const parsed = new Date(value);
	if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value)
		invalid(path, "must be a canonical UTC timestamp");
	return parsed;
}

function transform(
	codec: RuntimeCodec,
	value: unknown,
	path: string,
	direction: "runtime" | "wire",
): unknown {
	if (codec.kind === "nullable")
		return value === null
			? null
			: transform(codec.codec, value, path, direction);
	if (codec.kind === "optional")
		invalid(path, "uses optional outside an object property");
	if (codec.kind === "boolean") {
		if (typeof value !== "boolean") invalid(path, "must be a boolean");
		return value;
	}
	if (codec.kind === "integer") {
		if (
			typeof value !== "number" ||
			!Number.isSafeInteger(value) ||
			Object.is(value, -0)
		)
			invalid(path, "must be a safe integer");
		return value;
	}
	if (codec.kind === "text") {
		if (typeof value !== "string") invalid(path, "must be text");
		if (value !== value.normalize("NFC")) invalid(path, "must be NFC text");
		return value;
	}
	if (codec.kind === "uuid") {
		if (
			typeof value !== "string" ||
			!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
				value,
			)
		)
			invalid(path, "must be a canonical UUID");
		return value;
	}
	if (codec.kind === "timestamp") {
		if (direction === "runtime") return timestamp(value, path);
		if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
			invalid(path, "must be a valid timestamp");
		return value.toISOString();
	}
	if (codec.kind === "array") {
		if (!Array.isArray(value)) invalid(path, "must be an array");
		return Object.freeze(
			value.map((item, index) =>
				transform(codec.items, item, `${path}[${index}]`, direction),
			),
		);
	}
	if (codec.kind !== "object") invalid(path, "uses an unsupported codec");
	const input = record(value, path);
	const properties = codec.properties;
	const expected = Object.keys(properties).sort();
	const required = expected.filter(
		(key) => properties[key]?.kind !== "optional",
	);
	const actual = Object.keys(input).sort();
	if (
		actual.some((key) => !Object.hasOwn(properties, key)) ||
		required.some((key) => !Object.hasOwn(input, key))
	)
		invalid(path, "must have exactly the compiled keys");
	const output: Record<string, unknown> = Object.create(null);
	for (const key of expected) {
		const child = properties[key]!;
		if (child.kind === "optional") {
			if (Object.hasOwn(input, key))
				output[key] = transform(
					child.codec,
					input[key],
					`${path}.${key}`,
					direction,
				);
			continue;
		}
		output[key] = transform(child, input[key], `${path}.${key}`, direction);
	}
	return Object.freeze(output);
}

function exactKeys(
	value: Readonly<Record<string, unknown>>,
	keys: readonly string[],
	path: string,
): void {
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	if (
		actual.length !== expected.length ||
		expected.some((key, index) => key !== actual[index])
	)
		invalid(path, "has invalid codec keys");
}

function descriptor(
	value: unknown,
	path: string,
	allowOptional: boolean,
): RuntimeCodec {
	const input = record(value, path);
	if (typeof input.kind !== "string")
		invalid(path, "must declare a codec kind");
	if (
		input.kind === "boolean" ||
		input.kind === "integer" ||
		input.kind === "text" ||
		input.kind === "timestamp" ||
		input.kind === "uuid"
	) {
		exactKeys(input, ["kind"], path);
		return Object.freeze({ kind: input.kind });
	}
	if (input.kind === "nullable" || input.kind === "optional") {
		exactKeys(input, ["kind", "codec"], path);
		if (input.kind === "optional" && !allowOptional)
			invalid(path, "uses optional outside an object property");
		return Object.freeze({
			kind: input.kind,
			codec: descriptor(input.codec, `${path}.codec`, false),
		});
	}
	if (input.kind === "array") {
		exactKeys(input, ["kind", "items"], path);
		return Object.freeze({
			kind: "array",
			items: descriptor(input.items, `${path}.items`, false),
		});
	}
	if (input.kind !== "object") invalid(path, "uses an unsupported codec");
	exactKeys(input, ["kind", "properties"], path);
	const rawProperties = record(input.properties, `${path}.properties`);
	const properties: Record<string, RuntimeCodec> = Object.create(null);
	for (const key of Object.keys(rawProperties).sort())
		properties[key] = descriptor(
			rawProperties[key],
			`${path}.properties.${key}`,
			true,
		);
	return Object.freeze({
		kind: "object",
		properties: Object.freeze(properties),
	});
}

export function decodeRuntimeCodecDescriptor(
	value: unknown,
	path = "$codec",
): RuntimeCodec {
	return descriptor(value, path, false);
}

export function decodeRuntimeCodec<Value>(
	codec: RuntimeCodec,
	value: unknown,
	path = "$",
): Value {
	return transform(codec, value, path, "runtime") as Value;
}

export function encodeRuntimeCodec<Value>(
	codec: RuntimeCodec,
	value: Value,
	path = "$",
): unknown {
	return transform(codec, value, path, "wire");
}
