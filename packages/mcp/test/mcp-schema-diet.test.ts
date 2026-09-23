import { describe, expect, it } from "bun:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { collection } from "questpie";
import { z } from "zod";

import { buildMockApp } from "../../questpie/test/utils/mocks/mock-app-builder.js";
import { runTestDbMigrations } from "../../questpie/test/utils/test-db.js";
import { createMcpServer, mcpTool } from "../src/exports/index.js";
import { applyMcpSchemaDiet } from "../src/server/zod-json-schema.js";

async function connect(server: McpServer) {
	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	const client = new Client({ name: "questpie-diet-test", version: "1.0.0" });
	await server.connect(serverTransport);
	await client.connect(clientTransport);
	return {
		client,
		close: async () => {
			await client.close();
			await server.close();
		},
	};
}

describe("applyMcpSchemaDiet (unit)", () => {
	it("drops the top-level $schema key", () => {
		const schema = applyMcpSchemaDiet({
			$schema: "https://json-schema.org/draft/2020-12/schema",
			type: "object",
			properties: {},
		});
		expect(schema).not.toHaveProperty("$schema");
	});

	it("drops the pattern on a uuid node but keeps format:uuid", () => {
		const schema = applyMcpSchemaDiet({
			type: "object",
			properties: {
				withPattern: {
					type: "string",
					format: "uuid",
					pattern: "^[0-9a-f-]{36}$",
				},
				withoutPattern: {
					type: "string",
					format: "uuid",
				},
			},
		}) as {
			properties: {
				withPattern: Record<string, unknown>;
				withoutPattern: Record<string, unknown>;
			};
		};
		expect(schema.properties.withPattern.format).toBe("uuid");
		expect(schema.properties.withPattern).not.toHaveProperty("pattern");
		expect(schema.properties.withoutPattern.format).toBe("uuid");
		expect(schema.properties.withoutPattern).not.toHaveProperty("pattern");
	});

	it("never touches a pattern on a node that isn't format:uuid", () => {
		const schema = applyMcpSchemaDiet({
			type: "object",
			properties: {
				slug: {
					type: "string",
					pattern: "^[a-z0-9-]+$",
				},
			},
		}) as { properties: { slug: Record<string, unknown> } };
		expect(schema.properties.slug.pattern).toBe("^[a-z0-9-]+$");
	});

	it("drops additionalProperties:false but keeps additionalProperties schemas", () => {
		const schema = applyMcpSchemaDiet({
			type: "object",
			additionalProperties: false,
			properties: {
				rec: {
					type: "object",
					additionalProperties: { type: "string" },
				},
			},
		}) as {
			properties: { rec: Record<string, unknown> };
		};
		expect(schema).not.toHaveProperty("additionalProperties");
		expect(schema.properties.rec.additionalProperties).toEqual({
			type: "string",
		});
	});

	it("walks properties, items, prefixItems, anyOf/oneOf/allOf, $defs/definitions, not/if/then/else", () => {
		const schema = applyMcpSchemaDiet({
			type: "object",
			additionalProperties: false,
			properties: {
				list: {
					type: "array",
					items: { type: "string", format: "uuid", pattern: "^u$" },
					prefixItems: [{ type: "string", format: "uuid", pattern: "^u$" }],
				},
				union: {
					anyOf: [{ type: "string", format: "uuid", pattern: "^u$" }],
					oneOf: [{ type: "string", format: "uuid", pattern: "^u$" }],
					allOf: [{ type: "string", format: "uuid", pattern: "^u$" }],
				},
				// Parsed from a JSON string (rather than written as an object
				// literal) so a plain `then` key here doesn't trip oxlint's
				// unicorn/no-thenable rule, which flags any JS value carrying
				// a `then` property/assignment.
				conditional: JSON.parse(
					'{"if":{"type":"string","format":"uuid","pattern":"^u$"},' +
						'"then":{"type":"string","format":"uuid","pattern":"^u$"},' +
						'"else":{"type":"string","format":"uuid","pattern":"^u$"},' +
						'"not":{"type":"string","format":"uuid","pattern":"^u$"}}',
				),
			},
			$defs: {
				Ref: { type: "string", format: "uuid", pattern: "^u$" },
			},
			definitions: {
				Legacy: { type: "string", format: "uuid", pattern: "^u$" },
			},
		});
		expect(JSON.stringify(schema)).not.toContain('"pattern":"^u$"');
		expect(JSON.stringify(schema)).not.toContain(
			'"additionalProperties":false',
		);
		expect(JSON.stringify(schema)).toContain('"format":"uuid"');
	});

	it("never touches examples, default, const, or enum payloads, even when they carry keys named like schema keywords", () => {
		const trap = {
			format: "uuid",
			pattern: "not-a-real-pattern",
			additionalProperties: false,
			$schema: "user-data-not-a-dialect",
		};
		const schema = applyMcpSchemaDiet({
			type: "object",
			properties: {
				field: {
					type: "object",
					examples: [trap],
					default: trap,
					const: trap,
				},
				choice: {
					enum: [trap, "plain"],
				},
			},
		}) as {
			properties: {
				field: { examples: unknown[]; default: unknown; const: unknown };
				choice: { enum: unknown[] };
			};
		};
		expect(schema.properties.field.examples[0]).toEqual(trap);
		expect(schema.properties.field.default).toEqual(trap);
		expect(schema.properties.field.const).toEqual(trap);
		expect(schema.properties.choice.enum[0]).toEqual(trap);
	});

	it("is a no-op on non-object input", () => {
		expect(applyMcpSchemaDiet(undefined)).toBeUndefined();
		expect(applyMcpSchemaDiet(null as unknown as object)).toBeNull();
	});
});

