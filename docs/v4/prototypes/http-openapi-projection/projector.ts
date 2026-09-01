import { compareAscii } from "../../../../packages/compiler/src/canonical";
import type { NormalizedResource } from "../../../../packages/compiler/src/types";
import { projectCodecJsonSchema, type JsonSchema } from "./codec-schema";

type Origin = NormalizedResource["origin"];

export type OpenApiSchema = JsonSchema &
	Readonly<{
		oneOf?: readonly OpenApiSchema[];
		properties?: Readonly<Record<string, OpenApiSchema>>;
		required?: readonly string[];
	}>;

type OpenApiRequestBranch = OpenApiSchema &
	Readonly<{
		properties: Readonly<Record<string, OpenApiSchema>>;
		required: readonly string[];
	}>;

type OpenApiPost = Readonly<{
	operationId: "questpie.operation";
	requestBody: Readonly<{
		required: true;
		content: Readonly<
			Record<
				string,
				Readonly<{
					schema: Readonly<{ oneOf: readonly OpenApiRequestBranch[] }>;
				}>
			>
		>;
	}>;
	responses: Readonly<Record<string, unknown>>;
}>;

export type OpenApiProjection = Readonly<{
	openapi: "3.1.0";
	info: Readonly<{ title: string; version: string }>;
	paths: Readonly<Record<string, Readonly<{ post: OpenApiPost }>>>;
	"x-questpie-source-artifacts": Readonly<{
		clientContractDigest: string;
		wireDigest: string;
	}>;
	"x-questpie-diagnostics": readonly Readonly<{
		code: "QP-OPENAPI-001";
		diagnosticClass: "unsupportedContract";
		identity: string;
		origin: Origin;
		reason: "rawRequestResponseRoute";
	}>[];
}>;

type NetworkOperation = Readonly<{
	identity: string;
	kind: "action" | "mutation" | "query";
	contract: Readonly<Record<string, unknown>>;
	origin: Origin;
}>;

function networkOperations(
	resources: readonly NormalizedResource[],
): NetworkOperation[] {
	return resources
		.filter(
			(resource) =>
				(resource.kind === "query" ||
					resource.kind === "mutation" ||
					resource.kind === "action") &&
				resource.contract.exposure === "network",
		)
		.map((resource) => ({
			identity: resource.identity,
			kind: resource.kind as NetworkOperation["kind"],
			contract: resource.contract,
			origin: resource.origin,
		}))
		.sort((left, right) => compareAscii(left.identity, right.identity));
}

function protocolSchema(): OpenApiSchema {
	return {
		type: "object",
		additionalProperties: false,
		properties: {
			name: { const: "questpie.operation" },
			version: { const: 1 },
		},
		required: ["name", "version"],
	};
}

function requestBranch(
	operation: NetworkOperation,
	input: Readonly<{
		application: string;
		clientContractDigest: string;
		context: unknown;
		wireDigest: string;
	}>,
): OpenApiRequestBranch {
	const action = operation.kind === "action";
	return {
		type: "object",
		additionalProperties: false,
		properties: {
			application: { const: input.application },
			callId: { type: "string", minLength: 1, maxLength: 1_024 },
			clientContractDigest: { const: input.clientContractDigest },
			context: projectCodecJsonSchema(input.context),
			...(action
				? { effectKey: { type: "string", minLength: 1, maxLength: 1_024 } }
				: {}),
			input: projectCodecJsonSchema(operation.contract.input),
			operation: { const: operation.identity },
			protocol: protocolSchema(),
			timeoutMilliseconds: action
				? { anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }] }
				: { type: "integer", minimum: 1 },
			wireDigest: { const: input.wireDigest },
		},
		required: [
			"application",
			"callId",
			"clientContractDigest",
			"context",
			...(action ? ["effectKey"] : []),
			"input",
			"operation",
			"protocol",
			"timeoutMilliseconds",
			"wireDigest",
		],
		"x-questpie-operation": {
			identity: operation.identity,
			kind: operation.kind,
			origin: operation.origin,
			...(action ? { limits: operation.contract.limits } : {}),
		},
	};
}

