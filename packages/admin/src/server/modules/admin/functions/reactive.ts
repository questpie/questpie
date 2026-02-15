/**
 * Reactive Field RPC Endpoints
 *
 * Provides server-side execution of reactive field handlers:
 * - /reactive: Batch endpoint for compute, hidden, readOnly, disabled
 * - /options: Dynamic options for select/relation fields
 */

import type {
	OptionsContext,
	ReactiveContext,
	ReactiveServerContext,
} from "questpie";
import { fn, type Questpie } from "questpie";
import { z } from "zod";

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get typed CMS app from context.
 */
function getApp(ctx: { app: unknown }): Questpie<any> {
	return ctx.app as Questpie<any>;
}

/**
 * Build ReactiveContext from request data.
 */
function buildReactiveContext(
	formData: Record<string, any>,
	siblingData: Record<string, any> | null,
	prevData: Record<string, any> | null,
	prevSiblingData: Record<string, any> | null,
	serverCtx: ReactiveServerContext,
): ReactiveContext {
	return {
		data: formData,
		sibling: siblingData || {},
		prev: {
			data: prevData || formData,
			sibling: prevSiblingData || siblingData || {},
		},
		ctx: serverCtx,
	};
}

/**
 * Build OptionsContext from request data.
 */
function buildOptionsContext(
	formData: Record<string, any>,
	siblingData: Record<string, any> | null,
	search: string,
	page: number,
	limit: number,
	serverCtx: ReactiveServerContext,
): OptionsContext {
	return {
		data: formData,
		sibling: siblingData || {},
		search,
		page,
		limit,
		ctx: serverCtx,
	};
}

/**
 * Get collection builder by name.
 */
function getCollection(cms: Questpie<any>, collectionName: string) {
	const collections = cms.getCollections();
	const collection = collections[collectionName];
	if (!collection) {
		throw new Error(`Collection '${collectionName}' not found`);
	}

	return collection;
}

/**
 * Get global builder by name.
 */
function getGlobal(cms: Questpie<any>, globalName: string) {
	const globals = cms.getGlobals();
	const global = globals[globalName];
	if (!global) {
		throw new Error(`Global '${globalName}' not found`);
	}

	return global;
}

/**
 * Get entity (collection or global) builder by name and type.
 */
function getEntity(
	cms: Questpie<any>,
	entityName: string,
	type: "collection" | "global",
) {
	if (type === "global") {
		return getGlobal(cms, entityName);
	}
	return getCollection(cms, entityName);
}

/**
 * Get field definition from collection or global.
 */
function getFieldDefinition(
	cms: Questpie<any>,
	entityName: string,
	fieldPath: string,
	type: "collection" | "global" = "collection",
) {
	const entity = getEntity(cms, entityName, type);

	const fieldDefinitions = entity.state.fieldDefinitions || {};

	// Handle nested field paths (e.g., "items.0.variant" -> "items.variant")
	const parts = fieldPath.split(".");
	let currentDefs: Record<string, any> = fieldDefinitions;
	let fieldDef: any = null;

	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];

		// Skip numeric indices (array positions)
		if (/^\d+$/.test(part)) {
			continue;
		}

		if (currentDefs[part]) {
			fieldDef = currentDefs[part];

			// Check for nested fields (object/array)
			if (fieldDef.getNestedFields) {
				currentDefs = fieldDef.getNestedFields();
			} else if (fieldDef.state?.config?.of) {
				// Array field - get the "of" field's nested fields
				const ofField = fieldDef.state.config.of;
				if (ofField?.getNestedFields) {
					currentDefs = ofField.getNestedFields();
				}
			}
		} else {
			throw new Error(`Field '${part}' not found in path '${fieldPath}'`);
		}
	}

	if (!fieldDef) {
		const entityType = type === "global" ? "global" : "collection";
		throw new Error(
			`Field '${fieldPath}' not found in ${entityType} '${entityName}'`,
		);
	}

	return fieldDef;
}

/**
 * Remove numeric indices from nested field paths.
 */
function normalizeFieldPath(fieldPath: string): string {
	return fieldPath
		.split(".")
		.filter((part) => !/^\d+$/.test(part))
		.join(".");
}

