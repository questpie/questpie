export type RuntimeCodec =
	| Readonly<{ kind: "boolean" | "cursor" | "date" | "json" | "uuid" }>
	| Readonly<{ kind: "text"; minLength?: number; maxLength?: number }>
	| Readonly<{ kind: "integer"; minimum?: number; maximum?: number }>
	| Readonly<{ kind: "bigint"; minimum?: string; maximum?: string }>
	| Readonly<{ kind: "numeric"; precision: number; scale: number }>
	| Readonly<{ kind: "timestamp"; withTimezone?: boolean }>
	| Readonly<{ kind: "array"; items: RuntimeCodec; maximum?: number }>
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

function hasLoneSurrogate(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const unit = value.charCodeAt(index);
		if (unit >= 0xd800 && unit <= 0xdbff) {
			const next = value.charCodeAt(index + 1);
			if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
			index += 1;
		} else if (unit >= 0xdc00 && unit <= 0xdfff) return true;
	}
	return false;
}

function canonicalBigint(value: unknown, path: string): string {
	if (
		typeof value !== "string" ||
		!/^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$/u.test(value)
	)
		invalid(path, "must be canonical bigint text");
	const parsed = BigInt(value);
	if (
		parsed < -9_223_372_036_854_775_808n ||
		parsed > 9_223_372_036_854_775_807n
	)
		invalid(path, "must be within PostgreSQL bigint");
	return value;
}

function canonicalDate(value: unknown, path: string): string {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value))
		invalid(path, "must be canonical date text");
	const parsed = new Date(`${value}T00:00:00.000Z`);
	if (
		!Number.isFinite(parsed.getTime()) ||
		parsed.toISOString().slice(0, 10) !== value
	)
		invalid(path, "must be canonical date text");
	return value;
}

function canonicalNumeric(
	value: unknown,
	precision: number,
	scale: number,
	path: string,
): string {
	const pattern =
		scale === 0
			? /^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$/u
			: new RegExp(`^(?:0|-[1-9][0-9]*|[1-9][0-9]*)\\.[0-9]{${scale}}$`, "u");
	if (
		typeof value !== "string" ||
		!pattern.test(value) ||
		value.replace(/[-.]/gu, "").length > precision
	)
		invalid(path, `must be canonical numeric(${precision}, ${scale}) text`);
	return value;
}

function normalizeJson(
	value: unknown,
	path: string,
	active = new Set<object>(),
): unknown {
	if (value === null || typeof value === "boolean") return value;
	if (typeof value === "number") {
		if (!Number.isFinite(value) || Object.is(value, -0))
			invalid(path, "must contain canonical JSON numbers");
		return value;
	}
	if (typeof value === "string") {
		if (hasLoneSurrogate(value) || value.normalize("NFC") !== value)
			invalid(path, "must contain canonical NFC JSON text");
		return value;
	}
	if (!value || typeof value !== "object")
		invalid(path, "must contain only JSON values");
	if (active.has(value)) invalid(path, "must not contain cyclic JSON values");
	active.add(value);
	try {
		if (Array.isArray(value)) {
			for (let index = 0; index < value.length; index += 1)
				if (!(index in value)) invalid(path, "must not contain sparse arrays");
			return Object.freeze(
				value.map((item, index) =>
					normalizeJson(item, `${path}[${index}]`, active),
				),
			);
		}
		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null)
			invalid(path, "must contain plain JSON objects");
		const output: Record<string, unknown> = Object.create(null);
		for (const key of Object.keys(value).sort()) {
			if (hasLoneSurrogate(key) || key.normalize("NFC") !== key)
				invalid(path, "must contain canonical NFC JSON object keys");
			output[key] = normalizeJson(
				(value as Readonly<Record<string, unknown>>)[key],
				`${path}.${key}`,
				active,
			);
		}
		return Object.freeze(output);
	} finally {
		active.delete(value);
	}
}

