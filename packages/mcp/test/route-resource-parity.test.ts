import { expect, it } from "bun:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv-provider.js";
import { route } from "questpie";
import { z } from "zod";

import { buildMockApp } from "../../questpie/test/utils/mocks/mock-app-builder.js";
import { createMcpServer } from "../src/exports/index.js";

type RouteResource = {
	key: string;
	inputSchema: Record<string, unknown>;
	outputSchema: Record<string, unknown>;
	toolInputSchema: Tool["inputSchema"];
};

async function resources(client: Client): Promise<RouteResource[]> {
	const result = await client.readResource({ uri: "questpie://schema/routes" });
	const first = result.contents[0]!;
	if (!("text" in first)) throw new Error("Expected JSON resource text");
	return JSON.parse(first.text) as RouteResource[];
}

it("advertises callable tuple and union envelopes through the route schema resource", async () => {
	const pair = z.tuple([z.string(), z.number()]);
	const choice = z.union([
		z.object({ kind: z.literal("one"), value: z.string() }),
		z.object({ kind: z.literal("two"), value: z.number() }),
	]);
	const setup = await buildMockApp({
		routes: {
			"pair:POST": route()
				.post()
				.schema(pair)
				.outputSchema(pair)
				.access(true)
				.meta({ mcp: { expose: true, name: "pair" } })
				.handler(({ input }) => input),
			"choice:POST": route()
				.post()
				.schema(choice)
				.outputSchema(choice)
				.access(true)
				.meta({ mcp: { expose: true, name: "choice" } })
				.handler(({ input }) => input),
		},
	});
	const server = await createMcpServer(setup.app, {
		config: {
			resources: { routes: { pair: true, choice: true } },
			routes: {
				routes: {
					pair: { operations: { execute: true }, scopes: false },
					choice: { operations: { execute: true }, scopes: false },
				},
			},
		},
	});
	const client = new Client({ name: "route-resource-wire", version: "1" });
	const [ct, st] = InMemoryTransport.createLinkedPair();
	try {
		await server.connect(st);
		await client.connect(ct);
		const tools = (await client.listTools()).tools;
		const catalog = await resources(client);
		for (const [key, input, invalid] of [
			["pair", ["a", 1], ["a", "bad"]],
			["choice", { kind: "one", value: "a" }, { kind: "one", value: 1 }],
		] as const) {
			const descriptor = catalog.find((item) => item.key === key)!;
			const tool = tools.find((item) => item.name === key)!;
			expect(descriptor.toolInputSchema).toEqual(tool.inputSchema);
			expect(descriptor.inputSchema.$schema).toBe(
				"http://json-schema.org/draft-07/schema#",
			);
			expect(descriptor.outputSchema.$schema).toBe(
				"http://json-schema.org/draft-07/schema#",
			);
			const validate = new AjvJsonSchemaValidator().getValidator(
				descriptor.toolInputSchema,
			);
			expect(validate({ input }).valid).toBe(true);
			expect(validate({ input: invalid }).valid).toBe(false);
			const result = await client.callTool({ name: key, arguments: { input } });
			expect(result.isError).not.toBe(true);
			expect(result.structuredContent).toEqual({ value: input });
		}
	} finally {
		await client.close();
		await server.close();
		await setup.cleanup();
	}
});

it("uses static route visibility at resource discovery and evaluates functional access only on invocation", async () => {
	let accessCalls = 0;
	const definition = () =>
		route()
			.post()
			.schema(z.object({ tenant: z.string() }))
			.outputSchema(z.object({ ok: z.boolean() }));
	const setup = await buildMockApp({
		routes: {
			"guarded/[id]:POST": definition()
				.params<{ id: string }>()
				.access(({ input, params }) => {
					accessCalls++;
					return input?.tenant === params.id;
				})
				.meta({ mcp: { expose: true, name: "guarded" } })
				.handler(() => ({ ok: true })),
			"denied:POST": definition()
				.access(false)
				.meta({ mcp: { expose: true, name: "denied" } })
				.handler(() => ({ ok: true })),
			"deniedObject:POST": definition()
				.access({ execute: false })
				.meta({ mcp: { expose: true, name: "deniedObject" } })
				.handler(() => ({ ok: true })),
		},
	});
	const server = await createMcpServer(setup.app, {
		config: {
			resources: {
				routes: { "guarded/[id]": true, denied: true, deniedObject: true },
			},
			routes: {
				routes: {
					"guarded/[id]": { operations: { execute: true }, scopes: false },
					denied: { operations: { execute: true }, scopes: false },
					deniedObject: { operations: { execute: true }, scopes: false },
				},
			},
		},
	});
	const client = new Client({ name: "route-resource-access", version: "1" });
	const [ct, st] = InMemoryTransport.createLinkedPair();
	try {
		await server.connect(st);
		await client.connect(ct);
		expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
			"guarded",
		]);
		const catalog = await resources(client);
		expect(accessCalls).toBe(0);
		expect(catalog.map((item) => item.key)).toEqual(["guarded/[id]"]);
		const result = await client.callTool({
			name: "guarded",
			arguments: { params: { id: "tenant" }, input: { tenant: "tenant" } },
		});
		expect(result.isError).not.toBe(true);
		expect(accessCalls).toBe(1);
		await resources(client);
		expect(accessCalls).toBe(1);
		const denied = await client.callTool({
			name: "guarded",
			arguments: { params: { id: "other" }, input: { tenant: "tenant" } },
		});
		expect(denied.isError).toBe(true);
		expect(accessCalls).toBe(2);
	} finally {
		await client.close();
		await server.close();
		await setup.cleanup();
	}
});