/**
 * Generate candidate field paths for matching form entries.
 */
function getFieldPathCandidates(fieldPath: string): Set<string> {
	const normalized = normalizeFieldPath(fieldPath);
	const candidates = new Set<string>([normalized]);

	const parts = normalized.split(".");
	if (parts.length > 1) {
		const leaf = parts[parts.length - 1];
		if (leaf) {
			candidates.add(leaf);
		}
	}

	return candidates;
}

/**
 * Find a reactive field entry in form layout items recursively.
 */
function findReactiveFieldEntryInLayoutItems(
	items: unknown,
	fieldCandidates: Set<string>,
): Record<string, unknown> | null {
	if (!Array.isArray(items)) {
		return null;
	}

	for (const item of items) {
		if (!item || typeof item !== "object") {
			continue;
		}

		const entry = item as Record<string, unknown>;

		if (typeof entry.field === "string" && fieldCandidates.has(entry.field)) {
			return entry;
		}

		if (entry.type === "section") {
			const found = findReactiveFieldEntryInLayoutItems(
				entry.fields,
				fieldCandidates,
			);
			if (found) {
				return found;
			}
			continue;
		}

		if (entry.type === "tabs") {
			const found = findReactiveFieldEntryInTabs(entry.tabs, fieldCandidates);
			if (found) {
				return found;
			}
		}
	}

	return null;
}

/**
 * Find a reactive field entry in form sections.
 */
function findReactiveFieldEntryInSections(
	sections: unknown,
	fieldCandidates: Set<string>,
): Record<string, unknown> | null {
	if (!Array.isArray(sections)) {
		return null;
	}

	for (const section of sections) {
		if (!section || typeof section !== "object") {
			continue;
		}

		const sectionConfig = section as Record<string, unknown>;
		const found = findReactiveFieldEntryInLayoutItems(
			sectionConfig.fields,
			fieldCandidates,
		);

		if (found) {
			return found;
		}
	}

	return null;
}

/**
 * Find a reactive field entry in form tabs.
 */
function findReactiveFieldEntryInTabs(
	tabs: unknown,
	fieldCandidates: Set<string>,
): Record<string, unknown> | null {
	if (!Array.isArray(tabs)) {
		return null;
	}

	for (const tab of tabs) {
		if (!tab || typeof tab !== "object") {
			continue;
		}

		const tabConfig = tab as Record<string, unknown>;

		const fromFields = findReactiveFieldEntryInLayoutItems(
			tabConfig.fields,
			fieldCandidates,
		);
		if (fromFields) {
			return fromFields;
		}

		const fromSections = findReactiveFieldEntryInSections(
			tabConfig.sections,
			fieldCandidates,
		);
		if (fromSections) {
			return fromSections;
		}
	}

	return null;
}

/**
 * Find field entry config from collection form configuration.
 */
function findReactiveFieldEntry(
	formConfig: unknown,
	fieldPath: string,
): Record<string, unknown> | null {
	if (!formConfig || typeof formConfig !== "object") {
		return null;
	}

	const fieldCandidates = getFieldPathCandidates(fieldPath);
	const form = formConfig as Record<string, unknown>;

	const fromFields = findReactiveFieldEntryInLayoutItems(
		form.fields,
		fieldCandidates,
	);
	if (fromFields) {
		return fromFields;
	}

	const fromSections = findReactiveFieldEntryInSections(
		form.sections,
		fieldCandidates,
	);
	if (fromSections) {
		return fromSections;
	}

	const fromTabs = findReactiveFieldEntryInTabs(form.tabs, fieldCandidates);
	if (fromTabs) {
		return fromTabs;
	}

	if (form.sidebar && typeof form.sidebar === "object") {
		const sidebar = form.sidebar as Record<string, unknown>;
		return findReactiveFieldEntryInLayoutItems(sidebar.fields, fieldCandidates);
	}

	return null;
}

/**
 * Get reactive handler from collection/global form config.
 */
