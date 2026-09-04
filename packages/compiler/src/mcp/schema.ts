import { compareAscii } from "../canonical";
import { projectOperationCodecSchema, type DocumentationEntry } from "../http";

type JsonRecord = Readonly<Record<string, unknown>>;
type OperationContract = Readonly<{
	identity: string;
	output: unknown;
	declaredErrors: unknown;
}>;

const frameworkFailures = {
	DEADLINE_EXCEEDED: true,
	INTERNAL: false,
	NOT_FOUND: false,
	PROTOCOL_UNSUPPORTED: false,
	RESOURCE_LIMIT: true,
	RUNTIME_UNAVAILABLE: true,
	UNAUTHENTICATED: false,
} as const;

function record(value: unknown): JsonRecord {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new TypeError("invalid Operation outcome in MCP projection");
	return value as JsonRecord;
}

function callIdSchema(): JsonRecord {
	return {
		type: "string",
		minLength: 1,
		maxLength: 256,
		"x-questpie-runtime-validation": {
			requirements: ["maxUtf8Bytes:1024", "nfc", "noNull", "noLoneSurrogate"],
		},
	};
}

function frameworkFrame(
	code: string,
	retryable: boolean,
	extra: JsonRecord = {},
): JsonRecord {
	return {
		type: "object",
		additionalProperties: false,
		properties: {
			callId: callIdSchema(),
			error: {
				type: "object",
				additionalProperties: false,
				properties: {
					code: { const: code },
					retryable: { const: retryable },
					...extra,
				},
				required: ["code", "retryable", ...Object.keys(extra)],
			},
		},
		required: ["callId", "error"],
	};
}

function declaredFrames(value: unknown): JsonRecord[] {
	const entries = Array.isArray(value)
		? value.map((item) => item)
		: Object.values(record(value));
	return entries
		.map((raw) => {
			const error = record(raw);
			if (typeof error.code !== "string")
				throw new TypeError(
					"invalid declared Operation error in MCP projection",
				);
			return {
				code: error.code,
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						callId: callIdSchema(),
						error: {
							type: "object",
							additionalProperties: false,
							properties: {
								code: { const: error.code },
								payload:
									error.payload === null
										? { type: "null" }
										: projectOperationCodecSchema(error.payload),
							},
							required: ["code", "payload"],
						},
					},
					required: ["callId", "error"],
				},
			};
		})
		.sort((left, right) => compareAscii(left.code, right.code))
		.map(({ schema }) => schema);
}

function validateFailures(failures: readonly string[]): void {
	const actual = [...failures].sort(compareAscii);
	const expected = [
		"COMMITTED_RESULT_UNAVAILABLE",
		...Object.keys(frameworkFailures),
	].sort(compareAscii);
	if (
		actual.length !== expected.length ||
		actual.some((failure, index) => failure !== expected[index])
	)
		throw new TypeError("invalid framework failures in MCP projection");
}

export function projectMcpOutcomeSchema(
	operation: OperationContract,
	failures: readonly string[],
	documentation?: DocumentationEntry,
): JsonRecord {
	validateFailures(failures);
	const outputExamples = documentation?.examples?.flatMap((example) =>
		example.output === undefined ? [] : [example.output],
	);
	const kind = operation.identity.slice(0, operation.identity.indexOf(":"));
	return {
		$schema: "https://json-schema.org/draft/2020-12/schema",
		oneOf: [
			{
				type: "object",
				additionalProperties: false,
				properties: {
					callId: callIdSchema(),
					result: {
						...projectOperationCodecSchema(operation.output),
						...(outputExamples && outputExamples.length > 0
							? { examples: outputExamples }
							: {}),
					},
				},
				required: ["callId", "result"],
			},
			...declaredFrames(operation.declaredErrors),
			...Object.entries(frameworkFailures)
				.sort(([left], [right]) => compareAscii(left, right))
				.map(([code, retryable]) => frameworkFrame(code, retryable)),
			...(kind === "mutation"
				? [
						frameworkFrame("COMMITTED_RESULT_UNAVAILABLE", true, {
							transactionId: {
								type: "string",
								pattern: "^[1-9][0-9]{0,19}$",
							},
						}),
					]
				: []),
			...(kind === "action"
				? [
						frameworkFrame("RESOURCE_LIMIT", false),
						frameworkFrame("ACTION_OUTCOME_AMBIGUOUS", false),
					]
				: []),
		],
	};
}
