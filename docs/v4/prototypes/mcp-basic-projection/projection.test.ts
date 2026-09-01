import { expect, test } from "bun:test";

import { projectMcpTools, toolName } from "./projection";

const objectSchema = Object.freeze({
	type: "object",
	additionalProperties: false,
});

test("derives disjoint kind-qualified names and schemas without authored MCP metadata", () => {
	const tools = projectMcpTools([
		{
			kind: "mutation",
			name: "tickets.detail",
			network: true,
			inputSchema: objectSchema,
			contextSchema: objectSchema,
			outputSchema: { type: "string" },
		},
		{
			kind: "query",
			name: "tickets.detail",
			network: true,
			description: "Read one visible ticket.",
			inputSchema: objectSchema,
			contextSchema: objectSchema,
			outputSchema: { oneOf: [{ type: "string" }, { type: "null" }] },
		},
		{
			kind: "action",
			name: "privateExport",
			network: false,
			inputSchema: objectSchema,
			contextSchema: objectSchema,
			outputSchema: objectSchema,
		},
	]);

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
	expect(tools[1]!.outputSchema).toEqual({
		oneOf: [{ type: "string" }, { type: "null" }],
	});
});

test("rejects unsupported and duplicate derived names without an alias", () => {
	expect(() => toolName({ kind: "query", name: "bad/name" })).toThrow(
		"unsupported MCP tool identity",
	);
	const duplicate = {
		kind: "query" as const,
		name: "tickets.list",
		network: true,
		inputSchema: objectSchema,
		contextSchema: objectSchema,
		outputSchema: objectSchema,
	};
	expect(() => projectMcpTools([duplicate, duplicate])).toThrow(
		"duplicate MCP tool identity: query.tickets.list",
	);
});
