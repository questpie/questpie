import { compareAscii } from "../canonical";
import { normalizeCodecContract } from "../codec";
type JsonRecord = Readonly<Record<string, unknown>>;
type JsonSchema = Readonly<Record<string, unknown>>;

function invalid(message: string): never {
	throw new TypeError(message);
}

function record(value: unknown): JsonRecord {
	if (!value || typeof value !== "object" || Array.isArray(value))
		return invalid("invalid operation projection artifact");
	return value as JsonRecord;
}

function normalizedCodec(value: unknown): JsonRecord {
	return normalizeCodecContract(value, {
		requireExactMembers: true,
		invalid: () => invalid("invalid codec in operation projection"),
	});
}

function runtimeValidation(requirements: readonly string[]): JsonRecord {
	return {
		"x-questpie-runtime-validation": {
			exact: false,
			requirements,
		},
	};
}

function numericPattern(precision: number, scale: number): string {
	const integral = precision - scale;
	if (integral < 1) return "(?!)";
	const signed =
		"(?:0|-[1-9][0-9]{0," +
		String(integral - 1) +
		"}|[1-9][0-9]{0," +
		String(integral - 1) +
		"})";
	return scale === 0
		? "^" + signed + "$"
		: "^" + signed + "\\.[0-9]{" + String(scale) + "}$";
}

export function projectNormalizedOperationCodecSchema(
	codec: JsonRecord,
): JsonSchema {
	if (codec.kind === "optional")
		return projectNormalizedOperationCodecSchema(record(codec.codec));
	if (codec.kind === "nullable")
		return {
			anyOf: [
				projectNormalizedOperationCodecSchema(record(codec.codec)),
				{ type: "null" },
			],
		};
	if (codec.kind === "object") {
		const entries = Object.entries(record(codec.properties)).sort(
			([left], [right]) => compareAscii(left, right),
		);
		return {
			type: "object",
			additionalProperties: false,
			properties: Object.fromEntries(
				entries.map(([name, child]) => [
					name,
					projectNormalizedOperationCodecSchema(record(child)),
				]),
			),
			required: entries
				.filter(([, child]) => record(child).kind !== "optional")
				.map(([name]) => name),
		};
	}
	if (codec.kind === "array")
		return {
			type: "array",
			items: projectNormalizedOperationCodecSchema(record(codec.items)),
			...(codec.maximum === undefined ? {} : { maxItems: codec.maximum }),
		};
	if (codec.kind === "boolean") return { type: "boolean" };
	if (codec.kind === "integer")
		return {
			type: "integer",
			minimum: Math.max(
				Number(codec.minimum ?? Number.MIN_SAFE_INTEGER),
				Number.MIN_SAFE_INTEGER,
			),
			maximum: Math.min(
				Number(codec.maximum ?? Number.MAX_SAFE_INTEGER),
				Number.MAX_SAFE_INTEGER,
			),
			...runtimeValidation(["negativeZeroRejected"]),
		};
	if (codec.kind === "bigint")
		return {
			type: "string",
			pattern: "^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$",
			...runtimeValidation([
				"minimum:" + String(codec.minimum ?? "-9223372036854775808"),
				"maximum:" + String(codec.maximum ?? "9223372036854775807"),
			]),
		};
	if (codec.kind === "numeric")
		return {
			type: "string",
			pattern: numericPattern(Number(codec.precision), Number(codec.scale)),
			"x-questpie-precision": codec.precision,
			"x-questpie-scale": codec.scale,
		};
	if (codec.kind === "text")
		return {
			type: "string",
			...(codec.minLength === undefined ? {} : { minLength: codec.minLength }),
			...(codec.maxLength === undefined ? {} : { maxLength: codec.maxLength }),
			...runtimeValidation(["nfc", "noLoneSurrogate"]),
		};
	if (codec.kind === "uuid")
		return {
			type: "string",
			format: "uuid",
			pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
		};
	if (codec.kind === "cursor")
		return {
			type: "string",
			"x-questpie-codec": "cursor",
			...runtimeValidation(["nfc"]),
		};
	if (codec.kind === "date")
		return {
			type: "string",
			format: "date",
			pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$",
			...runtimeValidation(["canonicalCalendarDate"]),
		};
	if (codec.kind === "timestamp")
		return {
			type: "string",
			...(codec.withTimezone === false
				? {
						pattern:
							"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}$",
					}
				: {
						format: "date-time",
						pattern:
							"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$",
					}),
			"x-questpie-timezone": codec.withTimezone !== false,
			...runtimeValidation(["canonicalMillisecondTimestamp"]),
		};
	if (codec.kind === "json")
		return {
			type: "object",
			additionalProperties: false,
			properties: { kind: { const: "json" }, value: {} },
			required: ["kind", "value"],
			...runtimeValidation([
				"canonicalFiniteNumbers",
				"nfc",
				"noLoneSurrogate",
			]),
		};
	return invalid("unsupported codec in operation projection");
}

function projectCodec(value: unknown): JsonSchema {
	return projectNormalizedOperationCodecSchema(normalizedCodec(value));
}

export function projectOperationCodecSchema(value: unknown): JsonSchema {
	return projectCodec(value);
}
