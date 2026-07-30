/**
 * Collection CRUD -> OpenAPI paths generator.
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
	listQueryParameters,
	paginatedResponseSchema,
	ref,
	singleQueryParameters,
	stageQueryParameter,
} from "./schemas.js";

/**
 * Generate OpenAPI paths and component schemas for all collections.
 */
export function generateCollectionPaths(
	app: Questpie<any>,
	config: OpenApiConfig,
): {
	paths: Record<string, Record<string, PathOperation>>;
	schemas: Record<string, unknown>;
	tags: Array<{ name: string; description?: string }>;
} {
	const collections = app.getCollections();
	const basePath = config.basePath ?? "/";
	const excluded = new Set(config.exclude?.collections ?? []);
	const paths: Record<string, Record<string, PathOperation>> = {};
	const schemas: Record<string, unknown> = {};
	const tags: Array<{ name: string; description?: string }> = [];

	for (const [name, collection] of Object.entries(collections)) {
		if (excluded.has(name)) continue;

		const state = (collection as any).state;
		if (!state) continue;
		const optimisticLock = state.options?.optimisticLock as
			| { field: string; required: true }
			| undefined;

		const tag = `Collections: ${name}`;
		tags.push({ name: tag, description: `CRUD operations for ${name}` });

		// Generate schemas from validation
		const pascalName = toPascalCase(name);
		const documentSchemaName = `${pascalName}Document`;
		const insertSchemaName = `${pascalName}Insert`;
		const updateSchemaName = `${pascalName}Update`;
		const fieldDefinitionSchema = buildFieldDefinitionSchemas(
			state.fieldDefinitions,
		);

		// Request schemas preserve custom validation when present, then apply
		// field input/output flags from field definitions.
		if (state.validation?.insertSchema) {
			try {
				const insertSchema = z.toJSONSchema(state.validation.insertSchema, {
					unrepresentable: "any",
				});
				applyRequestFieldFlags(insertSchema, state.fieldDefinitions);
				schemas[insertSchemaName] = insertSchema;
			} catch {
				schemas[insertSchemaName] = {
					type: "object",
					description: `Insert schema for ${name}`,
				};
			}
		} else if (fieldDefinitionSchema != null) {
			schemas[insertSchemaName] = fieldDefinitionSchema.insert;
		} else {
			schemas[insertSchemaName] = {
				type: "object",
				description: `Insert schema for ${name}`,
			};
		}

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
					description: `Update schema for ${name}`,
				};
			}
		} else if (fieldDefinitionSchema != null) {
			schemas[updateSchemaName] = fieldDefinitionSchema.update;
		} else {
			schemas[updateSchemaName] = {
				type: "object",
				description: `Update schema for ${name}`,
			};
		}
		if (optimisticLock) {
			omitObjectProperty(schemas[updateSchemaName], optimisticLock.field);
		}

		// Document schema — the response shape, includes id + timestamps
		schemas[documentSchemaName] = buildDocumentSchema(
			name,
			state,
			insertSchemaName,
			fieldDefinitionSchema?.response,
		);

		const prefix = `${basePath}/${name}`;

		// GET /{collection} — list
		// POST /{collection} — create
		paths[prefix] = {
			get: {
				operationId: `${name}_find`,
				summary: `List ${name}`,
				tags: [tag],
				parameters: listQueryParameters(),
				responses: jsonResponse(
					paginatedResponseSchema(ref(documentSchemaName)),
					`Paginated list of ${name}`,
				),
			},
			post: {
				operationId: `${name}_create`,
				summary: `Create ${name}`,
				tags: [tag],
				parameters: [stageQueryParameter()],
				requestBody: jsonRequestBody(ref(insertSchemaName)),
				responses: jsonResponse(
					ref(documentSchemaName),
					`Created ${name} record`,
				),
			},
			patch: {
				operationId: `${name}_updateMany`,
				summary: `Update many ${name}`,
				tags: [tag],
				parameters: [stageQueryParameter()],
				requestBody: jsonRequestBody({
					type: "object",
					required: [
						"where",
						"data",
						...(optimisticLock ? ["expectedVersions"] : []),
					],
					properties: {
						where: {
							type: "object",
							description: "Filter conditions for records to update",
						},
						data: ref(updateSchemaName),
						...(optimisticLock
							? {
									expectedVersions: expectedVersionsSchema(),
								}
							: {}),
					},
				}),
				responses: withOptimisticLockConflict(
					jsonResponse(
						{ type: "array", items: ref(documentSchemaName) },
						`Updated ${name} records`,
					),
					Boolean(optimisticLock),
				),
			},
		};

		// GET /{collection}/count
		paths[`${prefix}/count`] = {
			get: {
				operationId: `${name}_count`,
				summary: `Count ${name}`,
				tags: [tag],
				parameters: [
					{
						name: "where",
						in: "query",
						schema: { type: "string" },
						description: "Filter conditions (JSON encoded)",
					},
				],
				responses: jsonResponse(ref("CountResponse"), `Count of ${name}`),
			},
		};

		// POST /{collection}/delete-many
		paths[`${prefix}/delete-many`] = {
			post: {
				operationId: `${name}_deleteMany`,
				summary: `Delete many ${name}`,
				tags: [tag],
				requestBody: jsonRequestBody({
					type: "object",
					required: ["where", ...(optimisticLock ? ["expectedVersions"] : [])],
					properties: {
						where: {
							type: "object",
							description: "Filter conditions for records to delete",
						},
						...(optimisticLock
							? {
									expectedVersions: expectedVersionsSchema(),
								}
							: {}),
					},
				}),
				responses: withOptimisticLockConflict(
					jsonResponse(
						ref("DeleteManyResponse"),
						`Delete multiple ${name} records`,
					),
					Boolean(optimisticLock),
				),
			},
		};

		// POST /{collection}/update-batch
		paths[`${prefix}/update-batch`] = {
			post: {
				operationId: `${name}_updateBatch`,
				summary: `Update a batch of ${name}`,
				tags: [tag],
				requestBody: jsonRequestBody({
					type: "object",
					required: ["updates"],
					properties: {
						updates: {
							type: "array",
							items: {
								type: "object",
								required: [
									"id",
									"data",
									...(optimisticLock ? ["expectedVersion"] : []),
								],
								properties: {
									id: { type: "string" },
									data: ref(updateSchemaName),
									...(optimisticLock
										? { expectedVersion: expectedVersionSchema() }
										: {}),
								},
							},
						},
					},
				}),
				responses: withOptimisticLockConflict(
					jsonResponse(
						{ type: "array", items: ref(documentSchemaName) },
						`Updated ${name} batch`,
					),
					Boolean(optimisticLock),
				),
			},
		};

		// POST /{collection}/upload (if upload is configured)
		if (state.upload) {
			paths[`${prefix}/upload`] = {
				post: {
					operationId: `${name}_upload`,
					summary: `Upload file to ${name}`,
					tags: [tag],
					requestBody: {
						required: true,
						content: {
							"multipart/form-data": {
								schema: {
									type: "object",
									properties: {
										file: { type: "string", format: "binary" },
									},
									required: ["file"],
								},
							},
						},
					},
					responses: jsonResponse(
						ref(documentSchemaName),
						`Uploaded file record`,
					),
				},
			};
		}

		// GET /{collection}/schema
		paths[`${prefix}/schema`] = {
			get: {
				operationId: `${name}_schema`,
				summary: `Get ${name} introspection schema`,
				tags: [tag],
				responses: jsonResponse(
					{ type: "object", description: "Introspected collection schema" },
					`Introspection schema for ${name}`,
				),
			},
		};

		// GET /{collection}/meta
		paths[`${prefix}/meta`] = {
			get: {
				operationId: `${name}_meta`,
				summary: `Get ${name} metadata`,
				tags: [tag],
				responses: jsonResponse(
					{ type: "object", description: "Collection metadata" },
					`Metadata for ${name}`,
				),
			},
		};

		const idParam = {
			name: "id",
			in: "path",
			required: true,
			schema: { type: "string" },
			description: "Record ID",
		};

		// GET /{collection}/{id}
		// PATCH /{collection}/{id}
		// DELETE /{collection}/{id}
		paths[`${prefix}/{id}`] = {
			get: {
				operationId: `${name}_findOne`,
				summary: `Get ${name} by ID`,
				tags: [tag],
				parameters: [idParam, ...singleQueryParameters()],
				responses: jsonResponse(
					ref(documentSchemaName),
					`Single ${name} record`,
				),
			},
			patch: {
				operationId: `${name}_update`,
				summary: `Update ${name}`,
				tags: [tag],
				parameters: [idParam, stageQueryParameter()],
				requestBody: jsonRequestBody(
					optimisticLock
						? {
								type: "object",
								required: ["data", "expectedVersion"],
								properties: {
									data: ref(updateSchemaName),
									expectedVersion: expectedVersionSchema(),
								},
							}
						: ref(updateSchemaName),
				),
				responses: withOptimisticLockConflict(
					jsonResponse(ref(documentSchemaName), `Updated ${name} record`),
					Boolean(optimisticLock),
				),
			},
			delete: {
				operationId: `${name}_delete`,
				summary: `Delete ${name}`,
				tags: [tag],
				parameters: [idParam, stageQueryParameter()],
				...(optimisticLock
					? {
							requestBody: jsonRequestBody({
								type: "object",
								required: ["expectedVersion"],
								properties: {
									expectedVersion: expectedVersionSchema(),
								},
							}),
						}
					: {}),
				responses: withOptimisticLockConflict(
					jsonResponse(ref("SuccessResponse"), `Deleted ${name} record`),
					Boolean(optimisticLock),
				),
			},
		};

		// POST /{collection}/{id}/restore (if softDelete is enabled)
		if (state.options?.softDelete) {
			paths[`${prefix}/{id}/restore`] = {
				post: {
					operationId: `${name}_restore`,
					summary: `Restore deleted ${name}`,
					tags: [tag],
					parameters: [idParam, stageQueryParameter()],
					...(optimisticLock
						? {
								requestBody: jsonRequestBody({
									type: "object",
									required: ["expectedVersion"],
									properties: {
										expectedVersion: expectedVersionSchema(),
									},
								}),
							}
						: {}),
					responses: withOptimisticLockConflict(
						jsonResponse(ref(documentSchemaName), `Restored ${name} record`),
						Boolean(optimisticLock),
					),
				},
			};
			paths[`${prefix}/{id}/purge`] = {
				post: {
					operationId: `${name}_purge`,
					summary: `Permanently purge deleted ${name}`,
					tags: [tag],
					parameters: [idParam, ...singleQueryParameters()],
					responses: jsonResponse(
						ref("SuccessResponse"),
						`Permanently purged ${name} record`,
					),
				},
			};
		}

		// GET /{collection}/{id}/versions
		paths[`${prefix}/{id}/versions`] = {
			get: {
				operationId: `${name}_findVersions`,
				summary: `List ${name} versions`,
				tags: [tag],
				parameters: [
					idParam,
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
					`Version history for ${name}`,
				),
			},
		};

		// POST /{collection}/{id}/revert
		paths[`${prefix}/{id}/revert`] = {
			post: {
				operationId: `${name}_revertToVersion`,
				summary: `Revert ${name} to a version`,
				tags: [tag],
				parameters: [idParam, stageQueryParameter()],
				requestBody: jsonRequestBody({
					type: "object",
					...(optimisticLock ? { required: ["expectedVersion"] } : {}),
					properties: {
						version: { type: "number" },
						versionId: { type: "string" },
						...(optimisticLock
							? { expectedVersion: expectedVersionSchema() }
							: {}),
					},
				}),
				responses: withOptimisticLockConflict(
					jsonResponse(ref(documentSchemaName), `Reverted ${name} record`),
					Boolean(optimisticLock),
				),
			},
		};

		// POST /{collection}/{id}/transition (only for workflow-enabled collections)
		const versioningOpts = state.options?.versioning;
		const hasWorkflow =
			versioningOpts &&
			typeof versioningOpts === "object" &&
			versioningOpts.workflow;
		if (hasWorkflow) {
			paths[`${prefix}/{id}/transition`] = {
				post: {
					operationId: `${name}_transition`,
					summary: `Transition ${name} workflow stage`,
					tags: [tag],
					parameters: [idParam],
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
						ref(documentSchemaName),
						`Transitioned ${name} record`,
					),
				},
			};
		}
	}

	return { paths, schemas, tags };
}

