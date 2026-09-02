import { describe, expect, test } from "bun:test";

import { digest } from "../../packages/compiler/src/canonical";
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
				'Keeps */ quotes " and line feeds inert.\nNext.\u2028Third.\u2029Fourth.',
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
		"APPLICATION_MISMATCH",
		"CLIENT_OUTDATED",
		"COMMITTED_RESULT_UNAVAILABLE",
		"DEADLINE_EXCEEDED",
		"INTERNAL",
		"NOT_FOUND",
		"PROTOCOL_UNSUPPORTED",
		"RESOURCE_LIMIT",
		"RUNTIME_UNAVAILABLE",
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
		expect(
			query.parameters.filter(
				({ in: location }: { in: string }) => location === "query",
			),
		).toEqual([
			expect.objectContaining({ in: "query", name: "id", required: true }),
			expect.objectContaining({ in: "query", name: "search", required: false }),
		]);
		expect(query.parameters).toContainEqual(
			expect.objectContaining({
				in: "header",
				name: "Questpie-Context",
				required: false,
			}),
		);
		expect(query).not.toHaveProperty("requestBody");

		const mutation =
			first.openapi.paths["/_questpie/mutation/tickets.assign"].post;
		expect(mutation.operationId).toBe("tickets.assign");
		expect(mutation.tags).toEqual(["tickets"]);
		expect(
			mutation.requestBody.content["application/json"].schema,
		).toBeDefined();
		expect(
			mutation.requestBody.content["application/json"].examples,
		).toBeDefined();
		expect(mutation.responses["200"]).toBeDefined();
		expect(mutation.responses["422"]).toMatchObject({
			content: {
				"application/json": {
					schema: expect.objectContaining({ type: "object" }),
				},
			},
		});
		for (const failure of httpContract.failures)
			expect(first.openapi.components.schemas).toHaveProperty(
				"FrameworkFailure_" + failure,
			);
		expect(first.openapi.components.schemas).toHaveProperty(
			"PostCommitAmbiguity",
		);
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
		expect(assignment).not.toContain("@deprecated");
		expect(assignment).not.toContain("@authority");
	});
});
