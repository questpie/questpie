import { decodeRuntimeCodec } from "@questpie/runtime/codec";

import { canonicalBytes, compareAscii } from "../canonical";
import { normalizeCodecContract } from "../codec";
import { projectOperationCarrierHeaders } from "./operation-carrier";
import {
	type DocumentationEntry,
	projectOperationMetadata,
} from "./operation-metadata";

export { projectOperationJsDoc } from "./operation-metadata";

type JsonRecord = Readonly<Record<string, unknown>>;
type JsonSchema = Readonly<Record<string, unknown>>;

type OperationContract = Readonly<{
	identity: string;
	input: unknown;
	output: unknown;
	declaredErrors: unknown;
}>;

export interface OperationProjectionInput {
	readonly applicationName: string;
	readonly contextCodec: unknown;
	readonly httpContract: JsonRecord &
		Readonly<{
			application: string;
			clientContractDigest: string;
			digest: string;
			failures: readonly string[];
			operations: readonly OperationContract[];
		}>;
	readonly operationContracts: JsonRecord &
		Readonly<{ operations: readonly OperationContract[] }>;
	readonly documentationBytes: string;
	readonly documentationDigest: string;
	readonly originMap: JsonRecord &
		Readonly<{
			resources: readonly Readonly<{
				identity: string;
				establishedAt: JsonRecord;
			}>[];
		}>;
}

export interface OperationProjection {
	readonly openapi: JsonRecord & Readonly<{ paths: JsonRecord }>;
	readonly openapiBytes: string;
	readonly explain: JsonRecord &
		Readonly<{ operations: readonly JsonRecord[] }>;
	readonly explainBytes: string;
	readonly jsdoc: Readonly<Record<string, string>>;
}

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

