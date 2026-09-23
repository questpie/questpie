import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { collection } from "questpie";
import { z } from "zod";

import { buildMockApp } from "../../questpie/test/utils/mocks/mock-app-builder.js";
import { runTestDbMigrations } from "../../questpie/test/utils/test-db.js";
import { createMcpServer, mcpTool } from "../src/exports/index.js";
import { installSchemaDietListToolsHandler } from "../src/server/create-server.js";
import { applyMcpSchemaDiet } from "../src/server/zod-json-schema.js";

type MiniObjectSchema = {
	type?: string;
	required?: string[];
	properties?: Record<string, { type?: string }>;
	additionalProperties?: boolean;
};

/**
 * Just enough hand-rolled JSON Schema semantics to prove the `oneOf`
 * exclusivity repro below without adding a JSON Schema validator dependency
 * to this package: object type, `required`, and `additionalProperties`
 * (extra-key rejection). That's exactly the surface the repro needs.
 */
function matchesMiniObjectSchema(
	schema: MiniObjectSchema,
	value: Record<string, unknown>,
): boolean {
	if (schema.type && schema.type !== "object") return false;
	for (const key of schema.required ?? []) {
		if (!(key in value)) return false;
	}
	if (schema.additionalProperties === false) {
		const allowed = new Set(Object.keys(schema.properties ?? {}));
		for (const key of Object.keys(value)) {
			if (!allowed.has(key)) return false;
		}
	}
	return true;
}

function countOneOfMatches(
	branches: MiniObjectSchema[],
	value: Record<string, unknown>,
): number {
	return branches.filter((branch) => matchesMiniObjectSchema(branch, value))
		.length;
}

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

	it("normalizes a draft-07 tuple (array items + additionalItems) into 2020-12 prefixItems + items", () => {
		const closed = applyMcpSchemaDiet({
			type: "array",
			items: [{ type: "string" }, { type: "number" }],
			additionalItems: false,
			minItems: 2,
			maxItems: 2,
		}) as Record<string, unknown>;
		expect(closed.prefixItems).toEqual([
			{ type: "string" },
			{ type: "number" },
		]);
		expect(closed.items).toBe(false);
		expect(closed).not.toHaveProperty("additionalItems");

		const open = applyMcpSchemaDiet({
			type: "array",
			items: [{ type: "string" }],
			additionalItems: true,
		}) as Record<string, unknown>;
		expect(open.prefixItems).toEqual([{ type: "string" }]);
		expect(open).not.toHaveProperty("items");
		expect(open).not.toHaveProperty("additionalItems");

		const trailingSchema = applyMcpSchemaDiet({
			type: "array",
			items: [{ type: "string" }],
			additionalItems: { type: "number" },
		}) as Record<string, unknown>;
		expect(trailingSchema.prefixItems).toEqual([{ type: "string" }]);
		expect(trailingSchema.items).toEqual({ type: "number" });
	});

	it("leaves a schema that already uses 2020-12 prefixItems alone", () => {
		const schema = applyMcpSchemaDiet({
			type: "array",
			prefixItems: [{ type: "string" }],
			items: false,
		}) as Record<string, unknown>;
		expect(schema.prefixItems).toEqual([{ type: "string" }]);
		expect(schema.items).toBe(false);
	});

	it("does not strip additionalProperties:false inside oneOf, which would break branch exclusivity (z.xor repro)", () => {
		// Two strict object shapes combined as oneOf, the same projection a
		// `z.xor`/discriminated-union-style schema of two `.strict()` objects
		// produces. branchB's shape is a superset of branchA's.
		const branchA: MiniObjectSchema = {
			type: "object",
			properties: { a: { type: "string" } },
			required: ["a"],
			additionalProperties: false,
		};
		const branchB: MiniObjectSchema = {
			type: "object",
			properties: { a: { type: "string" }, b: { type: "string" } },
			required: ["a", "b"],
			additionalProperties: false,
		};
		const schema = applyMcpSchemaDiet({
			oneOf: [structuredClone(branchA), structuredClone(branchB)],
		}) as { oneOf: MiniObjectSchema[] };

		expect(schema.oneOf[0]).toHaveProperty("additionalProperties", false);
		expect(schema.oneOf[1]).toHaveProperty("additionalProperties", false);

		// A clean, valid instance of branch B only (has both required keys, no
		// extras). Before this fix, stripping additionalProperties:false from
		// branch A let it also tolerate the extra "b" key, so this
		// previously-unambiguous, previously-valid value started matching BOTH
		// branches — and any oneOf-aware validator (this mini-matcher
		// included) rejects a value that matches more than one branch.
		const value = { a: "x", b: "y" };
		expect(countOneOfMatches(schema.oneOf, value)).toBe(1);

		// Prove the counterfactual: the same value against the *unprotected*
		// (buggy) stripping does become ambiguous.
		const stripped = structuredClone([branchA, branchB]).map((branch) => {
			const { additionalProperties: _drop, ...rest } = branch;
			return rest;
		});
		expect(countOneOfMatches(stripped, value)).toBe(2);
	});

	it("does not strip additionalProperties:false inside not or if, but does strip it in the neutral then branch", () => {
		const schema = applyMcpSchemaDiet({
			type: "object",
			properties: {
				blocked: {
					not: {
						type: "object",
						properties: { a: { type: "string" } },
						additionalProperties: false,
					},
				},
				conditional: JSON.parse(
					'{"if":{"type":"object","properties":{"a":{"type":"string"}},"additionalProperties":false},' +
						'"then":{"type":"object","properties":{"b":{"type":"string"}},"additionalProperties":false}}',
				),
			},
		}) as {
			properties: {
				blocked: { not: MiniObjectSchema };
				conditional: { if: MiniObjectSchema; then: Record<string, unknown> };
			};
		};
		expect(schema.properties.blocked.not.additionalProperties).toBe(false);
		expect(schema.properties.conditional.if.additionalProperties).toBe(false);
		// `then` isn't part of the protected set — confirms protection is
		// scoped to oneOf/not/if specifically, not everything under a
		// conditional.
		expect(schema.properties.conditional.then).not.toHaveProperty(
			"additionalProperties",
		);
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
	}, 30000);

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
	}, 30000);

	it("reduces the total tools/list byte size versus the SDK's own raw (undieted) output", async () => {
		// The real baseline: a bare McpServer, registering the exact same tool
		// definition directly against the MCP SDK, with no questpie wrapping
		// and therefore no diet — this is genuinely what the SDK would have
		// put on the wire, not a synthetic reconstruction.
		const { McpServer: BareMcpServer } =
			await import("@modelcontextprotocol/sdk/server/mcp.js");
		const rawServer = new BareMcpServer({ name: "raw", version: "1.0.0" });
		rawServer.registerTool(
			"custom.byId",
			{
				description: "Look up a record by id.",
				inputSchema: { id: z.string().uuid() },
			},
			async ({ id }) => ({
				structuredContent: { id },
				content: [{ type: "text" as const, text: id }],
			}),
		);
		const raw = await connect(rawServer);
		let rawBytes: number;
		try {
			const rawTools = await raw.client.listTools();
			const rawTool = rawTools.tools.find(
				(tool) => tool.name === "custom.byId",
			);
			rawBytes = JSON.stringify(rawTool).length;
		} finally {
			await raw.close();
		}

		const { setup, server } = await buildFixtureServer();
		const { client, close } = await connect(server);
		try {
			const tools = await client.listTools();
			const dietedTool = tools.tools.find(
				(tool) => tool.name === "custom.byId",
			);
			const dietedBytes = JSON.stringify(dietedTool).length;
			expect(dietedBytes).toBeLessThan(rawBytes);
		} finally {
			await close();
			await setup.cleanup();
		}
	}, 30000);

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
			// Specifically the zod "unrecognized_keys" issue for the strict
			// `data` object, not merely some error — proves the *reason* is
			// unchanged, not just that some rejection happened.
			const text = JSON.stringify(result.content);
			expect(text).toContain("unrecognized_keys");
			expect(text).toContain("notAField");
		} finally {
			await close();
			await setup.cleanup();
		}
	}, 30000);

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
	}, 30000);
});

