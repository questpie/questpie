export type ScalarCodecV1 =
	| Readonly<{ kind: "uuid" }>
	| Readonly<{
			kind: "text";
			minLength: number | null;
			maxLength: number | null;
			collation: "questpie.binary";
	  }>
	| Readonly<{ kind: "boolean" }>
	| Readonly<{
			kind: "integer";
			minimum: number | null;
			maximum: number | null;
	  }>
	| Readonly<{ kind: "bigint"; minimum: string | null; maximum: string | null }>
	| Readonly<{ kind: "numeric"; precision: number; scale: number }>
	| Readonly<{ kind: "timestamp"; withTimezone: boolean }>
	| Readonly<{ kind: "date" }>;

export type RelationalScalar = boolean | number | string;

type RecordValue = Readonly<Record<string, unknown>>;

function invalidCodec(message: string): never {
	throw new TypeError(`Invalid relational scalar codec: ${message}`);
}

function codecRecord(value: unknown, label: string): RecordValue {
	if (!value || typeof value !== "object" || Array.isArray(value))
		invalidCodec(`${label} must be an object`);
	return value as RecordValue;
}

function exactCodecKeys(
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
		invalidCodec(`${label} has invalid keys`);
}

function nullableInteger(value: unknown, label: string): number | null {
	if (value === null) return null;
	if (!Number.isSafeInteger(value)) invalidCodec(`${label} is invalid`);
	return value as number;
}

function boundedNullableInteger(
	value: unknown,
	label: string,
	minimum: number,
	maximum: number,
): number | null {
	const result = nullableInteger(value, label);
	if (result !== null && (result < minimum || result > maximum))
		invalidCodec(`${label} bounds are invalid`);
	return result;
}

function nullableBigint(value: unknown, label: string): string | null {
	if (value === null) return null;
	if (
		typeof value !== "string" ||
		!/^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$/.test(value)
	)
		invalidCodec(`${label} bigint is invalid`);
	const result = BigInt(value);
	if (
		result < -9_223_372_036_854_775_808n ||
		result > 9_223_372_036_854_775_807n
	)
		invalidCodec(`${label} bigint is invalid`);
	return value;
}

export function decodeRelationalScalarCodec(
	value: unknown,
	label: string,
): ScalarCodecV1 {
	const source = codecRecord(value, label);
	if (
		source.kind === "uuid" ||
		source.kind === "boolean" ||
		source.kind === "date"
	) {
		exactCodecKeys(source, ["kind"], label);
		return Object.freeze({ kind: source.kind });
	}
	if (source.kind === "text") {
		exactCodecKeys(
			source,
			["kind", "minLength", "maxLength", "collation"],
			label,
		);
		const minLength = nullableInteger(source.minLength, `${label} minLength`);
		const maxLength = nullableInteger(source.maxLength, `${label} maxLength`);
		if (
			(minLength !== null && minLength < 0) ||
			(maxLength !== null && maxLength < 0) ||
			(minLength !== null && maxLength !== null && minLength > maxLength) ||
			source.collation !== "questpie.binary"
		)
			invalidCodec(`${label} bounds are invalid`);
		return Object.freeze({
			kind: "text",
			minLength,
			maxLength,
			collation: "questpie.binary",
		});
	}
	if (source.kind === "integer") {
		exactCodecKeys(source, ["kind", "minimum", "maximum"], label);
		const minimum = boundedNullableInteger(
			source.minimum,
			`${label} minimum`,
			-2_147_483_648,
			2_147_483_647,
		);
		const maximum = boundedNullableInteger(
			source.maximum,
			`${label} maximum`,
			-2_147_483_648,
			2_147_483_647,
		);
		if (minimum !== null && maximum !== null && minimum > maximum)
			invalidCodec(`${label} bounds are invalid`);
		return Object.freeze({ kind: "integer", minimum, maximum });
	}
	if (source.kind === "bigint") {
		exactCodecKeys(source, ["kind", "minimum", "maximum"], label);
		const minimum = nullableBigint(source.minimum, `${label} minimum`);
		const maximum = nullableBigint(source.maximum, `${label} maximum`);
		if (
			minimum !== null &&
			maximum !== null &&
			BigInt(minimum) > BigInt(maximum)
		)
			invalidCodec(`${label} bounds are invalid`);
		return Object.freeze({ kind: "bigint", minimum, maximum });
	}
	if (source.kind === "numeric") {
		exactCodecKeys(source, ["kind", "precision", "scale"], label);
		if (
			!Number.isSafeInteger(source.precision) ||
			!Number.isSafeInteger(source.scale) ||
			(source.precision as number) <= 0 ||
			(source.precision as number) > 1_000 ||
			(source.scale as number) < 0 ||
			(source.scale as number) > (source.precision as number)
		)
			invalidCodec(`${label} bounds are invalid`);
		return Object.freeze({
			kind: "numeric",
			precision: source.precision as number,
			scale: source.scale as number,
		});
	}
	if (source.kind === "timestamp") {
		exactCodecKeys(source, ["kind", "withTimezone"], label);
		if (typeof source.withTimezone !== "boolean")
			invalidCodec(`${label} is invalid`);
		return Object.freeze({
			kind: "timestamp",
			withTimezone: source.withTimezone,
		});
	}
	invalidCodec(`${label} kind is invalid`);
}