function getReactiveHandler(
	cms: Questpie<any>,
	entityName: string,
	fieldPath: string,
	handlerType: "hidden" | "readOnly" | "disabled" | "compute",
	type: "collection" | "global" = "collection",
): ((ctx: ReactiveContext) => any) | null {
	const entity = getEntity(cms, entityName, type);
	const formConfig = (entity.state as any).adminForm;

	const fieldEntry = findReactiveFieldEntry(formConfig, fieldPath);
	if (!fieldEntry) {
		return null;
	}

	const handlerConfig = fieldEntry[handlerType];
	if (!handlerConfig || typeof handlerConfig === "boolean") {
		return null;
	}

	if (typeof handlerConfig === "function") {
		return handlerConfig as (ctx: ReactiveContext) => any;
	}

	if (
		typeof handlerConfig === "object" &&
		handlerConfig !== null &&
		"handler" in handlerConfig &&
		typeof (handlerConfig as { handler?: unknown }).handler === "function"
	) {
		return (handlerConfig as { handler: (ctx: ReactiveContext) => any })
			.handler;
	}

	return null;
}

/**
 * Get options handler from field config.
 */
function getOptionsHandler(
	fieldDef: any,
): ((ctx: OptionsContext) => any) | null {
	const config = fieldDef.state?.config;
	const options = config?.options;

	if (!options) return null;

	// Check if it's a dynamic options config
	if (typeof options === "object" && "handler" in options) {
		return options.handler;
	}

	return null;
}

// ============================================================================
// Schemas
// ============================================================================

/**
 * Single reactive request in a batch.
 */
const reactiveRequestSchema = z.object({
	/** Field path (supports nested paths like "items.0.variant") */
	field: z.string(),

	/** Type of reactive operation */
	type: z.enum(["hidden", "readOnly", "disabled", "compute"]),

	/** Current form data */
	formData: z.record(z.string(), z.unknown()),

	/** Sibling data (for array items) */
	siblingData: z.record(z.string(), z.unknown()).nullable().optional(),

	/** Previous form data (for change detection) */
	prevData: z.record(z.string(), z.unknown()).nullable().optional(),

	/** Previous sibling data */
	prevSiblingData: z.record(z.string(), z.unknown()).nullable().optional(),
});

/**
 * Batch reactive request.
 */
const batchReactiveInputSchema = z.object({
	/** Collection or global name */
	collection: z.string(),

	/** Entity type - collection or global */
	type: z.enum(["collection", "global"]).default("collection"),

	/** Array of reactive requests */
	requests: z.array(reactiveRequestSchema),
});

/**
 * Single reactive result.
 */
const reactiveResultSchema = z.object({
	/** Field path */
	field: z.string(),

	/** Type of reactive operation */
	type: z.enum(["hidden", "readOnly", "disabled", "compute"]),

	/** Computed value */
	value: z.unknown(),

	/** Error message if handler failed */
	error: z.string().optional(),
});

/**
 * Batch reactive response.
 */
const batchReactiveOutputSchema = z.object({
	results: z.array(reactiveResultSchema),
});

/**
 * Options request.
 */
const optionsInputSchema = z.object({
	/** Collection or global name */
	collection: z.string(),

	/** Entity type - collection or global */
	type: z.enum(["collection", "global"]).default("collection"),

	/** Field path */
	field: z.string(),

	/** Current form data */
	formData: z.record(z.string(), z.unknown()),

	/** Sibling data (for array items) */
	siblingData: z.record(z.string(), z.unknown()).nullable().optional(),

	/** Search query */
	search: z.string().default(""),

	/** Page number (0-based) */
	page: z.number().int().min(0).default(0),

	/** Items per page */
	limit: z.number().int().min(1).max(100).default(20),
});

/**
 * Options response.
 */
const optionsOutputSchema = z.object({
	options: z.array(
		z.object({
			value: z.union([z.string(), z.number()]),
			label: z.union([z.string(), z.record(z.string(), z.string())]),
		}),
	),
	hasMore: z.boolean().optional(),
	total: z.number().optional(),
});

// ============================================================================
// RPC Functions
// ============================================================================

/**
 * Batch reactive endpoint.
 * Executes multiple reactive handlers in a single request.
 */