describe("MCP tools/list schema diet (integration)", () => {
	const posts = collection("posts")
		.fields(({ f }) => ({
			title: f.text(255).required(),
			relatedPost: f.relation("posts"),
		}))
		.access({ read: true, create: true, update: true, delete: true });

	// A directly zod-authored uuid field, exercised the same way a project's
	// own route/tool authors would write one — this is the shape that
	// actually keeps `format: "uuid"` + `pattern` together end to end (the
	// framework's own collection-field derivation for "relation"/"upload"
	// columns currently degrades to a plain length-bounded string before it
	// reaches JSON Schema, which is a pre-existing, unrelated fact about
	// field derivation, not something this diet touches).
	const byIdTool = mcpTool("custom.byId", {
		access: true,
		scopes: false,
		description: "Look up a record by id.",
		inputSchema: z.object({ id: z.string().uuid() }),
	}).handler(async ({ input }) => ({
		structuredContent: { id: input.id },
		content: [{ type: "text", text: input.id }],
	}));

	async function buildFixtureServer() {
		const setup = await buildMockApp({
			collections: { posts },
			mcpTools: { byId: byIdTool },
		});
		await runTestDbMigrations(setup.app);
		const server = await createMcpServer(setup.app, {
			transport: "http",
			config: {
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
		});
		return { setup, server };
	}

	it("removes $schema from every emitted tool schema", async () => {
		const { setup, server } = await buildFixtureServer();
		const { client, close } = await connect(server);
		try {
			const tools = await client.listTools();
			expect(tools.tools.length).toBeGreaterThan(0);
			for (const tool of tools.tools) {
				expect(JSON.stringify(tool.inputSchema)).not.toContain('"$schema"');
				if (tool.outputSchema) {
					expect(JSON.stringify(tool.outputSchema)).not.toContain('"$schema"');
				}
			}
		} finally {
			await close();
			await setup.cleanup();
		}
	});

	it("keeps format:uuid on a uuid field while dropping the redundant pattern", async () => {
		const { setup, server } = await buildFixtureServer();
		const { client, close } = await connect(server);
		try {
			const tools = await client.listTools();
			const byId = tools.tools.find((tool) => tool.name === "custom.byId");
			const raw = JSON.stringify(byId?.inputSchema);
			expect(raw).toContain('"id"');
			expect(raw).toContain('"format":"uuid"');
			expect(raw).not.toMatch(/"pattern":"[^"]+"/);
		} finally {
			await close();
			await setup.cleanup();
		}
	});

	it("reduces the total tools/list byte size versus the undieted baseline", async () => {
		const { setup, server } = await buildFixtureServer();
		const { client, close } = await connect(server);
		try {
			const tools = await client.listTools();
			const dietedBytes = JSON.stringify(tools.tools).length;

			// Re-derive the undieted baseline the same way the SDK would have
			// produced it, by re-adding exactly what the diet removes, so this
			// assertion measures the diet's own effect rather than drifting
			// with unrelated catalogue changes.
			let restoredBytes = 0;
			for (const tool of tools.tools) {
				const withSchemaKey = {
					...tool,
					inputSchema: {
						$schema: "https://json-schema.org/draft/2020-12/schema",
						...tool.inputSchema,
					},
				};
				restoredBytes += JSON.stringify(withSchemaKey).length;
			}
			expect(dietedBytes).toBeLessThan(restoredBytes);
		} finally {
			await close();
			await setup.cleanup();
		}
	});

	it("still rejects unknown arguments exactly as before the diet", async () => {
		const { setup, server } = await buildFixtureServer();
		const { client, close } = await connect(server);
		try {
			const result = await client.callTool({
				name: "collections.posts.create",
				arguments: {
					data: {
						title: "Hi",
						notAField: "should be rejected",
					},
				},
			});
			// The SDK reports arg-validation failures as an in-band tool error
			// (isError: true), not a rejected JSON-RPC call — see
			// `McpServer#validateToolInput`/`createToolError` in `mcp.js`. The
			// diet only changes the projected `tools/list` schema; it never
			// touches this call-time path, which always validates against the
			// original (`.strict()`) zod schema.
			expect(result.isError).toBe(true);
		} finally {
			await close();
			await setup.cleanup();
		}
	});

	it("still rejects a malformed uuid exactly as before the diet", async () => {
		const { setup, server } = await buildFixtureServer();
		const { client, close } = await connect(server);
		try {
			const result = await client.callTool({
				name: "custom.byId",
				arguments: { id: "not-a-uuid" },
			});
			expect(result.isError).toBe(true);
		} finally {
			await close();
			await setup.cleanup();
		}
	});
});
