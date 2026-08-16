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
