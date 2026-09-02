import { decodeRuntimeCodec } from "@questpie/runtime/codec";

import { canonicalBytes, compareAscii, digest } from "../canonical";
import { normalizeCodecContract } from "../codec";

type JsonRecord = Readonly<Record<string, unknown>>;
type JsonSchema = Readonly<Record<string, unknown>>;

type OperationContract = Readonly<{
	identity: string;
	input: unknown;
	output: unknown;
	declaredErrors: unknown;
}>;

type DocumentationEntry = Readonly<{
	identity: string;
	summary: string;
	description?: string;
	examples?: readonly Readonly<{ input: unknown; output?: unknown }>[];
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

function documentationEntries(
	input: OperationProjectionInput,
): DocumentationEntry[] {
	const artifact = record(JSON.parse(input.documentationBytes));
	if (
		artifact.format !== "questpie.operation-documentation" ||
		artifact.version !== 1 ||
		!Array.isArray(artifact.operations) ||
		digest("questpie-operation-documentation-v1", artifact) !==
			input.documentationDigest
	)
		return invalid("operation documentation digest mismatch");
	return (artifact.operations as DocumentationEntry[]).toSorted((left, right) =>
		compareAscii(left.identity, right.identity),
	);
}

function escapeJsDoc(value: string): string {
	return value
		.replaceAll("*/", "*\\/")
		.replaceAll("\u2028", "\\u2028")
		.replaceAll("\u2029", "\\u2029");
}

function renderJsDoc(entry: DocumentationEntry): string {
	const lines = [
		entry.summary,
		...(entry.description ? ["", entry.description] : []),
	]
		.flatMap((line) => escapeJsDoc(line).split("\n"))
		.map((line) => (line.length === 0 ? " *" : " * " + line));
	return ["/**", ...lines, " */"].join("\n");
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

function queryParameters(input: unknown): readonly JsonRecord[] {
	const codec = normalizedCodec(input);
	if (codec.kind !== "object")
		return invalid("canonical Query input must be an object");
	return Object.entries(record(codec.properties))
		.sort(([left], [right]) => compareAscii(left, right))
		.map(([name, child]) => {
			const childCodec = record(child);
			return {
				name,
				in: "query",
				required: childCodec.kind !== "optional",
				schema: projectNormalizedCodec(childCodec),
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
				.map(([status, schemas]) => [
					status,
					{
						description: "Declared Operation error",
						content: {
							"application/json": {
								schema: schemas.length === 1 ? schemas[0] : { oneOf: schemas },
							},
						},
					},
				]),
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

function headerParameter(
	name: string,
	required: boolean,
	schema: JsonSchema = { type: "string" },
): JsonRecord {
	return { name, in: "header", required, schema };
}

function contextAcceptsEmpty(codec: unknown): boolean {
	try {
		decodeRuntimeCodec(normalizedCodec(codec) as never, {});
		return true;
	} catch {
		return false;
	}
}

function carrierHeaders(
	kind: "action" | "mutation" | "query",
	contextCodec: unknown,
): JsonRecord[] {
	return [
		...(kind === "query"
			? [
					headerParameter(
						"Questpie-Context",
						!contextAcceptsEmpty(contextCodec),
					),
				]
			: kind === "mutation"
				? [headerParameter("Idempotency-Key", true)]
				: [headerParameter("Effect-Key", true)]),
		...(kind === "mutation"
			? []
			: [headerParameter("Questpie-Call-Id", false)]),
		headerParameter("Questpie-Timeout-Milliseconds", false, {
			type: "integer",
			minimum: 1,
		}),
		headerParameter("Questpie-Application", false),
		headerParameter("Questpie-Client-Contract", false),
		headerParameter("Questpie-Wire-Digest", false),
	];
}

function openApiOperation(
	operation: OperationContract,
	entry: DocumentationEntry | undefined,
	applicationName: string,
	contextCodec: unknown,
): JsonRecord {
	const kind = operationKind(operation.identity);
	const name = operationName(operation.identity);
	const examples = requestExamples(entry, contextCodec);
	return {
		operationId: name,
		tags: [operationTag(name, applicationName)],
		...(entry?.summary ? { summary: entry.summary } : {}),
		...(entry?.description ? { description: entry.description } : {}),
		...(kind === "query"
			? {
					parameters: [
						...queryParameters(operation.input),
						...carrierHeaders(kind, contextCodec),
					],
				}
			: {
					parameters: carrierHeaders(kind, contextCodec),
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
											...(examples
												? {
														examples: entry!.examples!.map(
															({ input }) => input,
														),
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

function frameworkSchemas(failures: readonly string[]): JsonRecord {
	const schemas = Object.fromEntries(
		[...failures].sort(compareAscii).map((failure) => [
			"FrameworkFailure_" + failure,
			{
				type: "object",
				additionalProperties: false,
				properties: {
					callId: { type: "string" },
					error: {
						type: "object",
						additionalProperties: false,
						properties: {
							code: { const: failure },
							retryable: { type: "boolean" },
						},
						required: ["code", "retryable"],
					},
				},
				required: ["error"],
			},
		]),
	);
	return {
		...schemas,
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

function projectionExplanation(
	input: OperationProjectionInput,
	networkIdentities: ReadonlySet<string>,
): JsonRecord & Readonly<{ operations: readonly JsonRecord[] }> {
	const direct = new Set(
		input.operationContracts.operations.map(({ identity }) => identity),
	);
	const operations = input.originMap.resources
		.filter(
			({ identity }) => direct.has(identity) || identity.startsWith("route:"),
		)
		.map(({ identity, establishedAt }) =>
			networkIdentities.has(identity)
				? {
						identity,
						disposition: "included",
						origin: establishedAt,
					}
				: {
						identity,
						disposition: "omitted",
						reason: identity.startsWith("route:")
							? "rawRouteUnsupported"
							: "directOnly",
						origin: establishedAt,
					},
		)
		.sort((left, right) =>
			compareAscii(String(left.identity), String(right.identity)),
		);
	return {
		format: "questpie.operation-projection-explain",
		version: 1,
		documentationDigest: input.documentationDigest,
		httpContractDigest: input.httpContract.digest,
		operations,
	};
}

export function projectOperationProjection(
	input: OperationProjectionInput,
): OperationProjection {
	const documentation = documentationEntries(input);
	const documentationByIdentity = new Map(
		documentation.map((entry) => [entry.identity, entry]),
	);
	const network = [...input.httpContract.operations].sort((left, right) =>
		compareAscii(left.identity, right.identity),
	);
	const paths = Object.fromEntries(
		network.map((operation) => {
			const kind = operationKind(operation.identity);
			const name = operationName(operation.identity);
			return [
				"/_questpie/" + kind + "/" + name,
				{
					[kind === "query" ? "get" : "post"]: openApiOperation(
						operation,
						documentationByIdentity.get(operation.identity),
						input.applicationName,
						input.contextCodec,
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
	const explain = projectionExplanation(
		input,
		new Set(network.map(({ identity }) => identity)),
	);
	const jsdoc = Object.fromEntries(
		documentation.map((entry) => [entry.identity, renderJsDoc(entry)]),
	);
	return {
		openapi,
		openapiBytes: canonicalBytes(openapi),
		explain,
		explainBytes: canonicalBytes(explain),
		jsdoc,
	};
}
