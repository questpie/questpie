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

// Schema-map keywords: value is a map of name -> subschema.
const SCHEMA_MAP_KEYS = [
	"properties",
	"patternProperties",
	"dependentSchemas",
	"$defs",
	"definitions",
] as const;
// Schema-array keywords whose branches don't carry oneOf/not/if's
// exclusivity/negation hazard (see walkSchemaNode's docstring).
const NEUTRAL_SCHEMA_LIST_KEYS = ["anyOf", "allOf", "prefixItems"] as const;
// Single-subschema keywords, same neutrality as above.
const NEUTRAL_SCHEMA_KEYS = [
	"items",
	"then",
	"else",
	"propertyNames",
	"contains",
] as const;
// Single-subschema keywords that are only ever a schema when not `true`/`false`;
// recursed into with the caller's current protection state unchanged (being
// inside one of these doesn't itself create an exclusivity/negation hazard).
const NEUTRAL_MAYBE_BOOLEAN_SCHEMA_KEYS = [
	"additionalProperties",
	"unevaluatedProperties",
	"unevaluatedItems",
	"additionalItems",
] as const;

/**
 * Rewrites a draft-07-style tuple (`items: [...]` + `additionalItems`) into
 * its 2020-12 equivalent (`prefixItems: [...]` + trailing `items`) in place.
 *
 * The MCP SDK's own `tools/list` projection (`zod-json-schema-compat.js`,
 * called with no `target`) emits JSON Schema **draft-07**, not 2020-12 — the
 * only place that difference is load-bearing for this codebase's schemas is
 * tuple typing, where draft-07's array-form `items` means something entirely
 * different in 2020-12 (a single "all items must match" schema). Our own
 * `toJsonSchema()` below (full zod's `z.toJSONSchema`) already emits native
 * 2020-12 `prefixItems`, so this is a no-op there. Converting first — for
 * every tuple anywhere in the tree, not just the root — makes the whole
 * document genuinely dialect-correct 2020-12 before `applyMcpSchemaDiet`
 * drops the top-level `$schema` pointer.
 */
function normalizeTupleDialect(node: Record<string, unknown>): void {
	if (!Array.isArray(node.items) || node.prefixItems !== undefined) return;
	const tuple = node.items;
	const additionalItems = node.additionalItems;
	delete node.items;
	delete node.additionalItems;
	node.prefixItems = tuple;
	if (additionalItems === false) {
		node.items = false;
	} else if (isPlainObject(additionalItems)) {
		node.items = additionalItems;
		// additionalItems === true (or absent): 2020-12 leaves `items` unset,
		// which already means "no constraint on trailing items".
	}
}

/**
 * Strips wire noise the zod v4 / MCP SDK JSON Schema codecs emit on every
 * tool schema, without touching example/default/const/enum payloads (those
 * carry caller data, not schema structure, and must never be walked).
 *
 * - Removes the document-level `$schema` dialect pointer (informational only;
 *   `normalizeTupleDialect` above makes the document genuinely 2020-12-shaped
 *   first, so an absent `$schema` is universally, correctly, read as 2020-12).
 * - Drops `additionalProperties: false`, *except inside a `oneOf`/`not`/`if`
 *   subtree*. Ordinarily this is safe to drop everywhere: the MCP SDK
 *   validates tool arguments against the *original* zod schema at call time
 *   (`McpServer#validateToolInput` in `mcp.js`), never against this projected
 *   JSON Schema, so removing the annotation does not change what a call gets
 *   rejected for. But inside `oneOf`, `additionalProperties: false` can be
 *   the only thing making two branches mutually exclusive (reproduced:
 *   `z.xor` of two `.strict()` objects with disjoint keys — stripping it from
 *   both branches makes a value that should match exactly one branch match
 *   both, which every `oneOf`-aware validator then rejects as ambiguous, even
 *   though the MCP server itself would still accept it). Inside `not`, it can
 *   be the very thing being negated — stripping it *widens* what `not`
 *   excludes, which can turn a previously-schema-valid value into
 *   schema-invalid for any client-side validator. `if` shares the same
 *   "widening changes routing" hazard. `anyOf`/`allOf` don't have this
 *   problem (a widened disjunct can never invalidate an already-valid input),
 *   so only `oneOf`/`not`/`if` propagate the protection flag.
 * - Drops the `pattern` on a `format: "uuid"` node, keeping `format`. The
 *   pattern is the zod-generated uuid regex that always accompanies
 *   `format: "uuid"` in this codebase's schemas (there is no path that sets
 *   `format: "uuid"` other than zod's own `.uuid()`), and — same reasoning as
 *   `additionalProperties` — the MCP SDK never validates against this
 *   projected schema, so the regex is redundant here. `pattern` on any other
 *   node — a node without `format: "uuid"` — is a user-authored constraint
 *   and is left untouched.
 */
function walkSchemaNode(
	node: unknown,
	protectAdditionalProperties = false,
): void {
	if (!isPlainObject(node)) return;

	normalizeTupleDialect(node);

	if (node.format === "uuid" && typeof node.pattern === "string") {
		delete node.pattern;
	}
	if (!protectAdditionalProperties && node.additionalProperties === false) {
		delete node.additionalProperties;
	}

	for (const key of SCHEMA_MAP_KEYS) {
		const map = node[key];
		if (isPlainObject(map)) {
			for (const value of Object.values(map)) {
				walkSchemaNode(value, protectAdditionalProperties);
			}
		}
	}
	for (const key of NEUTRAL_SCHEMA_LIST_KEYS) {
		const list = node[key];
		if (Array.isArray(list)) {
			for (const item of list)
				walkSchemaNode(item, protectAdditionalProperties);
		}
	}
	for (const key of NEUTRAL_SCHEMA_KEYS) {
		walkSchemaNode(node[key], protectAdditionalProperties);
	}
	for (const key of NEUTRAL_MAYBE_BOOLEAN_SCHEMA_KEYS) {
		walkSchemaNode(node[key], protectAdditionalProperties);
	}

	if (Array.isArray(node.oneOf)) {
		for (const item of node.oneOf) walkSchemaNode(item, true);
	}
	walkSchemaNode(node.not, true);
	walkSchemaNode(node.if, true);
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
