import { expect, it } from "bun:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import {
	ListToolsRequestSchema,
	type ListToolsResult,
} from "@modelcontextprotocol/sdk/types.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv-provider.js";
import { collection } from "questpie";
import { z } from "zod";
import * as z4mini from "zod/v4-mini";

import { buildMockApp } from "../../questpie/test/utils/mocks/mock-app-builder.js";
import { createMcpServer } from "../src/exports/index.js";
import { installSchemaDietListToolsHandler } from "../src/server/create-server.js";
import { toToolInputJsonSchema } from "../src/server/zod-json-schema.js";

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
		["compact", schema],
	] as const) {
		server.registerTool(name, { inputSchema }, async (input) => ({
			content: [{ type: "text", text: JSON.stringify(input) }],
		}));
	}
	installSchemaDietListToolsHandler(
		server,
		undefined,
		new Map([["compact", schema]]),
	);
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

function references(node: unknown): string[] {
	if (!node || typeof node !== "object") return [];
	return Object.entries(node).flatMap(([key, value]) =>
		key === "$ref" && typeof value === "string" ? [value] : references(value),
	);
}

function resolve(schema: unknown, ref: string): unknown {
	return ref === "#"
		? schema
		: ref
				.slice(2)
				.split("/")
				.reduce<unknown>(
					(node, key) =>
						node && typeof node === "object"
							? Reflect.get(node, key.replace(/~1/g, "/").replace(/~0/g, "~"))
							: undefined,
					schema,
				);
}

function expectLiveDefinitions(schema: Record<string, unknown>) {
	for (const ref of references(schema))
		expect(resolve(schema, ref)).toBeDefined();
	const { $defs, definitions, ...body } = schema;
	const reachable = new Set<string>();
	const pending = references(body);
	while (pending.length) {
		const ref = pending.pop()!;
		if (reachable.has(ref)) continue;
		reachable.add(ref);
		pending.push(...references(resolve(schema, ref)));
	}
	for (const [container, map] of Object.entries({ $defs, definitions })) {
		for (const key of Object.keys(map ?? {})) {
			expect(
				[...reachable].some(
					(ref) =>
						ref === `#/${container}/${key}` ||
						ref.startsWith(`#/${container}/${key}/`),
				),
			).toBe(true);
		}
	}
}

it.each(["draft-07", "draft-2020-12"] as const)(
	"projects real CRUD schemas independently of SDK %s with no dead definitions",
	async (target) => {
		const setup = await buildMockApp({
			collections: {
				posts: collection("posts").fields(({ f }) => ({
					title: f.text(255).required(),
					data: f.json(),
				})),
			},
			config: {
				mcp: {
					stdio: { trustedMaintenance: true },
					crud: {
						collections: {
							posts: {
								operations: {
									list: true,
									count: true,
									get: true,
									create: true,
									update: true,
									delete: true,
								},
							},
						},
					},
				},
			},
		});
		try {
			const server = await createMcpServer(setup.app, { transport: "stdio" });
			const registered = Reflect.get(server, "_registeredTools") as Record<
				string,
				{ inputSchema: z.ZodTypeAny }
			>;
			const schemas = new Map(
				Object.entries(registered).map(([name, tool]) => [
					name,
					tool.inputSchema,
				]),
			);
			const sdkTools = [...schemas].map(([name, schema]) => ({
				name,
				inputSchema:
					target === "draft-07"
						? toJsonSchemaCompat(schema, {
								strictUnions: true,
								pipeStrategy: "input",
							})
						: z4mini.toJSONSchema(schema, { target, io: "input" }),
			}));
			server.server.setRequestHandler(
				ListToolsRequestSchema,
				() => ({ tools: sdkTools }) as ListToolsResult,
			);
			installSchemaDietListToolsHandler(server, undefined, schemas);
			const [ct, st] = InMemoryTransport.createLinkedPair();
			const client = new Client({ name: "dialect-test", version: "1" });
			await server.connect(st);
			await client.connect(ct);
			try {
				const listed = await client.listTools();
				expect(listed.tools.length).toBe(6);
				for (const tool of listed.tools) {
					expectLiveDefinitions(tool.inputSchema);
					const original = schemas.get(tool.name)!;
					const validate = new AjvJsonSchemaValidator().getValidator(
						tool.inputSchema,
					);
					const valid = tool.name.endsWith(".create")
						? { data: { title: "Valid", data: { nested: [1, true] } } }
						: tool.name.endsWith(".update")
							? { id: "id", data: { title: "Valid" } }
							: tool.name.endsWith(".get") || tool.name.endsWith(".delete")
								? { id: "id" }
								: {
										where: {
											AND: [{ title: { eq: "Valid" } }],
											NOT: { title: "No" },
										},
									};
					const invalid =
						tool.name.endsWith(".create") || tool.name.endsWith(".update")
							? { ...valid, data: { title: 42 } }
							: tool.name.endsWith(".get") || tool.name.endsWith(".delete")
								? { id: false }
								: { where: { AND: "invalid" } };
					expect(original.safeParse(valid).success).toBe(true);
					expect(original.safeParse(invalid).success).toBe(false);
					for (const input of [valid, invalid]) {
						expect(validate(input).valid).toBe(
							original.safeParse(input).success,
						);
					}
					const result = await client.callTool({
						name: tool.name,
						arguments: invalid,
					});
					expect(result.isError).toBe(true);
					expect(JSON.stringify(result.content)).toContain("MCP error -32602");
				}
				const next = await createMcpServer(setup.app, { transport: "stdio" });
				try {
					const nextTools = Reflect.get(
						next,
						"_registeredTools",
					) as typeof registered;
					for (const [name, original] of schemas) {
						expect(nextTools[name].inputSchema).toBe(original);
						const projection = toToolInputJsonSchema(original);
						expect(toToolInputJsonSchema(nextTools[name].inputSchema)).toBe(
							projection,
						);
						expect(Object.isFrozen(projection)).toBe(true);
						expect(Object.isFrozen(projection.properties)).toBe(true);
					}
				} finally {
					await next.close();
				}
			} finally {
				await client.close();
				await server.close();
			}
		} finally {
			await setup.cleanup();
		}
	},
);
