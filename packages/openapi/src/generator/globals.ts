/**
 * Global routes -> OpenAPI paths generator.
 */

import type { Questpie } from "questpie";
import { z } from "zod";
import type { OpenApiConfig, PathOperation } from "../types.js";
import { jsonRequestBody, jsonResponse, ref } from "./schemas.js";

/**
 * Generate OpenAPI paths and component schemas for all globals.
 */
export function generateGlobalPaths(
	cms: Questpie<any>,
	config: OpenApiConfig,
): {
	paths: Record<string, Record<string, PathOperation>>;
	schemas: Record<string, unknown>;
	tags: Array<{ name: string; description?: string }>;
} {
	const globals = cms.getGlobals();
	const basePath = config.basePath ?? "/cms";
	const excluded = new Set(config.exclude?.globals ?? []);
	const paths: Record<string, Record<string, PathOperation>> = {};
	const schemas: Record<string, unknown> = {};
	const tags: Array<{ name: string; description?: string }> = [];

	for (const [name, global] of Object.entries(globals)) {
		if (excluded.has(name)) continue;

		const state = (global as any).state;
		if (!state) continue;

		const tag = `Globals: ${name}`;
		tags.push({ name: tag, description: `Operations for ${name} global` });

		const pascalName = toPascalCase(name);
		const valueSchemaName = `${pascalName}Global`;
		const updateSchemaName = `${pascalName}GlobalUpdate`;
		const fieldDefinitionSchema = buildGlobalSchemaFromFieldDefinitions(
			state.fieldDefinitions,
		);

		// Generate value schema from validation or field definitions
		if (state.validation?.updateSchema) {
			try {
				schemas[updateSchemaName] = z.toJSONSchema(
					state.validation.updateSchema,
					{ unrepresentable: "any" },
				);
			} catch {
				schemas[updateSchemaName] = {
					type: "object",
					description: `Update schema for ${name} global`,
				};
			}
		} else if (fieldDefinitionSchema != null) {
			schemas[updateSchemaName] = fieldDefinitionSchema;
		} else {
			schemas[updateSchemaName] = {
				type: "object",
				description: `Update schema for ${name} global`,
			};
		}

		// Value schema (response) — includes id + timestamps
		const properties: Record<string, unknown> = {
			id: { type: "string" },
		};
		if (state.options?.timestamps !== false) {
			properties.createdAt = { type: "string", format: "date-time" };
			properties.updatedAt = { type: "string", format: "date-time" };
		}
		schemas[valueSchemaName] = {
			allOf: [
				{ type: "object", properties, required: ["id"] },
				ref(updateSchemaName),
			],
			description: `${name} global value`,
		};

		const prefix = `${basePath}/globals/${name}`;

		// GET /globals/{name}
		// PATCH /globals/{name}
		paths[prefix] = {
			get: {
				operationId: `global_${name}_get`,
				summary: `Get ${name} global`,
				tags: [tag],
				parameters: [
					{
						name: "locale",
						in: "query",
						schema: { type: "string" },
						description: "Content locale",
					},
				],
				responses: jsonResponse(
					ref(valueSchemaName),
					`Current value of ${name} global`,
				),
			},
			patch: {
				operationId: `global_${name}_update`,
				summary: `Update ${name} global`,
				tags: [tag],
				requestBody: jsonRequestBody(ref(updateSchemaName)),
				responses: jsonResponse(ref(valueSchemaName), `Updated ${name} global`),
			},
		};

		// GET /globals/{name}/schema
		paths[`${prefix}/schema`] = {
			get: {
				operationId: `global_${name}_schema`,
				summary: `Get ${name} global introspection schema`,
				tags: [tag],
				responses: jsonResponse(
					{ type: "object", description: "Introspected global schema" },
					`Introspection schema for ${name} global`,
				),
			},
		};
	}

	return { paths, schemas, tags };
}

function toPascalCase(str: string): string {
	return str
		.replace(/[-_](.)/g, (_, c) => c.toUpperCase())
		.replace(/^(.)/, (_, c) => c.toUpperCase());
}

function buildGlobalSchemaFromFieldDefinitions(
	fieldDefinitions: unknown,
): unknown | null {
	if (!fieldDefinitions || typeof fieldDefinitions !== "object") {
		return null;
	}

	const shape: Record<string, z.ZodTypeAny> = {};

	for (const [fieldName, fieldDefinition] of Object.entries(
		fieldDefinitions as Record<string, unknown>,
	)) {
		const toZodSchema = (fieldDefinition as { toZodSchema?: () => unknown })
			.toZodSchema;
		if (typeof toZodSchema !== "function") {
			continue;
		}

		try {
			const schema = toZodSchema();
			if (schema && typeof schema === "object" && "_def" in schema) {
				shape[fieldName] = schema as z.ZodTypeAny;
			}
		} catch {
			// Ignore fields that cannot be converted; keep generating the rest.
		}
	}

	if (Object.keys(shape).length === 0) {
		return null;
	}

	return z.toJSONSchema(z.object(shape).partial(), {
		unrepresentable: "any",
	});
}
