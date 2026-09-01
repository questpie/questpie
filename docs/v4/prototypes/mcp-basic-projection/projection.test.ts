import { expect, test } from "bun:test";

import { projectMcpTools, toolName } from "./projection";

const objectSchema = Object.freeze({
	type: "object",
	additionalProperties: false,
});
const notFoundSchema = Object.freeze({
	type: "object",
	additionalProperties: false,
	properties: Object.freeze({
		kind: Object.freeze({ const: "failure" }),
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
	required: Object.freeze(["error", "kind"]),
});
const applicationOrigin = Object.freeze({
	exportName: "ticketDetail",
	logicalPath: "src/tickets.ts",
	packageId: null,
});

test("derives disjoint kind-qualified names and schemas without authored MCP metadata", () => {
	const tools = projectMcpTools({
		enabled: true,
		operations: [
			{
				kind: "mutation",
				name: "tickets.detail",
				network: true,
				origin: applicationOrigin,
				inputSchema: objectSchema,
				contextSchema: objectSchema,
				outputSchema: { type: "string" },
				frameworkFailureSchemas: [notFoundSchema],
			},
			{
				kind: "query",
				name: "tickets.detail",
				network: true,
				origin: applicationOrigin,
				description: "Read one visible ticket.",
				inputSchema: objectSchema,
				contextSchema: objectSchema,
				outputSchema: { oneOf: [{ type: "string" }, { type: "null" }] },
				declaredErrorSchemas: [
					{ code: "TICKET_HIDDEN", payloadSchema: { type: "null" } },
				],
				frameworkFailureSchemas: [notFoundSchema],
			},
			{
				kind: "action",
				name: "privateExport",
				network: false,
				origin: applicationOrigin,
				inputSchema: objectSchema,
				contextSchema: objectSchema,
				outputSchema: objectSchema,
				frameworkFailureSchemas: [notFoundSchema],
			},
		],
	});

	expect(tools.map(({ name }) => name)).toEqual([
		"mutation.tickets.detail",
		"query.tickets.detail",
	]);
	expect(tools[0]!.annotations).toBeUndefined();
	expect(tools[1]!.annotations).toEqual({ readOnlyHint: true });
	expect(tools[1]!.description).toBe("Read one visible ticket.");
	expect(tools[1]!.inputSchema).toMatchObject({
		type: "object",
		additionalProperties: false,
		required: ["context", "input"],
	});
	const outcomes = tools[1]!.outputSchema.oneOf as readonly Readonly<{
		properties: Readonly<Record<string, unknown>>;
	}>[];
	expect(outcomes).toHaveLength(3);
	expect(outcomes[0]!.properties).toMatchObject({
		kind: { const: "result" },
		result: { oneOf: [{ type: "string" }, { type: "null" }] },
	});
	expect(outcomes[1]!.properties).toMatchObject({
		kind: { const: "declaredError" },
		error: { properties: { code: { const: "TICKET_HIDDEN" } } },
	});
	expect(outcomes[2]!.properties).toMatchObject({
		kind: { const: "failure" },
	});
});

test("rejects unsupported and duplicate derived names without an alias", () => {
	expect(() => toolName({ kind: "query", name: "bad/name" })).toThrow(
		"unsupported MCP tool identity",
	);
	expect(() =>
		projectMcpTools({
			enabled: true,
			operations: [
				{
					kind: "query",
					name: "bad/name",
					network: true,
					origin: applicationOrigin,
					inputSchema: objectSchema,
					contextSchema: objectSchema,
					outputSchema: objectSchema,
					frameworkFailureSchemas: [notFoundSchema],
				},
			],
		}),
	).toThrow(
		"unsupported MCP tool identity query.bad/name at application:src/tickets.ts#ticketDetail",
	);
	const duplicate = {
		kind: "query" as const,
		name: "tickets.list",
		network: true,
		origin: applicationOrigin,
		inputSchema: objectSchema,
		contextSchema: objectSchema,
		outputSchema: objectSchema,
		frameworkFailureSchemas: [notFoundSchema],
	};
	expect(() =>
		projectMcpTools({
			enabled: true,
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

test("emits nothing when the application projection is not selected", () => {
	expect(
		projectMcpTools({
			enabled: false,
			operations: [
				{
					kind: "query",
					name: "unsupported/name",
					network: true,
					origin: applicationOrigin,
					inputSchema: objectSchema,
					contextSchema: objectSchema,
					outputSchema: objectSchema,
					frameworkFailureSchemas: [notFoundSchema],
				},
			],
		}),
	).toEqual([]);
});