const uuidPattern =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function hasLoneUnicodeSurrogate(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const codeUnit = value.charCodeAt(index);
		if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
			const next = value.charCodeAt(index + 1);
			if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
			index += 1;
			continue;
		}
		if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return true;
	}
	return false;
}

function timestamp(value: unknown, withTimezone: boolean): Date | null {
	if (value instanceof Date)
		return Number.isFinite(value.getTime()) ? new Date(value.getTime()) : null;
	if (typeof value !== "string") return null;
	const pattern = withTimezone
		? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
		: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$/;
	if (!pattern.test(value)) return null;
	const comparable = withTimezone ? value : `${value}Z`;
	const parsed = new Date(comparable);
	return Number.isFinite(parsed.getTime()) &&
		parsed.toISOString() === comparable
		? parsed
		: null;
}

export function decodeRelationalScalar(
	value: unknown,
	codec: ScalarCodecV1,
	timestampResult: "canonical" | "date" = "canonical",
): RelationalScalar | Date {
	if (codec.kind === "boolean") {
		if (typeof value === "boolean") return value;
	} else if (codec.kind === "integer") {
		if (
			typeof value === "number" &&
			Number.isSafeInteger(value) &&
			!Object.is(value, -0) &&
			value >= -2_147_483_648 &&
			value <= 2_147_483_647 &&
			(codec.minimum === null || value >= codec.minimum) &&
			(codec.maximum === null || value <= codec.maximum)
		)
			return value;
	} else if (codec.kind === "timestamp") {
		const decoded = timestamp(value, codec.withTimezone);
		if (decoded) {
			if (timestampResult === "date") return decoded;
			const encoded = decoded.toISOString();
			return codec.withTimezone ? encoded : encoded.slice(0, -1);
		}
	} else if (typeof value === "string" && !hasLoneUnicodeSurrogate(value)) {
		if (codec.kind === "uuid" && uuidPattern.test(value)) return value;
		if (codec.kind === "text") {
			const length = Array.from(value).length;
			if (
				value.normalize("NFC") === value &&
				(codec.minLength === null || length >= codec.minLength) &&
				(codec.maxLength === null || length <= codec.maxLength)
			)
				return value;
		} else if (codec.kind === "bigint") {
			if (/^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$/.test(value)) {
				const parsed = BigInt(value);
				if (
					parsed >= -9_223_372_036_854_775_808n &&
					parsed <= 9_223_372_036_854_775_807n &&
					(codec.minimum === null || parsed >= BigInt(codec.minimum)) &&
					(codec.maximum === null || parsed <= BigInt(codec.maximum))
				)
					return value;
			}
		} else if (codec.kind === "numeric") {
			const pattern =
				codec.scale === 0
					? /^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$/
					: new RegExp(
							`^(?:0|-[1-9][0-9]*|[1-9][0-9]*)\\.[0-9]{${codec.scale}}$`,
						);
			if (
				pattern.test(value) &&
				value.replace(/[-.]/g, "").length <= codec.precision
			)
				return value;
		} else if (
			codec.kind === "date" &&
			/^\d{4}-\d{2}-\d{2}$/.test(value) &&
			new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value
		)
			return value;
	}
	throw new TypeError("invalid relational scalar");
}

export function isValidRelationalScalar(
	value: unknown,
	codec: ScalarCodecV1,
): value is RelationalScalar {
	if (value instanceof Date) return false;
	try {
		decodeRelationalScalar(value, codec);
		return true;
	} catch {
		return false;
	}
}
