import { expect, it } from "bun:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv-provider.js";
import { z } from "zod";

import { installSchemaDietListToolsHandler } from "../src/server/create-server.js";
import { withMcpSchemaRefs } from "../src/server/zod-json-schema.js";

it("compacts SDK discovery through shared refs while preserving client and server validation", async () => {
	const shared = z.object({
		label: z.string().min(2).max(20),
		count: z.number().int().min(0).max(100),
		state: z.enum(["open", "closed"]),
	});
	const schema = z.object({ a: shared, b: shared, c: shared });
	const server = new McpServer({ name: "schema-refs", version: "1" });
	for (const [name, inputSchema] of [
		["expanded", schema],
		["compact", withMcpSchemaRefs(schema, "input")],
	] as const) {
		server.registerTool(name, { inputSchema }, async (input) => ({
			content: [{ type: "text", text: JSON.stringify(input) }],
		}));
	}
	installSchemaDietListToolsHandler(server);
	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	const client = new Client({ name: "schema-refs-test", version: "1" });
	await server.connect(serverTransport);
	await client.connect(clientTransport);
	try {
		const { tools } = await client.listTools();
		const expanded = tools.find(({ name }) => name === "expanded")!.inputSchema;
		const compact = tools.find(({ name }) => name === "compact")!.inputSchema;
		expect(JSON.stringify(compact).length).toBeLessThan(
			JSON.stringify(expanded).length,
		);
		const validator = new AjvJsonSchemaValidator();
		const validateExpanded = validator.getValidator(expanded);
		const validateCompact = validator.getValidator(compact);
		const row = { label: "Valid", count: 2, state: "open" };
		const samples = [
			{ a: row, b: row, c: row },
			{ a: { ...row, label: "x" }, b: row, c: row },
			{ a: row, b: { ...row, count: 101 }, c: row },
			{ a: row, b: row, c: { ...row, state: "unknown" } },
		];
		for (const input of samples) {
			const valid = schema.safeParse(input).success;
			expect(validateExpanded(input).valid).toBe(valid);
			expect(validateCompact(input).valid).toBe(valid);
			const result = await client.callTool({
				name: "compact",
				arguments: input,
			});
			expect(result.isError === true).toBe(!valid);
		}
	} finally {
		await client.close();
		await server.close();
	}
});