export const batchReactive = fn({
	type: "query",
	schema: batchReactiveInputSchema,
	outputSchema: batchReactiveOutputSchema,

	handler: async (ctx) => {
		const cms = getApp(ctx);
		const { collection: entityName, type: entityType, requests } = ctx.input;

		// Build server context (req is not available in function handlers)
		const serverCtx: ReactiveServerContext = {
			db: ctx.db,
			user: ctx.session?.user ?? null,
			req: new Request("http://localhost"), // Placeholder - not used in handlers
			locale: ctx.locale ?? "en",
		};

		const results: z.infer<typeof reactiveResultSchema>[] = [];

		for (const request of requests) {
			const { field, type, formData, siblingData, prevData, prevSiblingData } =
				request;

			try {
				// Get field definition
				getFieldDefinition(cms, entityName, field, entityType);

				// Get reactive handler
				const handler = getReactiveHandler(
					cms,
					entityName,
					field,
					type,
					entityType,
				);

				if (!handler) {
					// No handler found - skip
					results.push({
						field,
						type,
						value: undefined,
						error: `No ${type} handler found for field '${field}'`,
					});
					continue;
				}

				// Build context
				const reactiveCtx = buildReactiveContext(
					formData as Record<string, any>,
					siblingData as Record<string, any> | null,
					prevData as Record<string, any> | null,
					prevSiblingData as Record<string, any> | null,
					serverCtx,
				);

				// Execute handler
				const value = await handler(reactiveCtx);

				results.push({
					field,
					type,
					value,
				});
			} catch (error) {
				// Handler error - return error message
				results.push({
					field,
					type,
					value: undefined,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}

		return { results };
	},
});

/**
 * Dynamic options endpoint.
 * Fetches options for select/relation fields with search and pagination.
 */
export const fieldOptions = fn({
	type: "query",
	schema: optionsInputSchema,
	outputSchema: optionsOutputSchema,

	handler: async (ctx) => {
		const cms = getApp(ctx);
		const {
			collection: entityName,
			type: entityType,
			field,
			formData,
			siblingData,
			search,
			page,
			limit,
		} = ctx.input;

		// Build server context (req is not available in function handlers)
		const serverCtx: ReactiveServerContext = {
			db: ctx.db,
			user: ctx.session?.user ?? null,
			req: new Request("http://localhost"), // Placeholder - not used in handlers
			locale: ctx.locale ?? "en",
		};

		try {
			// Get field definition
			const fieldDef = getFieldDefinition(cms, entityName, field, entityType);

			// Get options handler
			const handler = getOptionsHandler(fieldDef);

			if (!handler) {
				// No dynamic handler - check for static options
				const config = fieldDef.state?.config;
				if (Array.isArray(config?.options)) {
					// Static options - filter by search
					let options = config.options as Array<{
						value: string | number;
						label: string | Record<string, string>;
					}>;

					if (search) {
						const searchLower = search.toLowerCase();
						options = options.filter((opt) => {
							const label =
								typeof opt.label === "string"
									? opt.label
									: Object.values(opt.label).join(" ");
							return label.toLowerCase().includes(searchLower);
						});
					}

					// Paginate
					const start = page * limit;
					const paginatedOptions = options.slice(start, start + limit);

					return {
						options: paginatedOptions,
						hasMore: start + limit < options.length,
						total: options.length,
					};
				}

				// No options at all
				return {
					options: [],
					hasMore: false,
				};
			}

			// Build context
			const optionsCtx = buildOptionsContext(
				formData as Record<string, any>,
				siblingData as Record<string, any> | null,
				search,
				page,
				limit,
				serverCtx,
			);

			// Execute handler
			const result = await handler(optionsCtx);

			return {
				options: result.options || [],
				hasMore: result.hasMore,
				total: result.total,
			};
		} catch (error) {
			console.error(
				`Error fetching options for ${entityName}.${field}:`,
				error,
			);
			return {
				options: [],
				hasMore: false,
			};
		}
	},
});

/**
 * Reactive functions bundle.
 */
export const reactiveFunctions = {
	batchReactive,
	fieldOptions,
} as const;