function resultBranch(operation: NetworkOperation): OpenApiSchema {
	return {
		type: "object",
		additionalProperties: false,
		properties: {
			callId: { type: "string" },
			kind: { const: "result" },
			operation: { const: operation.identity },
			payload: projectCodecJsonSchema(operation.contract.output),
			protocol: protocolSchema(),
		},
		required: ["callId", "kind", "operation", "payload", "protocol"],
	};
}

function declaredResponses(
	operations: readonly NetworkOperation[],
	mediaType: string,
) {
	const byStatus = new Map<number, OpenApiSchema[]>();
	for (const operation of operations) {
		const errors = operation.contract.declaredErrors;
		if (!errors || typeof errors !== "object" || Array.isArray(errors))
			continue;
		for (const [, value] of Object.entries(errors).sort(([left], [right]) =>
			compareAscii(left, right),
		)) {
			if (!value || typeof value !== "object" || Array.isArray(value)) continue;
			const error = value as Readonly<Record<string, unknown>>;
			if (typeof error.status !== "number" || typeof error.code !== "string")
				continue;
			const branches = byStatus.get(error.status) ?? [];
			branches.push({
				type: "object",
				additionalProperties: false,
				properties: {
					callId: { type: "string" },
					error: {
						type: "object",
						additionalProperties: false,
						properties: {
							code: { const: error.code },
							payload:
								error.payload === null
									? { type: "null" }
									: projectCodecJsonSchema(error.payload),
							status: { const: error.status },
						},
						required: ["code", "payload", "status"],
					},
					kind: { const: "declaredError" },
					operation: { const: operation.identity },
					protocol: protocolSchema(),
				},
				required: ["callId", "error", "kind", "operation", "protocol"],
			});
			byStatus.set(error.status, branches);
		}
	}
	return Object.fromEntries(
		[...byStatus.entries()]
			.sort(([left], [right]) => left - right)
			.map(([status, oneOf]) => [
				String(status),
				{
					description: "Declared Operation error",
					content: { [mediaType]: { schema: { oneOf } } },
				},
			]),
	);
}

export function projectOpenApi(
	input: Readonly<{
		application: string;
		clientContractDigest: string;
		context: unknown;
		mediaType: string;
		path: string;
		resources: readonly NormalizedResource[];
		wireDigest: string;
	}>,
): OpenApiProjection {
	const operations = networkOperations(input.resources);
	const diagnostics = input.resources
		.filter((resource) => resource.kind === "route")
		.sort((left, right) => compareAscii(left.identity, right.identity))
		.map((resource) => ({
			code: "QP-OPENAPI-001" as const,
			diagnosticClass: "unsupportedContract" as const,
			identity: resource.identity,
			origin: resource.origin,
			reason: "rawRequestResponseRoute" as const,
		}));
	return {
		openapi: "3.1.0",
		info: { title: input.application, version: input.clientContractDigest },
		paths: {
			[input.path]: {
				post: {
					operationId: "questpie.operation",
					requestBody: {
						required: true,
						content: {
							[input.mediaType]: {
								schema: {
									oneOf: operations.map((operation) =>
										requestBranch(operation, input),
									),
								},
							},
						},
					},
					responses: {
						"200": {
							description: "Operation result",
							content: {
								[input.mediaType]: {
									schema: {
										oneOf: operations.map(resultBranch),
									},
								},
							},
						},
						...declaredResponses(operations, input.mediaType),
					},
				},
			},
		},
		"x-questpie-source-artifacts": {
			clientContractDigest: input.clientContractDigest,
			wireDigest: input.wireDigest,
		},
		"x-questpie-diagnostics": diagnostics,
	};
}
