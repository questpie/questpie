import { expect, test } from "bun:test";

import { compileMcpProjection, type NetworkOperation } from "./projection";

const objectSchema = Object.freeze({
	type: "object",
	additionalProperties: false,
});
const notFoundSchema = Object.freeze({
	type: "object",
	additionalProperties: false,
	properties: Object.freeze({
		error: Object.freeze({
			type: "object",
			additionalProperties: false,
			properties: Object.freeze({
				code: Object.freeze({ const: "NOT_FOUND" }),
				retryable: Object.freeze({ const: false }),
			}),
			required: Object.freeze(["code", "retryable"]),
		}),
	}),
	required: Object.freeze(["error"]),
});
const applicationOrigin = Object.freeze({
	exportName: "ticketDetail",
	logicalPath: "src/tickets.ts",
	packageId: null,
});
const invocationSchemas = Object.freeze({
	callIdSchema: Object.freeze({
		type: "string",
		minLength: 1,
		maxLength: 256,
	}),
	effectKeySchema: Object.freeze({
		type: "string",
		minLength: 1,
		maxLength: 256,
	}),
});

function operation(
	kind: NetworkOperation["kind"],
	name = `tickets.${kind}`,
): NetworkOperation {
	return Object.freeze({
		kind,
		name,
		network: true,
		origin: applicationOrigin,
		inputSchema: objectSchema,
		contextSchema: objectSchema,
		outputSchema: { type: "string" },
		frameworkFailureSchemas: [notFoundSchema],
		documentation: {
			summary: `Run ${kind}`,
			description: `Uses the canonical ${kind} executor.`,
			examples: [{ input: {}, output: `${kind}-result` }],
		},
	});
}

test("derives documentation, outcomes, and disjoint invocation metadata from canonical owners", () => {
	const compiled = compileMcpProjection({
		enabled: true,
		operationContractDigest: "operation-contract-digest",
		operationDocumentationDigest: "operation-documentation-digest",
		...invocationSchemas,
		operations: [
			operation("query"),
			operation("mutation"),
			operation("action"),
		],
	});
	if (compiled === null) throw new Error("selected MCP projection was omitted");

	expect(compiled?.artifact).toMatchObject({
		format: "questpie.mcp-projection",
		version: 1,
		protocolVersion: "2026-07-28",
		operationContractDigest: "operation-contract-digest",
		operationDocumentationDigest: "operation-documentation-digest",
	});
	expect(
		compiled?.artifact.tools.map(({ identity, tool }) => ({
			identity,
			name: tool.name,
			title: tool.title,
			description: tool.description,
			required: tool.inputSchema.required,
		})),
	).toEqual([
		{
			identity: "action:tickets.action",
			name: "action.tickets.action",
			title: "Run action",
			description: "Run action\n\nUses the canonical action executor.",
			required: ["context", "effectKey", "input"],
		},
		{
			identity: "mutation:tickets.mutation",
			name: "mutation.tickets.mutation",
			title: "Run mutation",
			description: "Run mutation\n\nUses the canonical mutation executor.",
			required: ["callId", "context", "input"],
		},
		{
			identity: "query:tickets.query",
			name: "query.tickets.query",
			title: "Run query",
			description: "Run query\n\nUses the canonical query executor.",
			required: ["context", "input"],
		},
	]);
	expect(compiled?.artifact.tools[2]?.tool.annotations).toEqual({
		readOnlyHint: true,
	});
	expect(
		(
			compiled.artifact.tools[2]!.tool.inputSchema.properties as Record<
				string,
				unknown
			>
		).input,
	).toEqual({
		...objectSchema,
		examples: [{}],
	});
	expect(compiled?.artifact.tools[2]?.tool.outputSchema).toMatchObject({
		oneOf: [
			{
				required: ["callId", "result"],
				properties: { result: { type: "string", examples: ["query-result"] } },
			},
			{
				properties: { error: { properties: { code: { const: "NOT_FOUND" } } } },
			},
		],
	});
	expect(compiled?.digest).toMatch(/^[0-9a-f]{64}$/);
});

test("rejects unsupported and duplicate names with both Origins and no alias", () => {
	expect(() =>
		compileMcpProjection({
			enabled: true,
			operationContractDigest: "operation-contract-digest",
			operationDocumentationDigest: "operation-documentation-digest",
			...invocationSchemas,
			operations: [operation("query", "bad/name")],
		}),
	).toThrow(
		"unsupported MCP tool identity query.bad/name at application:src/tickets.ts#ticketDetail",
	);
	const duplicate = operation("query", "tickets.list");
	expect(() =>
		compileMcpProjection({
			enabled: true,
			operationContractDigest: "operation-contract-digest",
			operationDocumentationDigest: "operation-documentation-digest",
			...invocationSchemas,
			operations: [
				duplicate,
				{
					...duplicate,
					origin: {
						exportName: "list",
						logicalPath: "src/package-tickets.ts",
						packageId: "@acme/support",
					},
				},
			],
		}),
	).toThrow(
		"duplicate MCP tool identity query.tickets.list at @acme/support:src/package-tickets.ts#list, application:src/tickets.ts#ticketDetail",
	);
});

test("emits no bytes when unselected and keeps semantic bytes relocation-stable", () => {
	expect(
		compileMcpProjection({
			enabled: false,
			operationContractDigest: "operation-contract-digest",
			operationDocumentationDigest: "operation-documentation-digest",
			...invocationSchemas,
			operations: [operation("query", "bad/name")],
		}),
	).toBeNull();
	const first = compileMcpProjection({
		enabled: true,
		operationContractDigest: "operation-contract-digest",
		operationDocumentationDigest: "operation-documentation-digest",
		...invocationSchemas,
		operations: [operation("query")],
	});
	const relocated = compileMcpProjection({
		enabled: true,
		operationContractDigest: "operation-contract-digest",
		operationDocumentationDigest: "operation-documentation-digest",
		...invocationSchemas,
		operations: [
			{
				...operation("query"),
				origin: {
					exportName: "renamedExport",
					logicalPath: "src/relocated/ticket-query.ts",
					packageId: "@acme/support",
				},
			},
		],
	});
	expect(relocated?.bytes).toBe(first?.bytes);
	expect(relocated?.digest).toBe(first?.digest);
});
