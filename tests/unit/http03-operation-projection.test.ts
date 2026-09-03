import { describe, expect, test } from "bun:test";

import { digest } from "../../packages/compiler/src/canonical";
import { CompilerDiagnosticError } from "../../packages/compiler/src/diagnostic";
import { projectOperationProjection } from "../../packages/compiler/src/http";

const uuid = "018f5f6e-5f2c-7b41-a854-3d9a6b6b7131";
const inputCodec = {
	kind: "object",
	properties: {
		id: { kind: "uuid" },
		search: { kind: "optional", codec: { kind: "text", maxLength: 80 } },
	},
} as const;
const outputCodec = {
	kind: "object",
	properties: {
		id: { kind: "uuid" },
		title: { kind: "text", maxLength: 120 },
	},
} as const;
const mutationInputCodec = {
	kind: "object",
	properties: {
		id: { kind: "uuid" },
		title: { kind: "text", maxLength: 120 },
	},
} as const;

const documentation = {
	format: "questpie.operation-documentation",
	version: 1,
	operations: [
		{ identity: "action:exports.run", summary: "Export tickets" },
		{
			identity: "mutation:tickets.assign",
			summary: "Assign a ticket",
			description:
				'Keeps */ quotes " and line feeds inert.\n@deprecated not a tag.\n  @authority also not a tag.\nNext.\u2028Third.\u2029Fourth.',
			examples: [
				{
					input: { id: uuid, title: "New owner" },
					output: { id: uuid, title: "New owner" },
				},
			],
		},
		{ identity: "query:health", summary: "Read server health" },
		{
			identity: "query:tickets.detail",
			summary: "Read a ticket",
			description: "Returns one Policy-visible ticket.",
		},
	],
} as const;
const documentationBytes = JSON.stringify(documentation) + "\n";
const documentationDigest = digest(
	"questpie-operation-documentation-v1",
	documentation,
);

const operationContracts = {
	format: "questpie.operation-contracts",
	version: 1,
	operations: [
		{
			identity: "action:exports.run",
			input: { kind: "object", properties: {} },
			output: { kind: "object", properties: {} },
			declaredErrors: [],
		},
		{
			identity: "mutation:tickets.assign",
			input: mutationInputCodec,
			output: outputCodec,
			declaredErrors: [
				{
					key: "invalidTicket",
					code: "INVALID_TICKET",
					status: 422,
					payload: {
						kind: "object",
						properties: { field: { kind: "text", maxLength: 40 } },
					},
				},
			],
		},
		{
			identity: "query:health",
			input: { kind: "object", properties: {} },
			output: { kind: "object", properties: { ready: { kind: "boolean" } } },
			declaredErrors: [],
		},
		{
			identity: "query:tickets.detail",
			input: inputCodec,
			output: outputCodec,
			declaredErrors: [],
		},
	],
} as const;

const httpUnsigned = {
	format: "questpie.operation-http",
	version: 1,
	application: "application:support",
	operations: operationContracts.operations.filter(
		(operation) => operation.identity !== "query:health",
	),
	failures: [
		"COMMITTED_RESULT_UNAVAILABLE",
		"DEADLINE_EXCEEDED",
		"INTERNAL",
		"NOT_FOUND",
		"PROTOCOL_UNSUPPORTED",
		"RESOURCE_LIMIT",
		"RUNTIME_UNAVAILABLE",
		"UNAUTHENTICATED",
	],
	limits: { requestBytes: 1_048_576, responseBytes: 1_048_576 },
	principalSource: "ingressOutsideBody",
	mutationAutomaticRetry: false,
	clientContractDigest: "1".repeat(64),
} as const;
const httpContract = {
	...httpUnsigned,
	digest: digest("questpie-operation-http-v1", httpUnsigned),
};

const originMap = {
	format: "questpie.origin-map",
	version: 1,
	resources: [
		["action:exports.run", "src/exports.ts", "exportTickets"],
		["mutation:tickets.assign", "src/tickets.ts", "assignTicket"],
		["query:health", "src/health.ts", "health"],
		["query:tickets.detail", "packages/support/src/tickets.ts", "detail"],
		["route:webhook", "src/webhook.ts", "webhook"],
	].map(([identity, path, exportName]) => ({
		identity,
		establishedAt: {
			kind: "export",
			packageId: path.startsWith("packages/") ? "package:support" : null,
			path,
			exportName,
			span: null,
			declaredAt: null,
		},
	})),
} as const;