/**
 * Build a document response schema that extends the insert schema with
 * standard fields (id, timestamps).
 */
function buildDocumentSchema(
	name: string,
	state: any,
	insertSchemaName: string,
	documentFieldsSchema?: unknown,
) {
	const properties: Record<string, unknown> = {
		id: { type: "string" },
	};

	if (state.options?.timestamps !== false) {
		properties.createdAt = { type: "string", format: "date-time" };
		properties.updatedAt = { type: "string", format: "date-time" };
	}

	if (state.options?.softDelete) {
		properties.deletedAt = {
			type: ["string", "null"],
			format: "date-time",
		};
	}

	return {
		allOf: [
			{ type: "object", properties, required: ["id"] },
			documentFieldsSchema ?? ref(insertSchemaName),
		],
		description: `${name} document`,
	};
}

function expectedVersionSchema() {
	return {
		type: "number",
		description: "Version read before starting the mutation",
	};
}

function expectedVersionsSchema() {
	return {
		type: "array",
		description: "Exact expected-version coverage for every selected record",
		items: {
			type: "object",
			required: ["id", "expectedVersion"],
			properties: {
				id: { type: "string" },
				expectedVersion: expectedVersionSchema(),
			},
		},
	};
}

function withOptimisticLockConflict(
	responses: Record<string, unknown>,
	enabled: boolean,
) {
	if (!enabled) return responses;
	return {
		...responses,
		"409": {
			description: "Optimistic lock conflict",
			content: {
				"application/json": { schema: ref("ErrorResponse") },
			},
		},
	};
}

function omitObjectProperty(schema: unknown, field: string): void {
	if (!schema || typeof schema !== "object") return;
	const objectSchema = schema as {
		properties?: Record<string, unknown>;
		required?: string[];
	};
	if (objectSchema.properties) {
		delete objectSchema.properties[field];
	}
	if (objectSchema.required) {
		objectSchema.required = objectSchema.required.filter(
			(requiredField) => requiredField !== field,
		);
	}
}

function toPascalCase(str: string): string {
	return str
		.replace(/[-_](.)/g, (_, c) => c.toUpperCase())
		.replace(/^(.)/, (_, c) => c.toUpperCase());
}