function projectNormalizedCodec(codec: JsonRecord): JsonSchema {
	if (codec.kind === "optional")
		return projectNormalizedCodec(record(codec.codec));
	if (codec.kind === "nullable")
		return {
			anyOf: [projectNormalizedCodec(record(codec.codec)), { type: "null" }],
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
					projectNormalizedCodec(record(child)),
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
			items: projectNormalizedCodec(record(codec.items)),
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
	return projectNormalizedCodec(normalizedCodec(value));
}

export function projectOperationCodecSchema(value: unknown): JsonSchema {
	return projectCodec(value);
}

function operationKind(identity: string): "action" | "mutation" | "query" {
	const kind = identity.slice(0, identity.indexOf(":"));
	if (kind !== "action" && kind !== "mutation" && kind !== "query")
		return invalid("invalid Operation identity in HTTP artifact");
	return kind;
}

function operationName(identity: string): string {
	return identity.slice(identity.indexOf(":") + 1);
}

function operationTag(name: string, applicationName: string): string {
	const separator = name.indexOf(".");
	return separator < 0 ? applicationName : name.slice(0, separator);
}

function unwrapCodec(codec: JsonRecord): JsonRecord {
	return codec.kind === "optional" || codec.kind === "nullable"
		? unwrapCodec(record(codec.codec))
		: codec;
}

function acceptsNull(codec: JsonRecord): boolean {
	return (
		codec.kind === "nullable" ||
		(codec.kind === "optional" && acceptsNull(record(codec.codec)))
	);
}

function queryLexicalSchema(codec: JsonRecord): JsonSchema {
	const decoded = projectNormalizedCodec(codec);
	const unwrapped = unwrapCodec(codec);
	let carrier: JsonSchema;
	if (unwrapped.kind === "boolean")
		carrier = { type: "string", pattern: "^(?:false|true)$" };
	else if (unwrapped.kind === "integer")
		carrier = {
			type: "string",
			pattern: "^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$",
		};
	else if (unwrapped.kind === "text")
		carrier = { type: "string", pattern: "^(?:[^~].*|~text:~.*|)$" };
	else if (
		["bigint", "numeric", "uuid", "date", "timestamp"].includes(
			String(unwrapped.kind),
		)
	) {
		const decodedScalar = projectNormalizedCodec(unwrapped);
		carrier = {
			type: "string",
			...(decodedScalar.pattern === undefined
				? {}
				: { pattern: decodedScalar.pattern }),
		};
	} else if (unwrapped.kind === "cursor") carrier = { type: "string" };
	else carrier = { type: "string", pattern: "^~json:.+$" };
	const carrierPattern = String(carrier.pattern ?? ".*").replace(
		/^\^|\$$/gu,
		"",
	);
	return {
		...carrier,
		...(acceptsNull(codec) ? { pattern: `^(?:~null|${carrierPattern})$` } : {}),
		"x-questpie-decoded-schema": decoded,
		"x-questpie-http-encoding": "canonical-lexical",
	};
}

function queryLexicalValue(codec: JsonRecord, value: unknown): string {
	if (value === null) return "~null";
	const kind = unwrapCodec(codec).kind;
	if (kind === "text") {
		if (typeof value !== "string") return invalid("invalid Query example");
		return value.startsWith("~") ? `~text:${value}` : value;
	}
	if (kind === "boolean" || kind === "integer") return String(value);
	if (
		["bigint", "numeric", "uuid", "date", "timestamp", "cursor"].includes(
			String(kind),
		)
	) {
		if (typeof value !== "string") return invalid("invalid Query example");
		return value;
	}
	return `~json:${canonicalBytes(value).slice(0, -1)}`;
}

function queryParameters(
	input: unknown,
	entry: DocumentationEntry | undefined,
): readonly JsonRecord[] {
	const codec = normalizedCodec(input);
	if (codec.kind !== "object")
		return invalid("canonical Query input must be an object");
	return Object.entries(record(codec.properties))
		.sort(([left], [right]) => compareAscii(left, right))
		.map(([name, child]) => {
			const childCodec = record(child);
			const examples = entry?.examples?.flatMap((example, index) => {
				const value = record(example.input)[name];
				return value === undefined
					? []
					: [
							[
								"example" + String(index + 1),
								{ value: queryLexicalValue(childCodec, value) },
							] as const,
						];
			});
			return {
				name,
				in: "query",
				required: childCodec.kind !== "optional",
				schema: queryLexicalSchema(childCodec),
				...(examples && examples.length > 0
					? { examples: Object.fromEntries(examples) }
					: {}),
			};
		});
}

function declaredResponseSchema(code: string, payload: unknown): JsonSchema {
	return {
		type: "object",
		additionalProperties: false,
		properties: {
			callId: { type: "string" },
			error: {
				type: "object",
				additionalProperties: false,
				properties: {
					code: { const: code },
					payload: payload === null ? { type: "null" } : projectCodec(payload),
				},
				required: ["code", "payload"],
			},
		},
		required: ["callId", "error"],
	};
}

function declaredErrors(operation: OperationContract): readonly Readonly<{
	key: string;
	code: string;
	status: number;
	payload: unknown | null;
}>[] {
	if (Array.isArray(operation.declaredErrors))
		return operation.declaredErrors as readonly Readonly<{
			key: string;
			code: string;
			status: number;
			payload: unknown | null;
		}>[];
	return Object.entries(record(operation.declaredErrors))
		.sort(([left], [right]) => compareAscii(left, right))
		.map(([key, value]) => {
			const error = record(value);
			if (
				typeof error.code !== "string" ||
				typeof error.status !== "number" ||
				!(error.payload === null || typeof error.payload === "object")
			)
				return invalid("invalid declared error in HTTP artifact");
			return {
				key,
				code: error.code,
				status: error.status,
				payload: error.payload,
			};
		});
}

const fixedFrameworkFailures = {
	DEADLINE_EXCEEDED: { status: 408, retryable: true, preCorrelation: true },
	INTERNAL: { status: 500, retryable: false, preCorrelation: false },
	NOT_FOUND: { status: 404, retryable: false, preCorrelation: false },
	PROTOCOL_UNSUPPORTED: { status: 400, retryable: false, preCorrelation: true },
	RESOURCE_LIMIT: { status: 429, retryable: true, preCorrelation: false },
	RUNTIME_UNAVAILABLE: { status: 503, retryable: true, preCorrelation: false },
	UNAUTHENTICATED: { status: 401, retryable: false, preCorrelation: false },
} as const;

function schemaReference(name: string): JsonSchema {
	return { $ref: `#/components/schemas/${name}` };
}

function appendResponseSchema(
	byStatus: Map<string, JsonSchema[]>,
	status: number,
	schema: JsonSchema,
): void {
	const key = String(status);
	byStatus.set(key, [...(byStatus.get(key) ?? []), schema]);
}

function operationResponses(
	operation: OperationContract,
	entry: DocumentationEntry | undefined,
): JsonRecord {
	const byStatus = new Map<string, JsonSchema[]>();
	for (const error of declaredErrors(operation)) {
		const status = String(error.status);
		const schemas = byStatus.get(status) ?? [];
		schemas.push(declaredResponseSchema(error.code, error.payload));
		byStatus.set(status, schemas);
	}
	for (const [code, contract] of Object.entries(fixedFrameworkFailures))
		appendResponseSchema(
			byStatus,
			contract.status,
			schemaReference(`FrameworkFailure_${code}`),
		);
	const kind = operationKind(operation.identity);
	if (kind === "mutation")
		appendResponseSchema(byStatus, 500, schemaReference("PostCommitAmbiguity"));
	if (kind === "action") {
		appendResponseSchema(
			byStatus,
			429,
			schemaReference("ActionPostHandlerResourceLimit"),
		);
		appendResponseSchema(
			byStatus,
			500,
			schemaReference("ActionOutcomeAmbiguous"),
		);
	}
	return {
		"200": {
			description: "Successful result",
			content: {
				"application/json": {
					schema: {
						type: "object",
						additionalProperties: false,
						properties: {
							callId: { type: "string" },
							result: projectCodec(operation.output),
						},
						required: ["callId", "result"],
					},
					...(entry?.examples?.some((example) => example.output !== undefined)
						? {
								examples: Object.fromEntries(
									entry.examples.flatMap((example, index) =>
										example.output === undefined
											? []
											: [
													[
														"example" + String(index + 1),
														{
															value: {
																callId: "openapi-example",
																result: example.output,
															},
														},
													],
												],
									),
								),
							}
						: {}),
				},
			},
		},
		...Object.fromEntries(
			[...byStatus.entries()]
				.sort(([left], [right]) => compareAscii(left, right))
				.map(([status, schemas]) => {
					const ordered = schemas.toSorted((left, right) =>
						compareAscii(canonicalBytes(left), canonicalBytes(right)),
					);
					return [
						status,
						{
							description: "Operation error",
							content: {
								"application/json": {
									schema:
										ordered.length === 1 ? ordered[0] : { oneOf: ordered },
								},
							},
						},
					] as const;
				}),
		),
	};
}

function requestExamples(
	entry: DocumentationEntry | undefined,
	contextCodec: unknown,
): JsonRecord | undefined {
	if (
		!entry?.examples ||
		entry.examples.length === 0 ||
		!contextAcceptsEmpty(contextCodec)
	)
		return undefined;
	return Object.fromEntries(
		entry.examples.map((example, index) => [
			"example" + String(index + 1),
			{ value: { context: {}, input: example.input } },
		]),
	);
}

function contextAcceptsEmpty(codec: unknown): boolean {
	try {
		decodeRuntimeCodec(normalizedCodec(codec) as never, {});
		return true;
	} catch {
		return false;
	}
}

function openApiOperation(
	operation: OperationContract,
	entry: DocumentationEntry | undefined,
	applicationName: string,
	contextCodec: unknown,
	compatibility: Readonly<{
		application: string;
		clientContractDigest: string;
		wireDigest: string;
	}>,
): JsonRecord {
	const kind = operationKind(operation.identity);
	const name = operationName(operation.identity);
	const examples = requestExamples(entry, contextCodec);
	const carrierHeaders = () =>
		projectOperationCarrierHeaders({
			kind,
			contextSchema: projectCodec(contextCodec),
			contextAcceptsEmpty: contextAcceptsEmpty(contextCodec),
			compatibility: {
				application: compatibility.application,
				clientContractDigest: compatibility.clientContractDigest,
				wireDigest: compatibility.wireDigest,
			},
		});
	return {
		operationId: name,
		tags: [operationTag(name, applicationName)],
		...(entry?.summary ? { summary: entry.summary } : {}),
		...(entry?.description ? { description: entry.description } : {}),
		...(kind === "query"
			? {
					parameters: [
						...queryParameters(operation.input, entry),
						...carrierHeaders(),
					].sort((left, right) =>
						compareAscii(String(left.name), String(right.name)),
					),
				}
			: {
					parameters: carrierHeaders(),
					requestBody: {
						required: true,
						content: {
							"application/json": {
								schema: {
									type: "object",
									additionalProperties: false,
									properties: {
										context: projectCodec(contextCodec),
										input: {
											...projectCodec(operation.input),
											...(entry?.examples
												? {
														examples: entry.examples.map(({ input }) => input),
													}
												: {}),
										},
									},
									required: ["context", "input"],
								},
								...(examples ? { examples } : {}),
							},
						},
					},
				}),
		responses: operationResponses(operation, entry),
	};
}

function frameworkFailureSchema(
	code: string,
	retryable: boolean,
	correlated: boolean,
): JsonSchema {
	return {
		type: "object",
		additionalProperties: false,
		properties: {
			...(correlated ? { callId: { type: "string" } } : {}),
			error: {
				type: "object",
				additionalProperties: false,
				properties: {
					code: { const: code },
					retryable: { const: retryable },
				},
				required: ["code", "retryable"],
			},
		},
		required: correlated ? ["callId", "error"] : ["error"],
	};
}

function frameworkSchemas(failures: readonly string[]): JsonRecord {
	const actual = [...failures].sort(compareAscii);
	const expected = [
		"COMMITTED_RESULT_UNAVAILABLE",
		...Object.keys(fixedFrameworkFailures),
	].sort(compareAscii);
	if (
		actual.length !== expected.length ||
		actual.some((failure, index) => failure !== expected[index])
	)
		return invalid("invalid framework failures in HTTP artifact");
	const schemas: Record<string, JsonSchema> = Object.create(null);
	for (const [code, contract] of Object.entries(fixedFrameworkFailures)) {
		const correlated = frameworkFailureSchema(code, contract.retryable, true);
		if (!contract.preCorrelation) {
			schemas[`FrameworkFailure_${code}`] = correlated;
			continue;
		}
		schemas[`Correlated_${code}`] = correlated;
		schemas[`PreCorrelation_${code}`] = frameworkFailureSchema(
			code,
			contract.retryable,
			false,
		);
		schemas[`FrameworkFailure_${code}`] = {
			oneOf: [
				schemaReference(`PreCorrelation_${code}`),
				schemaReference(`Correlated_${code}`),
			],
		};
	}
	return {
		...schemas,
		ActionPostHandlerResourceLimit: frameworkFailureSchema(
			"RESOURCE_LIMIT",
			false,
			true,
		),
		ActionOutcomeAmbiguous: {
			type: "object",
			additionalProperties: false,
			properties: {
				callId: { type: "string" },
				error: {
					type: "object",
					additionalProperties: false,
					properties: {
						code: { const: "ACTION_OUTCOME_AMBIGUOUS" },
						retryable: { const: false },
					},
					required: ["code", "retryable"],
				},
			},
			required: ["callId", "error"],
		},
		PostCommitAmbiguity: {
			type: "object",
			additionalProperties: false,
			properties: {
				callId: { type: "string" },
				error: {
					type: "object",
					additionalProperties: false,
					properties: {
						code: { const: "COMMITTED_RESULT_UNAVAILABLE" },
						retryable: { const: true },
						transactionId: { type: "string" },
					},
					required: ["code", "retryable", "transactionId"],
				},
			},
			required: ["callId", "error"],
		},
	};
}

export function projectOperationProjection(
	input: OperationProjectionInput,
): OperationProjection {
	const network = [...input.httpContract.operations].sort((left, right) =>
		compareAscii(left.identity, right.identity),
	);
	const metadata = projectOperationMetadata({
		documentationBytes: input.documentationBytes,
		documentationDigest: input.documentationDigest,
		httpContractDigest: input.httpContract.digest,
		operationContracts: input.operationContracts.operations,
		networkOperations: network,
		origins: input.originMap.resources,
	});
	const paths = Object.fromEntries(
		network.map((operation) => {
			const kind = operationKind(operation.identity);
			const name = operationName(operation.identity);
			return [
				"/_questpie/" + kind + "/" + name,
				{
					[kind === "query" ? "get" : "post"]: openApiOperation(
						operation,
						metadata.documentationByIdentity.get(operation.identity),
						input.applicationName,
						input.contextCodec,
						{
							application: input.httpContract.application,
							clientContractDigest: input.httpContract.clientContractDigest,
							wireDigest: input.httpContract.digest,
						},
					),
				},
			];
		}),
	);
	const openapi = {
		openapi: "3.1.0",
		info: {
			title: input.applicationName,
			version: input.httpContract.clientContractDigest,
			"x-questpie-operation-documentation-digest": input.documentationDigest,
			"x-questpie-operation-http-digest": input.httpContract.digest,
		},
		paths,
		components: { schemas: frameworkSchemas(input.httpContract.failures) },
	};
	return {
		openapi,
		openapiBytes: canonicalBytes(openapi),
		explain: metadata.explain,
		explainBytes: canonicalBytes(metadata.explain),
		jsdoc: metadata.jsdoc,
	};
}