const emptyContextCodec = {
	kind: "object",
	properties: {
		locale: {
			kind: "optional",
			codec: { kind: "text", maxLength: 8 },
		},
	},
} as const;

function project(contextCodec: unknown = emptyContextCodec) {
	return projectOperationProjection({
		applicationName: "support",
		contextCodec,
		httpContract,
		operationContracts,
		documentationBytes,
		documentationDigest,
		originMap,
	});
}

describe("HTTP-03 / DOC-02 operation projection", () => {
	test("projects one deterministic OpenAPI 3.1 document from canonical artifacts", () => {
		const first = project();
		const second = project();
		expect(second.openapiBytes).toBe(first.openapiBytes);
		expect(JSON.parse(first.openapiBytes)).toEqual(first.openapi);
		expect(first.openapi).toMatchObject({
			openapi: "3.1.0",
			info: {
				title: "support",
				version: httpContract.clientContractDigest,
				"x-questpie-operation-documentation-digest": documentationDigest,
				"x-questpie-operation-http-digest": httpContract.digest,
			},
		});
		expect(first.openapi).not.toHaveProperty("servers");
		expect(first.openapi).not.toHaveProperty("security");
		expect(first.openapi).not.toHaveProperty("tags");
		expect(Object.keys(first.openapi.paths)).toEqual([
			"/_questpie/action/exports.run",
			"/_questpie/mutation/tickets.assign",
			"/_questpie/query/tickets.detail",
		]);

		const query = first.openapi.paths["/_questpie/query/tickets.detail"].get;
		expect(query).toMatchObject({
			operationId: "tickets.detail",
			tags: ["tickets"],
			summary: "Read a ticket",
			description: "Returns one Policy-visible ticket.",
		});
		const queryInputs = query.parameters.filter(
			({ in: location }: { in: string }) => location === "query",
		);
		expect(queryInputs).toEqual([
			expect.objectContaining({
				in: "query",
				name: "id",
				required: true,
				schema: expect.objectContaining({
					type: "string",
					pattern:
						"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
					"x-questpie-decoded-schema": expect.objectContaining({
						type: "string",
						format: "uuid",
					}),
					"x-questpie-http-encoding": "canonical-lexical",
				}),
			}),
			expect.objectContaining({
				in: "query",
				name: "search",
				required: false,
				schema: expect.objectContaining({
					type: "string",
					"x-questpie-decoded-schema": expect.objectContaining({
						type: "string",
						maxLength: 80,
					}),
					"x-questpie-http-encoding": "canonical-lexical",
				}),
			}),
		]);
		const contextParameter = query.parameters.find(
			(parameter: { name: string }) => parameter.name === "Questpie-Context",
		);
		expect(contextParameter.schema).toMatchObject({
			type: "string",
			default: "e30",
			pattern: "^[A-Za-z0-9_-]+$",
			"x-questpie-decoded-schema": expect.objectContaining({ type: "object" }),
			"x-questpie-http-encoding": "canonical-json-base64url",
		});
		expect(query.parameters.map(({ name }: { name: string }) => name)).toEqual(
			query.parameters.map(({ name }: { name: string }) => name).toSorted(),
		);
		expect(query.parameters).toContainEqual(
			expect.objectContaining({
				in: "header",
				name: "Questpie-Context",
				required: false,
			}),
		);
		const requiredContextQuery = project({
			kind: "object",
			properties: { locale: { kind: "text", maxLength: 8 } },
		}).openapi.paths["/_questpie/query/tickets.detail"].get;
		expect(requiredContextQuery.parameters).toContainEqual(
			expect.objectContaining({
				in: "header",
				name: "Questpie-Context",
				required: true,
				schema: expect.not.objectContaining({ default: expect.anything() }),
			}),
		);
		for (const [name, value] of [
			["Questpie-Application", httpContract.application],
			["Questpie-Client-Contract", httpContract.clientContractDigest],
			["Questpie-Wire-Digest", httpContract.digest],
		] as const) {
			const parameter = first.openapi.components.parameters[name];
			expect(parameter).toMatchObject({
				required: false,
				schema: { const: value, default: value, type: "string" },
			});
		}
		expect(first.openapi.components.parameters).toHaveProperty(
			"Questpie-Call-Id",
		);
		expect(first.openapi.components.parameters).toHaveProperty(
			"Questpie-Timeout-Milliseconds",
		);
		expect(
			query.parameters.filter(
				(parameter: { in: string }) => parameter.in === "header",
			),
		).toEqual([contextParameter]);
		expect(query).not.toHaveProperty("requestBody");

		const mutation =
			first.openapi.paths["/_questpie/mutation/tickets.assign"].post;
		expect(mutation.operationId).toBe("tickets.assign");
		expect(mutation.tags).toEqual(["tickets"]);
		expect(
			mutation.requestBody.content["application/json"].schema,
		).toMatchObject({
			type: "object",
			additionalProperties: false,
			required: ["context", "input"],
			properties: {
				context: expect.objectContaining({ type: "object" }),
				input: expect.objectContaining({ type: "object" }),
			},
		});
		expect(mutation.parameters).toContainEqual(
			expect.objectContaining({
				in: "header",
				name: "Idempotency-Key",
				required: true,
			}),
		);
		expect(
			mutation.parameters.map(({ name }: { name: string }) => name),
		).toEqual(
			mutation.parameters.map(({ name }: { name: string }) => name).toSorted(),
		);
		expect(
			JSON.stringify(mutation.requestBody.content["application/json"].examples),
		).toContain('"context":{}');
		expect(
			JSON.stringify(
				mutation.responses["200"].content["application/json"].examples,
			),
		).toContain('"callId":"openapi-example"');
		expect(
			mutation.responses["200"].content["application/json"].schema,
		).toMatchObject({
			type: "object",
			required: ["callId", "result"],
			properties: {
				callId: { type: "string" },
				result: expect.objectContaining({ type: "object" }),
			},
		});
		expect(mutation.responses["422"]).toMatchObject({
			content: {
				"application/json": {
					schema: expect.objectContaining({
						type: "object",
						required: ["callId", "error"],
					}),
				},
			},
		});
		for (const failure of httpContract.failures.filter(
			(failure) => failure !== "COMMITTED_RESULT_UNAVAILABLE",
		))
			expect(first.openapi.components.schemas).toHaveProperty(
				"FrameworkFailure_" + failure,
			);
		const action = first.openapi.paths["/_questpie/action/exports.run"].post;
		expect(action.parameters).toContainEqual(
			expect.objectContaining({
				in: "header",
				name: "Effect-Key",
				required: true,
			}),
		);
		expect(first.openapi.components.schemas).toHaveProperty(
			"ActionOutcomeAmbiguous",
		);
		expect(first.openapi.components.schemas).toHaveProperty(
			"PostCommitAmbiguity",
		);
		expect(
			mutation.responses["500"].content["application/json"].schema,
		).toEqual({
			oneOf: [
				{ $ref: "#/components/schemas/FrameworkFailure_INTERNAL" },
				{ $ref: "#/components/schemas/PostCommitAmbiguity" },
			],
		});
		expect(action.responses["500"].content["application/json"].schema).toEqual({
			oneOf: [
				{ $ref: "#/components/schemas/ActionOutcomeAmbiguous" },
				{ $ref: "#/components/schemas/FrameworkFailure_INTERNAL" },
			],
		});
		expect(action.responses["429"].content["application/json"].schema).toEqual({
			oneOf: [
				{ $ref: "#/components/schemas/ActionPostHandlerResourceLimit" },
				{ $ref: "#/components/schemas/FrameworkFailure_RESOURCE_LIMIT" },
			],
		});
		expect(
			first.openapi.components.schemas.FrameworkFailure_INTERNAL,
		).toMatchObject({
			required: ["callId", "error"],
			properties: {
				error: {
					properties: { retryable: { const: false } },
				},
			},
		});
		expect(
			first.openapi.components.schemas.FrameworkFailure_PROTOCOL_UNSUPPORTED,
		).toEqual({
			oneOf: [
				{ $ref: "#/components/schemas/PreCorrelation_PROTOCOL_UNSUPPORTED" },
				{ $ref: "#/components/schemas/Correlated_PROTOCOL_UNSUPPORTED" },
			],
		});
	});

	test("projects input examples independently from an empty Context value", () => {
		const nonEmptyContext = {
			kind: "object",
			properties: { locale: { kind: "text", maxLength: 8 } },
		} as const;
		const projected = projectOperationProjection({
			applicationName: "support",
			contextCodec: nonEmptyContext,
			httpContract,
			operationContracts,
			documentationBytes:
				JSON.stringify({
					...documentation,
					operations: documentation.operations.map((entry) =>
						entry.identity === "query:tickets.detail"
							? {
									...entry,
									examples: [{ input: { id: uuid, search: "~owner" } }],
								}
							: entry,
					),
				}) + "\n",
			documentationDigest: digest("questpie-operation-documentation-v1", {
				...documentation,
				operations: documentation.operations.map((entry) =>
					entry.identity === "query:tickets.detail"
						? {
								...entry,
								examples: [{ input: { id: uuid, search: "~owner" } }],
							}
						: entry,
				),
			}),
			originMap,
		});
		const query =
			projected.openapi.paths["/_questpie/query/tickets.detail"].get;
		expect(
			query.parameters.find(({ name }: { name: string }) => name === "id")
				.examples,
		).toEqual({
			example1: { value: uuid },
		});
		expect(
			query.parameters.find(({ name }: { name: string }) => name === "search")
				.examples,
		).toEqual({
			example1: { value: "~text:~owner" },
		});
		const mutation =
			projected.openapi.paths["/_questpie/mutation/tickets.assign"].post;
		expect(mutation.requestBody.content["application/json"]).not.toHaveProperty(
			"examples",
		);
		expect(
			mutation.requestBody.content["application/json"].schema.properties.input
				.examples,
		).toEqual([{ id: uuid, title: "New owner" }]);
	});

	test("reports exact inclusion and nondisclosing omissions with Origins", () => {
		const { explain } = project();
		expect(explain).toMatchObject({
			format: "questpie.operation-projection-explain",
			version: 1,
			documentationDigest,
			httpContractDigest: httpContract.digest,
		});
		expect(explain.operations).toContainEqual(
			expect.objectContaining({
				identity: "query:tickets.detail",
				disposition: "included",
				origin: expect.objectContaining({
					packageId: "package:support",
					path: "packages/support/src/tickets.ts",
				}),
			}),
		);
		expect(explain.operations).toContainEqual(
			expect.objectContaining({
				identity: "query:health",
				disposition: "omitted",
				reason: "directOnly",
			}),
		);
		expect(explain.operations).toContainEqual(
			expect.objectContaining({
				identity: "route:webhook",
				disposition: "omitted",
				reason: "rawRouteUnsupported",
			}),
		);
		const bytes = JSON.stringify(explain);
		for (const secret of [
			"policy",
			"principal",
			"credential",
			"handler",
			"sql",
		])
			expect(bytes.toLowerCase()).not.toContain(secret);
	});

	test("renders hostile documentation as inert deterministic JSDoc", () => {
		const comments = project().jsdoc;
		const assignment = comments["mutation:tickets.assign"];
		expect(assignment).toContain("Assign a ticket");
		expect(assignment).not.toContain("*/ quotes");
		expect(assignment).not.toContain("\u2028");
		expect(assignment).not.toContain("\u2029");
		expect(assignment.match(/\*\//gu)).toHaveLength(1);
		expect(assignment).toContain("\\@deprecated not a tag.");
		expect(assignment).toContain("  \\@authority also not a tag.");
		expect(assignment).not.toMatch(/^ \*\s+@/gmu);
	});

	test("rejects cross-kind OpenAPI operationId collisions with both Origins", () => {
		const duplicate = {
			...operationContracts.operations[3],
			identity: "query:tickets.assign",
		};
		try {
			projectOperationProjection({
				applicationName: "support",
				contextCodec: emptyContextCodec,
				httpContract: {
					...httpContract,
					operations: [...httpContract.operations, duplicate],
				},
				operationContracts: {
					...operationContracts,
					operations: [...operationContracts.operations, duplicate],
				},
				documentationBytes,
				documentationDigest,
				originMap: {
					...originMap,
					resources: [
						...originMap.resources,
						{
							identity: duplicate.identity,
							establishedAt: {
								kind: "export",
								packageId: null,
								path: "src/tickets-query.ts",
								exportName: "assignTicketQuery",
								span: null,
								declaredAt: null,
							},
						},
					],
				},
			});
			throw new Error("expected OpenAPI operationId collision");
		} catch (error) {
			expect(error).toBeInstanceOf(CompilerDiagnosticError);
			expect((error as CompilerDiagnosticError).code).toBe("QP-COMPOSE-029");
			expect((error as CompilerDiagnosticError).details.reason).toBe(
				"openApiOperationIdCollision",
			);
			expect((error as CompilerDiagnosticError).details.origins).toHaveLength(
				2,
			);
		}
	});
});
