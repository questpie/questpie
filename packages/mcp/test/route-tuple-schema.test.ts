import { expect, it } from "bun:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv-provider.js";
import { route } from "questpie";
import { z } from "zod";

import { buildMockApp } from "../../questpie/test/utils/mocks/mock-app-builder.js";
import { createMcpServer } from "../src/exports/index.js";

it("validates tuple route wrappers with shared definitions after SDK discovery", async () => {
	const tag = z.string().min(1).meta({ id: "RouteTupleTag" });
	const input = z.tuple([tag, tag]);
	const output = z.tuple([tag, z.number()]);
	let calls = 0;
	const setup = await buildMockApp({
		routes: {
			"pairs/[scopeId]:POST": route()
				.post()
				.params<{ scopeId: string }>()
				.schema(input)
				.outputSchema(output)
				.access(true)
				.meta({ mcp: { expose: true, name: "pairs" } })
				.handler(({ input, params }) => {
					calls++;
					expect(params.scopeId).toBe("scope-1");
					return [input[0], input[1].length] as [string, number];
				}),
		},
	});
	const server = await createMcpServer(setup.app, {
		config: {
			routes: {
				routes: {
					"pairs/[scopeId]": { operations: { execute: true }, scopes: false },
				},
			},
		},
	});
	const [ct, st] = InMemoryTransport.createLinkedPair();
	const client = new Client({ name: "route-tuple", version: "1" });
	try {
		await server.connect(st);
		await client.connect(ct);
		const tools = (await client.listTools()).tools;
		expect(tools).toHaveLength(1);
		const tool = tools[0]!;
		expect(tool.inputSchema).toMatchObject({
			$schema: "http://json-schema.org/draft-07/schema#",
		});
		expect(tool.outputSchema).toMatchObject({
			$schema: "http://json-schema.org/draft-07/schema#",
		});
		const args = { params: { scopeId: "scope-1" }, input: ["tag", "other"] };
		expect(
			new AjvJsonSchemaValidator().getValidator(tool.inputSchema)(args).valid,
		).toBe(true);
		const result = await client.callTool({ name: "pairs", arguments: args });
		expect(result.isError).not.toBe(true);
		expect(result.structuredContent).toEqual({ value: ["tag", 5] });
		expect(calls).toBe(1);
		const invalid = await client.callTool({
			name: "pairs",
			arguments: { ...args, input: ["tag", 3] },
		});
		expect(invalid.isError).toBe(true);
		expect(invalid.structuredContent).toBeUndefined();
		expect(calls).toBe(1);
	} finally {
		await client.close();
		await server.close();
		await setup.cleanup();
	}
});
