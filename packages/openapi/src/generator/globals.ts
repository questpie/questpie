/**
 * Global routes -> OpenAPI paths generator.
 */

import type { Questpie } from "questpie";
import { z } from "zod";

import type { OpenApiConfig, PathOperation } from "../types.js";
import {
	applyRequestFieldFlags,
	buildFieldDefinitionSchemas,
} from "./field-schema-flags.js";
import {
	jsonRequestBody,
	jsonResponse,
	ref,
	stageQueryParameter,
} from "./schemas.js";

/**
 * Generate OpenAPI paths and component schemas for all globals.
 */
export function generateGlobalPaths(
	app: Questpie<any>,
	config: OpenApiConfig,
): {
	paths: Record<string, Record<string, PathOperation>>;
	schemas: Record<string, unknown>;
	tags: Array<{ name: string; description?: string }>;
} {
	const globals = app.getGlobals();
	const basePath = config.basePath ?? "/";
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
		const fieldDefinitionSchema = buildFieldDefinitionSchemas(
			state.fieldDefinitions,
		);

		// Request schemas preserve custom validation when present, then apply
		// field input/output flags from field definitions.
		if (state.validation?.updateSchema) {
			try {
				const updateSchema = z.toJSONSchema(state.validation.updateSchema, {
					unrepresentable: "any",
				});
				applyRequestFieldFlags(updateSchema, state.fieldDefinitions);
				schemas[updateSchemaName] = updateSchema;
			} catch {
				schemas[updateSchemaName] = {
					type: "object",
					description: `Update schema for ${name} global`,
				};
			}
		} else if (fieldDefinitionSchema != null) {
			schemas[updateSchemaName] = fieldDefinitionSchema.update;
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
				fieldDefinitionSchema?.response ?? ref(updateSchemaName),
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
					stageQueryParameter(),
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
				parameters: [stageQueryParameter()],
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

		// GET /globals/{name}/versions
		paths[`${prefix}/versions`] = {
			get: {
				operationId: `global_${name}_findVersions`,
				summary: `List ${name} global versions`,
				tags: [tag],
				parameters: [
					{
						name: "id",
						in: "query",
						schema: { type: "string" },
						description: "Global record ID",
					},
					{
						name: "limit",
						in: "query",
						schema: { type: "number" },
						description: "Maximum number of versions to return",
					},
					{
						name: "offset",
						in: "query",
						schema: { type: "number" },
						description: "Number of versions to skip",
					},
				],
				responses: jsonResponse(
					{
						type: "array",
						items: {
							type: "object",
							properties: {
								id: { type: "string" },
								versionId: { type: "string" },
								versionNumber: { type: "number" },
								versionOperation: { type: "string" },
								versionUserId: { type: ["string", "null"] },
								versionCreatedAt: { type: "string", format: "date-time" },
							},
						},
					},
					`Version history for ${name} global`,
				),
			},
		};

		// POST /globals/{name}/revert
		paths[`${prefix}/revert`] = {
			post: {
				operationId: `global_${name}_revertToVersion`,
				summary: `Revert ${name} global to a version`,
				tags: [tag],
				parameters: [stageQueryParameter()],
				requestBody: jsonRequestBody({
					type: "object",
					properties: {
						id: { type: "string" },
						version: { type: "number" },
						versionId: { type: "string" },
					},
				}),
				responses: jsonResponse(
					ref(valueSchemaName),
					`Reverted ${name} global value`,
				),
			},
		};

		// POST /globals/{name}/transition (only for workflow-enabled globals)
		const versioningOpts = state.options?.versioning;
		const hasWorkflow =
			versioningOpts &&
			typeof versioningOpts === "object" &&
			versioningOpts.workflow;
		if (hasWorkflow) {
			paths[`${prefix}/transition`] = {
				post: {
					operationId: `global_${name}_transition`,
					summary: `Transition ${name} global workflow stage`,
					tags: [tag],
					requestBody: jsonRequestBody({
						type: "object",
						required: ["stage"],
						properties: {
							stage: {
								type: "string",
								description: "Target workflow stage",
							},
						},
					}),
					responses: jsonResponse(
						ref(valueSchemaName),
						`Transitioned ${name} global value`,
					),
				},
			};
		}
	}

	return { paths, schemas, tags };
}

function toPascalCase(str: string): string {
	return str
		.replace(/[-_](.)/g, (_, c) => c.toUpperCase())
		.replace(/^(.)/, (_, c) => c.toUpperCase());
}
