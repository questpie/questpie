/* eslint-disable no-underscore-dangle -- Zod exposes _def for the compatibility fallback below. */
import { ToolSchema, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

export function jsonSchemaCompatibleSchema(
	schema: z.ZodTypeAny | undefined,
): z.ZodTypeAny | undefined {
	if (!schema) return undefined;
	if (canConvertToJsonSchema(schema)) return schema;

	const def = (schema as { _def?: Record<string, any> })._def;
	switch (def?.type) {
		case "date":
			return z.string().describe("ISO date or date-time string");
		case "optional":
			return (
				jsonSchemaCompatibleSchema(def.innerType)?.optional() ?? z.unknown()
			);
		case "nullable":
			return (
				jsonSchemaCompatibleSchema(def.innerType)?.nullable() ?? z.unknown()
			);
		case "default":
		case "prefault":
		case "catch":
			return (
				jsonSchemaCompatibleSchema(def.innerType)?.optional() ?? z.unknown()
			);
		case "array":
			return z.array(jsonSchemaCompatibleSchema(def.element) ?? z.unknown());
		case "record": {
			const keySchema = jsonSchemaCompatibleSchema(def.keyType);
			return z.record(
				keySchema instanceof z.ZodString ? keySchema : z.string(),
				jsonSchemaCompatibleSchema(def.valueType) ?? z.unknown(),
			);
		}
		case "union": {
			const options = Array.isArray(def.options)
				? def.options.map(
						(option) => jsonSchemaCompatibleSchema(option) ?? z.unknown(),
					)
				: [];
			if (options.length === 0) return z.unknown();
			if (options.length === 1) return options[0];
			return z.union(
				options as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]],
			);
		}
		case "object": {
			const shape = (schema as z.ZodObject<Record<string, z.ZodTypeAny>>).shape;
			const nextShape: Record<string, z.ZodTypeAny> = {};
			for (const [key, value] of Object.entries(shape)) {
				nextShape[key] = jsonSchemaCompatibleSchema(value) ?? z.unknown();
			}
			const objectSchema = z.object(nextShape);
			if (def.catchall && def.catchall._def?.type !== "never") {
				return objectSchema.catchall(
					jsonSchemaCompatibleSchema(def.catchall) ?? z.unknown(),
				);
			}
			return objectSchema;
		}
		default:
			return z.unknown();
	}
}

export function toJsonSchema(schema: z.ZodTypeAny | undefined) {
	const compatible = jsonSchemaCompatibleSchema(schema);
	if (!compatible) return undefined;

	try {
		// CRUD query schemas intentionally reuse the same bounded condition
		// schemas across fields and logical levels. Preserve that sharing as
		// `$defs`/`$ref`; inlining turns a one-field list schema into megabytes.
		return applyMcpSchemaDiet(z.toJSONSchema(compatible, { reused: "ref" }));
	} catch {
		return undefined;
	}
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

const WALK_LIST_KEYS = ["anyOf", "oneOf", "allOf", "prefixItems"] as const;
const WALK_NODE_KEYS = [
	"items",
	"additionalProperties",
	"not",
	"if",
	"then",
	"else",
] as const;
const WALK_MAP_KEYS = ["properties", "$defs", "definitions"] as const;

/**
 * Strips wire noise the zod v4 / MCP SDK JSON Schema codecs emit on every
 * tool schema, without touching example/default/const/enum payloads (those
 * carry caller data, not schema structure, and must never be walked).
 *
 * - Removes the document-level `$schema` dialect pointer (informational only;
 *   an absent `$schema` is universally treated as 2020-12).
 * - Drops `additionalProperties: false` wherever it appears. The MCP SDK
 *   validates tool arguments against the *original* zod schema at call time
 *   (`McpServer#validateToolInput` in `zod-json-schema-compat.js`'s caller,
 *   `mcp.js`), never against this projected JSON Schema, so removing the
 *   annotation does not change what gets rejected.
 * - Drops the `pattern` on a `format: "uuid"` node, keeping `format`. The
 *   pattern is the zod-generated uuid regex that always accompanies
 *   `format: "uuid"` in this codebase's schemas (there is no path that sets
 *   `format: "uuid"` other than zod's own `.uuid()`), and the MCP SDK
 *   validates call-time arguments against the *original* zod schema, never
 *   against this projected JSON Schema, so the regex is redundant here.
 *   `pattern` on any other node — a node without `format: "uuid"` — is a
 *   user-authored constraint and is left untouched.
 */
function walkSchemaNode(node: unknown): void {
	if (!isPlainObject(node)) return;

	if (node.format === "uuid" && typeof node.pattern === "string") {
		delete node.pattern;
	}
	if (node.additionalProperties === false) {
		delete node.additionalProperties;
	}

	for (const key of WALK_MAP_KEYS) {
		const map = node[key];
		if (isPlainObject(map)) {
			for (const value of Object.values(map)) walkSchemaNode(value);
		}
	}
	for (const key of WALK_LIST_KEYS) {
		const list = node[key];
		if (Array.isArray(list)) {
			for (const item of list) walkSchemaNode(item);
		}
	}
	for (const key of WALK_NODE_KEYS) {
		walkSchemaNode(node[key]);
	}
}

export function applyMcpSchemaDiet<T>(schema: T): T {
	if (!isPlainObject(schema)) return schema;
	delete schema.$schema;
	walkSchemaNode(schema);
	return schema;
}

export function toToolInputJsonSchema(
	schema: z.ZodTypeAny | undefined,
): Tool["inputSchema"] {
	const parsed = ToolSchema.shape.inputSchema.safeParse(toJsonSchema(schema));
	return parsed.success
		? parsed.data
		: {
				type: "object",
				properties: {},
			};
}

export function toToolOutputJsonSchema(
	schema: z.ZodTypeAny | undefined,
): Tool["outputSchema"] {
	const parsed = ToolSchema.shape.outputSchema.safeParse(toJsonSchema(schema));
	return parsed.success ? parsed.data : undefined;
}

function canConvertToJsonSchema(schema: z.ZodTypeAny): boolean {
	try {
		z.toJSONSchema(schema);
		return true;
	} catch {
		return false;
	}
}
