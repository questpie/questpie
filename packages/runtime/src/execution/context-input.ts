import type { Codec } from "questpie";

type CodecRecord = Readonly<{
	kind?: unknown;
	nullable?: unknown;
	properties?: unknown;
}>;

function invalid(path: string, requirement: string): never {
	throw new TypeError(`Context input ${path} ${requirement}`);
}

function record(
	value: unknown,
	path: string,
): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		invalid(path, "must be an object");
	return value as Readonly<Record<string, unknown>>;
}

function decode(codec: CodecRecord, value: unknown, path: string): unknown {
	if (value === null && codec.nullable === true) return null;
	switch (codec.kind) {
		case "boolean":
			if (typeof value !== "boolean") invalid(path, "must be a boolean");
			return value;
		case "integer":
			if (typeof value !== "number" || !Number.isSafeInteger(value))
				invalid(path, "must be a safe integer");
			return value;
		case "text":
			if (typeof value !== "string") invalid(path, "must be text");
			if (value !== value.normalize("NFC")) invalid(path, "must be NFC text");
			return value;
		case "uuid":
			if (
				typeof value !== "string" ||
				!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
					value,
				)
			)
				invalid(path, "must be a canonical UUID");
			return value;
		case "object": {
			const input = record(value, path);
			const properties = record(codec.properties, `${path} codec`);
			const expected = Object.keys(properties).sort();
			const actual = Object.keys(input).sort();
			if (
				expected.length !== actual.length ||
				expected.some((key, index) => key !== actual[index])
			)
				invalid(path, "must have exactly the compiled keys");
			const output: Record<string, unknown> = Object.create(null);
			for (const key of expected)
				output[key] = decode(
					record(properties[key], `${path}.${key} codec`),
					input[key],
					`${path}.${key}`,
				);
			return output;
		}
		default:
			return invalid(path, "uses an unsupported codec");
	}
}

export function decodeContextInput<Value>(
	codec: Codec<Value>,
	value: unknown,
): Value {
	return decode(codec as CodecRecord, value, "$") as Value;
}
