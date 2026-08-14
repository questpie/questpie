import { canonicalBytes, compareAscii } from "../canonical";

type JsonRecord = Readonly<Record<string, unknown>>;

type InvalidValue = (requirement: string) => never;
type NormalizeScalar = (codec: JsonRecord, value: unknown) => unknown;

function record(value: unknown, invalid: InvalidValue): JsonRecord {
	if (
		!value ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		Object.getPrototypeOf(value) !== Object.prototype
	)
		return invalid("requires a plain JSON object");
	return value as JsonRecord;
}

function normalizeOpenJson(
	value: unknown,
	invalid: InvalidValue,
	depth = 0,
): unknown {
	if (value === null || typeof value === "boolean") return value;
	if (typeof value === "number") {
		if (!Number.isFinite(value)) return invalid("requires finite JSON numbers");
		return value;
	}
	if (typeof value === "string") {
		if (value.normalize("NFC") !== value)
			return invalid("requires NFC JSON strings");
		return value;
	}
	if (depth >= 8) return invalid("exceeds the JSON container depth limit");
	if (Array.isArray(value)) {
		for (let index = 0; index < value.length; index += 1)
			if (!(index in value))
				return invalid("does not accept sparse JSON arrays");
		return value.map((item) => normalizeOpenJson(item, invalid, depth + 1));
	}
	const input = record(value, invalid);
	return Object.fromEntries(
		Object.keys(input)
			.sort(compareAscii)
			.map((key) => {
				if (key.normalize("NFC") !== key)
					return invalid("requires NFC JSON object keys");
				return [key, normalizeOpenJson(input[key], invalid, depth + 1)];
			}),
	);
}

function normalizeEmbedded(
	codec: JsonRecord,
	value: unknown,
	invalid: InvalidValue,
	normalizeScalar: NormalizeScalar,
	depth: number,
): unknown {
	if (value === null) {
		if (codec.nullable !== true)
			return invalid("contains JSON null for a non-nullable embedded value");
		return null;
	}
	if (codec.kind === "object") {
		if (depth >= 8)
			return invalid("exceeds the embedded value container depth limit");
		const input = record(value, invalid);
		const properties = Array.isArray(codec.properties)
			? (codec.properties as readonly JsonRecord[])
			: [];
		const expected = properties.map((property) => String(property.key));
		const actual = Object.keys(input).sort(compareAscii);
		if (canonicalBytes(actual) !== canonicalBytes(expected))
			return invalid("requires exactly its declared embedded properties");
		return Object.fromEntries(
			properties.map((property) => [
				String(property.key),
				normalizeEmbedded(
					property.codec as JsonRecord,
					input[String(property.key)],
					invalid,
					normalizeScalar,
					depth + 1,
				),
			]),
		);
	}
	if (codec.kind === "array") {
		if (depth >= 8)
			return invalid("exceeds the embedded value container depth limit");
		if (!Array.isArray(value)) return invalid("requires an embedded array");
		const maximumItems = Number(codec.maximumItems);
		if (value.length > maximumItems)
			return invalid("exceeds its embedded array item limit");
		for (let index = 0; index < value.length; index += 1)
			if (!(index in value))
				return invalid("does not accept sparse embedded arrays");
		return value.map((item) =>
			normalizeEmbedded(
				codec.items as JsonRecord,
				item,
				invalid,
				normalizeScalar,
				depth + 1,
			),
		);
	}
	return normalizeScalar(codec, value);
}

export function normalizeJsonBackedValue(
	type: JsonRecord,
	value: unknown,
	invalid: InvalidValue,
	normalizeScalar: NormalizeScalar,
): Readonly<{ kind: "json"; value: unknown }> {
	let normalized: unknown;
	if (type.kind === "json") {
		const tagged = record(value, invalid);
		if (
			tagged.kind !== "json" ||
			!Object.hasOwn(tagged, "value") ||
			Object.keys(tagged).length !== 2
		)
			return invalid("requires the exact tagged open JSON value");
		normalized = normalizeOpenJson(tagged.value, invalid);
	} else {
		normalized = normalizeEmbedded(
			{ ...type, nullable: false },
			value,
			invalid,
			normalizeScalar,
			0,
		);
	}
	if (Buffer.byteLength(canonicalBytes(normalized)) > 1_048_576)
		return invalid("exceeds the canonical JSON byte limit");
	return { kind: "json", value: normalized };
}