function descriptorSafeInteger(
	value: unknown,
	path: string,
	positive = false,
): number {
	if (!Number.isSafeInteger(value) || (positive && (value as number) < 1))
		invalid(
			path,
			positive ? "must be a positive safe integer" : "must be a safe integer",
		);
	return value as number;
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
		if (codec.minimum !== undefined && value < codec.minimum)
			invalid(path, `must be at least ${codec.minimum}`);
		if (codec.maximum !== undefined && value > codec.maximum)
			invalid(path, `must be at most ${codec.maximum}`);
		return value;
	}
	if (codec.kind === "bigint") {
		const canonical = canonicalBigint(value, path);
		const parsed = BigInt(canonical);
		if (codec.minimum !== undefined && parsed < BigInt(codec.minimum))
			invalid(path, `must be at least ${codec.minimum}`);
		if (codec.maximum !== undefined && parsed > BigInt(codec.maximum))
			invalid(path, `must be at most ${codec.maximum}`);
		return canonical;
	}
	if (codec.kind === "numeric")
		return canonicalNumeric(value, codec.precision, codec.scale, path);
	if (codec.kind === "cursor") {
		if (typeof value !== "string") invalid(path, "must be an opaque cursor");
		if (value !== value.normalize("NFC"))
			invalid(path, "must be an NFC cursor");
		return value;
	}
	if (codec.kind === "text") {
		if (typeof value !== "string" || hasLoneSurrogate(value))
			invalid(path, "must be text");
		if (value !== value.normalize("NFC")) invalid(path, "must be NFC text");
		const length = [...value].length;
		if (codec.minLength !== undefined && length < codec.minLength)
			invalid(path, `must contain at least ${codec.minLength} Unicode scalars`);
		if (codec.maxLength !== undefined && length > codec.maxLength)
			invalid(path, `must contain at most ${codec.maxLength} Unicode scalars`);
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
		const withTimezone = codec.withTimezone !== false;
		if (direction === "runtime") {
			if (value instanceof Date) return timestamp(value, path);
			if (!withTimezone && typeof value === "string")
				return timestamp(`${value}Z`, path);
			return timestamp(value, path);
		}
		if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
			invalid(path, "must be a valid timestamp");
		const encoded = value.toISOString();
		return withTimezone ? encoded : encoded.slice(0, -1);
	}
	if (codec.kind === "date") return canonicalDate(value, path);
	if (codec.kind === "json") {
		const tagged = record(value, path);
		exactKeys(tagged, ["kind", "value"], path);
		if (tagged.kind !== "json") invalid(path, "must be tagged as json");
		return Object.freeze({
			kind: "json" as const,
			value: normalizeJson(tagged.value, `${path}.value`),
		});
	}
	if (codec.kind === "array") {
		if (!Array.isArray(value)) invalid(path, "must be an array");
		for (let index = 0; index < value.length; index += 1)
			if (!(index in value)) invalid(path, "must not contain sparse arrays");
		if (codec.maximum !== undefined && value.length > codec.maximum)
			invalid(path, `must contain at most ${codec.maximum} items`);
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
		input.kind === "cursor" ||
		input.kind === "date" ||
		input.kind === "json" ||
		input.kind === "uuid"
	) {
		exactKeys(input, ["kind"], path);
		return Object.freeze({ kind: input.kind });
	}
	if (input.kind === "text") {
		const allowed = new Set(["kind", "minLength", "maxLength"]);
		if (Object.keys(input).some((key) => !allowed.has(key)))
			invalid(path, "has invalid codec keys");
		const minLength =
			input.minLength === undefined
				? undefined
				: descriptorSafeInteger(input.minLength, `${path}.minLength`);
		const maxLength =
			input.maxLength === undefined
				? undefined
				: descriptorSafeInteger(input.maxLength, `${path}.maxLength`);
		if (minLength !== undefined && minLength < 0)
			invalid(`${path}.minLength`, "must be a non-negative safe integer");
		if (maxLength !== undefined && maxLength < 0)
			invalid(`${path}.maxLength`, "must be a non-negative safe integer");
		if (
			minLength !== undefined &&
			maxLength !== undefined &&
			minLength > maxLength
		)
			invalid(path, "minLength must not exceed maxLength");
		return Object.freeze({
			kind: "text",
			...(minLength === undefined ? {} : { minLength }),
			...(maxLength === undefined ? {} : { maxLength }),
		});
	}
	if (input.kind === "integer") {
		const allowed = new Set(["kind", "minimum", "maximum"]);
		if (Object.keys(input).some((key) => !allowed.has(key)))
			invalid(path, "has invalid codec keys");
		const minimum =
			input.minimum === undefined
				? undefined
				: descriptorSafeInteger(input.minimum, `${path}.minimum`);
		const maximum =
			input.maximum === undefined
				? undefined
				: descriptorSafeInteger(input.maximum, `${path}.maximum`);
		if (minimum !== undefined && maximum !== undefined && minimum > maximum)
			invalid(path, "minimum must not exceed maximum");
		return Object.freeze({
			kind: "integer",
			...(minimum === undefined ? {} : { minimum }),
			...(maximum === undefined ? {} : { maximum }),
		});
	}
	if (input.kind === "bigint") {
		const allowed = new Set(["kind", "minimum", "maximum"]);
		if (Object.keys(input).some((key) => !allowed.has(key)))
			invalid(path, "has invalid codec keys");
		const minimum =
			input.minimum === undefined
				? undefined
				: canonicalBigint(input.minimum, `${path}.minimum`);
		const maximum =
			input.maximum === undefined
				? undefined
				: canonicalBigint(input.maximum, `${path}.maximum`);
		if (
			minimum !== undefined &&
			maximum !== undefined &&
			BigInt(minimum) > BigInt(maximum)
		)
			invalid(path, "minimum must not exceed maximum");
		return Object.freeze({
			kind: "bigint",
			...(minimum === undefined ? {} : { minimum }),
			...(maximum === undefined ? {} : { maximum }),
		});
	}
	if (input.kind === "numeric") {
		exactKeys(input, ["kind", "precision", "scale"], path);
		const precision = descriptorSafeInteger(
			input.precision,
			`${path}.precision`,
			true,
		);
		const scale = descriptorSafeInteger(input.scale, `${path}.scale`);
		if (precision > 1_000) invalid(`${path}.precision`, "must be at most 1000");
		if (scale < 0 || scale > precision)
			invalid(`${path}.scale`, "must be from zero through precision");
		return Object.freeze({ kind: "numeric", precision, scale });
	}
	if (input.kind === "timestamp") {
		const allowed = new Set(["kind", "withTimezone"]);
		if (Object.keys(input).some((key) => !allowed.has(key)))
			invalid(path, "has invalid codec keys");
		if (
			input.withTimezone !== undefined &&
			typeof input.withTimezone !== "boolean"
		)
			invalid(`${path}.withTimezone`, "must be a boolean");
		return Object.freeze({
			kind: "timestamp",
			...(input.withTimezone === undefined
				? {}
				: { withTimezone: input.withTimezone }),
		});
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
		const allowed = new Set(["kind", "items", "maximum"]);
		if (Object.keys(input).some((key) => !allowed.has(key)))
			invalid(path, "has invalid codec keys");
		return Object.freeze({
			kind: "array",
			items: descriptor(input.items, `${path}.items`, false),
			...(input.maximum === undefined
				? {}
				: {
						maximum: descriptorSafeInteger(
							input.maximum,
							`${path}.maximum`,
							true,
						),
					}),
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
