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

type JsonContainer = Record<string, unknown> | unknown[];
type OpenJsonFrame =
	| Readonly<{ kind: "leave"; value: object }>
	| Readonly<{
			key: string;
			kind: "objectValue";
			parent: Record<string, unknown>;
			source: JsonRecord;
	  }>
	| Readonly<{
			kind: "value";
			key: number | string;
			parent: JsonContainer;
			value: unknown;
	  }>;

function assignJsonValue(
	parent: JsonContainer,
	key: number | string,
	value: unknown,
): void {
	if (Array.isArray(parent)) {
		if (typeof key !== "number") throw new TypeError("invalid JSON array key");
		parent[key] = value;
		return;
	}
	if (typeof key !== "string") throw new TypeError("invalid JSON object key");
	parent[key] = value;
}

function normalizeOpenJson(value: unknown, invalid: InvalidValue): unknown {
	const active = new Set<object>();
	const root: Record<string, unknown> = Object.create(null);
	const stack: OpenJsonFrame[] = [
		{ kind: "value", key: "value", parent: root, value },
	];
	while (stack.length > 0) {
		const frame = stack.pop();
		if (!frame) break;
		if (frame.kind === "leave") {
			active.delete(frame.value);
			continue;
		}
		if (frame.kind === "objectValue") {
			if (frame.key.normalize("NFC") !== frame.key)
				return invalid("requires NFC JSON object keys");
			stack.push({
				kind: "value",
				key: frame.key,
				parent: frame.parent,
				value: frame.source[frame.key],
			});
			continue;
		}
		const item = frame.value;
		if (item === null || typeof item === "boolean") {
			assignJsonValue(frame.parent, frame.key, item);
			continue;
		}
		if (typeof item === "number") {
			if (!Number.isFinite(item))
				return invalid("requires finite JSON numbers");
			if (Object.is(item, -0))
				return invalid("requires canonical JSON numbers");
			assignJsonValue(frame.parent, frame.key, item);
			continue;
		}
		if (typeof item === "string") {
			if (item.normalize("NFC") !== item)
				return invalid("requires NFC JSON strings");
			assignJsonValue(frame.parent, frame.key, item);
			continue;
		}
		if (typeof item === "object" && active.has(item))
			return invalid("does not accept cyclic JSON values");
		if (Array.isArray(item)) {
			for (let index = 0; index < item.length; index += 1)
				if (!(index in item))
					return invalid("does not accept sparse JSON arrays");
			const normalized: unknown[] = Array.from({ length: item.length });
			assignJsonValue(frame.parent, frame.key, normalized);
			active.add(item);
			stack.push({ kind: "leave", value: item });
			for (let index = item.length - 1; index >= 0; index -= 1)
				stack.push({
					kind: "value",
					key: index,
					parent: normalized,
					value: item[index],
				});
			continue;
		}
		const input = record(item, invalid);
		const normalized: Record<string, unknown> = Object.create(null);
		assignJsonValue(frame.parent, frame.key, normalized);
		active.add(input);
		stack.push({ kind: "leave", value: input });
		const keys = Object.keys(input).sort(compareAscii);
		for (let index = keys.length - 1; index >= 0; index -= 1) {
			const key = keys[index];
			if (key === undefined) continue;
			stack.push({
				kind: "objectValue",
				key,
				parent: normalized,
				source: input,
			});
		}
	}
	return root.value;
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