describe("installSchemaDietListToolsHandler failure handling", () => {
	let originalNodeEnv: string | undefined;
	let originalConsoleError: typeof console.error;
	let loggedErrors: unknown[][];

	function fakeServer(overrides: Record<string, unknown>): McpServer {
		return { server: { ...overrides } } as unknown as McpServer;
	}

	beforeEach(() => {
		originalNodeEnv = process.env.NODE_ENV;
		originalConsoleError = console.error;
		loggedErrors = [];
		console.error = (...args: unknown[]) => {
			loggedErrors.push(args);
		};
	});

	afterEach(() => {
		process.env.NODE_ENV = originalNodeEnv;
		console.error = originalConsoleError;
	});

	it("throws outside production when the SDK's request-handler map is missing", () => {
		process.env.NODE_ENV = "test";
		expect(() => installSchemaDietListToolsHandler(fakeServer({}))).toThrow();
		expect(loggedErrors.length).toBeGreaterThan(0);
	});

	it("logs and degrades (does not throw) in production when the request-handler map is missing", () => {
		process.env.NODE_ENV = "production";
		expect(() =>
			installSchemaDietListToolsHandler(fakeServer({})),
		).not.toThrow();
		expect(loggedErrors.length).toBeGreaterThan(0);
	});

	it("throws outside production when no tools/list handler was registered", () => {
		process.env.NODE_ENV = "test";
		expect(() =>
			installSchemaDietListToolsHandler(
				fakeServer({ _requestHandlers: new Map() }),
			),
		).toThrow();
		expect(loggedErrors.length).toBeGreaterThan(0);
	});

	it("logs and degrades (does not throw) in production when no tools/list handler was registered", () => {
		process.env.NODE_ENV = "production";
		expect(() =>
			installSchemaDietListToolsHandler(
				fakeServer({ _requestHandlers: new Map() }),
			),
		).not.toThrow();
		expect(loggedErrors.length).toBeGreaterThan(0);
	});
});
