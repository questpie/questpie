/**
 * Collection Introspection API
 *
 * Provides runtime introspection of collections for admin UI consumption.
 * Evaluates access control and returns schema with permissions.
 */

import { z } from "zod";
import type { Collection } from "#questpie/server/collection/builder/collection.js";
import { buildCollectionSchemas } from "#questpie/server/collection/builder/field-schema-builder.js";
import type {
	AccessContext,
	AccessRule,
	CollectionBuilderState,
} from "#questpie/server/collection/builder/types.js";
import type { CRUDContext } from "#questpie/server/collection/crud/types.js";
import {
	extractDependencies,
	getDebounce,
	isReactiveConfig,
	type SerializedOptionsConfig,
	type SerializedReactiveConfig,
} from "#questpie/server/fields/reactive.js";
import type {
	FieldDefinition,
	FieldDefinitionState,
	FieldLocation,
	FieldMetadata,
	ReferentialAction,
	RelationFieldMetadata,
} from "#questpie/server/fields/types.js";
import {
	extractWorkflowFromVersioning,
	resolveWorkflowConfig,
} from "#questpie/server/workflow/config.js";
import type { I18nText } from "#questpie/shared/i18n/types.js";

// ============================================================================
// Introspected Schema Types
// ============================================================================

/**
 * Introspected collection schema for admin consumption.
 */
export interface CollectionSchema {
	/** Collection name */
	name: string;

	/** Display label */
	label?: I18nText;

	/** Description */
	description?: I18nText;

	/** Icon component reference */
	icon?: { type: string; props: Record<string, unknown> };

	/** Field schemas */
	fields: Record<string, FieldSchema>;

	/** Access information */
	access: CollectionAccessInfo;

	/** Collection options */
	options: {
		timestamps: boolean;
		softDelete: boolean;
		versioning: boolean;
		workflow?: {
			enabled: boolean;
			initialStage: string;
			stages: Array<{
				name: string;
				label?: string;
				description?: string;
				transitions?: string[];
			}>;
		};
		singleton?: boolean;
	};

	/** Title field configuration */
	title?: {
		field?: string;
		template?: string;
	};

	/** Relations metadata */
	relations: Record<string, RelationSchema>;

	/**
	 * JSON Schema for client-side validation.
	 * Generated from Zod schemas via z.toJSONSchema().
	 *
	 * Contains only synchronous, portable validation rules.
	 * Async/DB validations happen server-side only.
	 */
	validation?: {
		/** JSON Schema for create operations */
		insert?: unknown;

		/** JSON Schema for update operations */
		update?: unknown;
	};

	/**
	 * Admin configuration from .admin(), .list(), .form(), .preview(), .actions()
	 * Only present when adminModule is used.
	 */
	admin?: {
		/** Collection metadata (label, icon, hidden, group, order) */
		config?: AdminCollectionSchema;
		/** List view configuration */
		list?: AdminListViewSchema;
		/** Form view configuration */
		form?: AdminFormViewSchema;
		/** Preview configuration */
		preview?: AdminPreviewSchema;
		/** Actions configuration */
		actions?: AdminActionsSchema;
	};
}

/**
 * Admin collection metadata schema (from .admin())
 */
export interface AdminCollectionSchema {
	/** Display label */
	label?: I18nText;
	/** Description */
	description?: I18nText;
	/** Icon reference */
	icon?: { type: string; props: Record<string, unknown> };
	/** Hide from admin sidebar */
	hidden?: boolean;
	/** Group in sidebar */
	group?: string;
	/** Order within group */
	order?: number;
}

/**
 * Admin list view schema (from .list())
 */
export interface AdminListViewSchema {
	/** View type (table, cards, etc.) */
	view?: string;
	/** Columns to display (field names) */
	columns?: string[];
	/** Default sort configuration */
	defaultSort?: { field: string; direction: "asc" | "desc" };
	/** Searchable fields */
	searchable?: string[];
	/** Filterable fields */
	filterable?: string[];
	/** Actions configuration */
	actions?: {
		header?: { primary?: unknown[]; secondary?: unknown[] };
		row?: unknown[];
		bulk?: unknown[];
	};
}

/**
 * Reactive field config for form views.
 * These are evaluated server-side and results sent to the client.
 */
export interface FormFieldReactiveConfig {
	/** Hide field based on form data */
	hidden?: boolean | { deps: string[] };
	/** Make field read-only based on form data */
	readOnly?: boolean | { deps: string[] };
	/** Disable field based on form data */
	disabled?: boolean | { deps: string[] };
	/** Auto-compute field value from other fields */
	compute?: {
		deps: string[];
		debounce?: number;
	};
}

/**
 * Form field entry - either a simple field name or field with reactive config.
 *
 * @example Simple field
 * ```ts
 * f.name  // resolves to "name"
 * ```
 *
 * @example Field with reactive config
 * ```ts
 * { field: f.slug, compute: { deps: ["title"], debounce: 300 } }
 * { field: f.reason, hidden: { deps: ["status"] } }
 * ```
 */
export type FormFieldEntry =
	| string
	| ({
			/** Field name (use f.fieldName proxy) */
			field: string;
	  } & FormFieldReactiveConfig);

/**
 * Form section layout for form views.
 */
export interface FormSectionLayout {
	type: "section";
	/** Section label */
	label?: I18nText;
	/** Section description */
	description?: I18nText;
	/** Visual wrapper mode */
	wrapper?: "flat" | "collapsible";
	/** Default collapsed state (for collapsible wrapper) */
	defaultCollapsed?: boolean;
	/** Field arrangement mode */
	layout?: "stack" | "inline" | "grid";
	/** Number of columns (for grid layout) */
	columns?: number;
	/** Custom gap (in quarter rems) */
	gap?: number;
	/** Fields in this section */
	fields: FieldLayoutItem[];
	/** Conditional visibility */
	hidden?: boolean;
	/** Custom CSS class */
	className?: string;
}

/**
 * Tab configuration for tabbed form views.
 */
export interface FormTabConfig {
	/** Unique tab identifier */
	id: string;
	/** Tab label */
	label: I18nText;
	/** Tab icon */
	icon?: { type: string; props: Record<string, unknown> };
	/** Fields in this tab */
	fields: FieldLayoutItem[];
	/** Conditional visibility */
	hidden?: boolean;
}

/**
 * Tabs layout for form views.
 */
export interface FormTabsLayout {
	type: "tabs";
	tabs: FormTabConfig[];
}

/**
 * Field layout item - union of field reference or layout container.
 */
export type FieldLayoutItem =
	| string
	| FormFieldEntry
	| FormSectionLayout
	| FormTabsLayout;

/**
 * Form sidebar configuration.
 */
export interface FormSidebarConfig {
	/** Sidebar position (default: "right") */
	position?: "left" | "right";
	/** Fields in the sidebar */
	fields: FieldLayoutItem[];
}

/**
 * Admin form view schema (from .form())
 * Matches FormViewConfig from augmentation.ts
 */
export interface AdminFormViewSchema {
	/** View type (form, wizard, etc.) */
	view?: string;
	/** Main content fields - can contain sections, tabs, or simple field references */
	fields?: FieldLayoutItem[];
	/** Sidebar configuration */
	sidebar?: FormSidebarConfig;
}

/**
 * Admin preview schema (from .preview())
 */
export interface AdminPreviewSchema {
	/** Enable preview panel */
	enabled?: boolean;
	/** Preview panel position */
	position?: "left" | "right" | "bottom";
	/** Default panel width (percentage) */
	defaultWidth?: number;
	/** URL template or pattern (actual URL generation happens server-side) */
	hasUrlBuilder?: boolean;
}

/**
 * Admin actions schema (from .actions())
 */
export interface AdminActionsSchema {
	/** Built-in actions enabled */
	builtin: string[];
	/** Custom actions (without handlers) */
	custom: Array<AdminActionDefinitionSchema>;
}

/**
 * Schema for a custom action definition (without handler)
 */
export interface AdminActionDefinitionSchema {
	/** Unique action ID */
	id: string;
	/** Display label */
	label: I18nText;
	/** Action description */
	description?: I18nText;
	/** Icon reference */
	icon?: { type: string; props: Record<string, unknown> };
	/** Button variant */
	variant?: "default" | "destructive" | "outline" | "secondary" | "ghost";
	/** Where the action appears */
	scope?: "single" | "bulk" | "header" | "row";
	/** Form configuration (for actions with input) */
	form?: {
		title: I18nText;
		description?: I18nText;
		fields: Record<
			string,
			{
				type: string;
				label?: I18nText;
				description?: I18nText;
				required?: boolean;
				default?: unknown;
				options?: unknown;
			}
		>;
		submitLabel?: I18nText;
		cancelLabel?: I18nText;
		width?: "sm" | "md" | "lg" | "xl";
	};
	/** Confirmation dialog */
	confirmation?: {
		title: I18nText;
		description?: I18nText;
		confirmLabel?: I18nText;
		cancelLabel?: I18nText;
		destructive?: boolean;
	};
}

/**
 * Reactive field configuration schema.
 * Sent to client so it knows which fields to watch.
 */
export interface FieldReactiveSchema {
	/** Hidden reactive config */
	hidden?: SerializedReactiveConfig;

	/** ReadOnly reactive config */
	readOnly?: SerializedReactiveConfig;

	/** Disabled reactive config */
	disabled?: SerializedReactiveConfig;

	/** Compute reactive config */
	compute?: SerializedReactiveConfig;

	/** Dynamic options config (for select/relation fields) */
	options?: SerializedOptionsConfig;
}

/**
 * Introspected field schema.
 */
export interface FieldSchema {
	/** Field name (key) */
	name: string;

	/** Full metadata including admin config */
	metadata: FieldMetadata;

	/** Field location */
	location?: FieldLocation;

	/** Field-level access */
	access?: FieldAccessInfo;

	/**
	 * JSON Schema for this specific field.
	 * Useful for inline/per-field validation.
	 */
	validation?: unknown;

	/**
	 * Reactive field configuration.
	 * Contains serialized reactive configs for client-side watching.
	 * Only present if field has reactive behaviors defined.
	 */
	reactive?: FieldReactiveSchema;
}

/**
 * Collection access information.
 */
export interface CollectionAccessInfo {
	/** Can user see this collection at all? */
	visible: boolean;

	/** Access level */
	level: "none" | "filtered" | "full";

	/** Operations access */
	operations: {
		create: AccessResult;
		read: AccessResult;
		update: AccessResult;
		delete: AccessResult;
	};
}

/**
 * Field access information.
 */
export interface FieldAccessInfo {
	read: AccessResult;
	create: AccessResult;
	update: AccessResult;
}

/**
 * Access evaluation result.
 */
export type AccessResult =
	| { allowed: true }
	| { allowed: false; reason?: string }
	| { allowed: "filtered"; where?: unknown };

/**
 * Relation schema for admin.
 */
export interface RelationSchema {
	name: string;
	type: "belongsTo" | "hasMany" | "manyToMany" | "morphTo" | "morphMany";
	targetCollection: string | string[];
	foreignKey?: string;
	through?: string;
	sourceField?: string;
	targetField?: string;
	onDelete?: ReferentialAction;
	onUpdate?: ReferentialAction;
}

/**
 * Synthetic upload system fields added by `.upload()`.
 *
 * `.upload()` extends collection columns/output with these fields, but they are
 * not represented as FieldDefinitions. Introspection adds them so admin clients
 * can render forms/tables consistently (including asset preview).
 */
function getUploadSystemFieldSchemas(): Record<string, FieldSchema> {
	const readOnlyAccess: FieldAccessInfo = {
		read: { allowed: true },
		create: { allowed: false },
		update: { allowed: false },
	};

	return {
		preview: {
			name: "preview",
			location: "virtual",
			access: readOnlyAccess,
			metadata: {
				type: "assetPreview",
				label: {
					key: "defaults.assets.fields.preview.label",
					fallback: "Preview",
				},
				required: false,
				localized: false,
				readOnly: true,
			},
		},
		key: {
			name: "key",
			location: "main",
			access: readOnlyAccess,
			metadata: {
				type: "text",
				label: "Key",
				required: true,
				localized: false,
				readOnly: true,
				validation: {
					maxLength: 255,
				},
			},
		},
		filename: {
			name: "filename",
			location: "main",
			access: readOnlyAccess,
			metadata: {
				type: "text",
				label: {
					key: "defaults.assets.fields.filename.label",
					fallback: "Filename",
				},
				description: {
					key: "defaults.assets.fields.filename.description",
					fallback: "Original filename of the uploaded file",
				},
				required: true,
				localized: false,
				readOnly: true,
				validation: {
					maxLength: 255,
				},
			},
		},
		mimeType: {
			name: "mimeType",
			location: "main",
			access: readOnlyAccess,
			metadata: {
				type: "text",
				label: {
					key: "defaults.assets.fields.mimeType.label",
					fallback: "Type",
				},
				description: {
					key: "defaults.assets.fields.mimeType.description",
					fallback: "MIME type of the file",
				},
				required: true,
				localized: false,
				readOnly: true,
				validation: {
					maxLength: 100,
				},
			},
		},
		size: {
			name: "size",
			location: "main",
			access: readOnlyAccess,
			metadata: {
				type: "number",
				label: {
					key: "defaults.assets.fields.size.label",
					fallback: "Size (bytes)",
				},
				description: {
					key: "defaults.assets.fields.size.description",
					fallback: "File size in bytes",
				},
				required: true,
				localized: false,
				readOnly: true,
				validation: {
					min: 0,
				},
			},
		},
		visibility: {
			name: "visibility",
			location: "main",
			access: {
				read: { allowed: true },
				create: { allowed: false },
				update: { allowed: true },
			},
			metadata: {
				type: "select",
				label: {
					key: "defaults.assets.fields.visibility.label",
					fallback: "Visibility",
				},
				description: {
					key: "defaults.assets.fields.visibility.description",
					fallback:
						"Public files are accessible without authentication. Private files require signed URLs.",
				},
				required: true,
				localized: false,
				options: [
					{
						value: "public",
						label: {
							key: "defaults.assets.fields.visibility.options.public",
							fallback: "Public",
						},
					},
					{
						value: "private",
						label: {
							key: "defaults.assets.fields.visibility.options.private",
							fallback: "Private",
						},
					},
				],
			},
		},
		url: {
			name: "url",
			location: "virtual",
			access: readOnlyAccess,
			metadata: {
				type: "url",
				label: "URL",
				required: false,
				localized: false,
				readOnly: true,
			},
		},
	};
}

// ============================================================================
// Introspection Functions
// ============================================================================

/**
 * Introspect a collection for admin consumption.
 * Evaluates access control and returns schema with permissions.
 */
export async function introspectCollection(
	collection: Collection<CollectionBuilderState>,
	context: CRUDContext, app?: unknown,
): Promise<CollectionSchema> {
	const { state } = collection;
	const fieldDefinitions = state.fieldDefinitions || {};
	const formReactiveByField = extractFormReactiveConfigs(
		(state as any).adminForm,
	);

	// Evaluate collection-level access
	const access = await evaluateCollectionAccess(state, context, app);

	// Build field schemas
	const fields: Record<string, FieldSchema> = {};
	for (const [name, fieldDef] of Object.entries(fieldDefinitions)) {
		const metadata = fieldDef.getMetadata();
		const fieldAccess = await evaluateFieldAccess(fieldDef, context, app);

		// Generate field-level JSON Schema if possible
		let validation: unknown;
		try {
			const zodSchema = fieldDef.toZodSchema();
			validation = z.toJSONSchema(zodSchema);
		} catch {
			// Field doesn't support JSON Schema generation
		}

		// Extract reactive configuration from form config + dynamic field options
		const reactive = extractFieldReactiveConfig(
			fieldDef,
			formReactiveByField[name],
		);

		fields[name] = {
			name,
			metadata,
			location: fieldDef.state.location,
			access: fieldAccess,
			validation,
			...(reactive && { reactive }),
		};
	}

	if (state.upload) {
		const uploadFields = getUploadSystemFieldSchemas();
		for (const [name, schema] of Object.entries(uploadFields)) {
			if (!fields[name]) {
				fields[name] = schema;
			}
		}
	}

	// Build relations metadata
	const relations: Record<string, RelationSchema> = {};
	for (const [name, relationConfig] of Object.entries(state.relations)) {
		relations[name] = {
			name,
			type: mapRelationType(relationConfig.type),
			targetCollection: relationConfig.collection,
			foreignKey: relationConfig.references?.[0],
			through: relationConfig.through,
			sourceField: relationConfig.sourceField,
			targetField: relationConfig.targetField,
			onDelete: relationConfig.onDelete as ReferentialAction,
			onUpdate: relationConfig.onUpdate as ReferentialAction,
		};
	}

	// Also extract relations from field definitions (f.relation fields)
	for (const [name, fieldDef] of Object.entries(fieldDefinitions)) {
		const metadata = fieldDef.getMetadata();
		if (metadata.type === "relation" && !relations[name]) {
			const relMeta = metadata as RelationFieldMetadata;
			relations[name] = {
				name,
				type: mapInferredRelationType(relMeta.relationType),
				targetCollection: relMeta.targetCollection,
				foreignKey: relMeta.foreignKey,
				through: relMeta.through,
				sourceField: relMeta.sourceField,
				targetField: relMeta.targetField,
				onDelete: relMeta.onDelete,
				onUpdate: relMeta.onUpdate,
			};
		}
	}

	// Generate validation schemas from field definitions
	// This respects input/output/virtual attributes on fields
	let validation: CollectionSchema["validation"];
	if (fieldDefinitions && Object.keys(fieldDefinitions).length > 0) {
		try {
			const { insertSchema, updateSchema } = buildCollectionSchemas(
				fieldDefinitions as Record<
					string,
					FieldDefinition<FieldDefinitionState>
				>,
			);
			validation = {
				insert: insertSchema ? z.toJSONSchema(insertSchema) : undefined,
				update: updateSchema ? z.toJSONSchema(updateSchema) : undefined,
			};
		} catch {
			// Schema doesn't support JSON Schema generation
		}
	}

	// Extract admin configuration if present (from adminModule)
	const adminConfig = extractAdminConfig(state);

	return {
		name: state.name,
		// Use admin config label/description/icon if available
		label: adminConfig?.config?.label,
		description: adminConfig?.config?.description,
		// Keep full ComponentReference for icon (client resolves via component registry)
		icon: adminConfig?.config?.icon,
		fields,
		access,
		options: {
			timestamps: state.options?.timestamps !== false,
			softDelete: state.options?.softDelete ?? false,
			versioning: !!state.options?.versioning,
			workflow: resolveWorkflowConfig(
				extractWorkflowFromVersioning(state.options?.versioning),
			),
			singleton: undefined, // TODO(globals): Derive singleton flag from collection config
		},
		title: state.title
			? {
					field: state.title,
				}
			: undefined,
		relations,
		validation,
		admin: adminConfig,
	};
}

/**
 * Extract admin configuration from collection state.
 * These properties are added by adminModule via monkey patching.
 */
function extractAdminConfig(
	state: CollectionBuilderState,
): CollectionSchema["admin"] | undefined {
	// Check if any admin config exists
	const stateAny = state as any;
	const hasAdminConfig =
		stateAny.admin ||
		stateAny.adminList ||
		stateAny.adminForm ||
		stateAny.adminPreview;

	if (!hasAdminConfig) {
		return undefined;
	}

	const result: CollectionSchema["admin"] = {};

	// Extract admin metadata (.admin())
	if (stateAny.admin) {
		result.config = {
			label: stateAny.admin.label,
			description: stateAny.admin.description,
			icon: stateAny.admin.icon,
			hidden: stateAny.admin.hidden,
			group: stateAny.admin.group,
			order: stateAny.admin.order,
		};
	}

	// Extract list view config (.list())
	if (stateAny.adminList) {
		result.list = {
			view: stateAny.adminList.view,
			columns: stateAny.adminList.columns,
			defaultSort: stateAny.adminList.defaultSort,
			searchable: stateAny.adminList.searchable,
			filterable: stateAny.adminList.filterable,
			actions: stateAny.adminList.actions,
		};
	}

	// Extract form view config (.form())
	// Pass through the entire config as-is since FormViewConfig structure
	// uses inline sections/tabs within the fields array
	if (stateAny.adminForm) {
		result.form = {
			view: stateAny.adminForm.view,
			fields: stateAny.adminForm.fields,
			sidebar: stateAny.adminForm.sidebar,
		};
	}

	// Extract preview config (.preview())
	if (stateAny.adminPreview) {
		result.preview = {
			enabled: stateAny.adminPreview.enabled,
			position: stateAny.adminPreview.position,
			defaultWidth: stateAny.adminPreview.defaultWidth,
			// Don't include the url function - just indicate it exists
			hasUrlBuilder: typeof stateAny.adminPreview.url === "function",
		};
	}

	// Extract actions config (.actions())
	if (stateAny.adminActions) {
		const actionsConfig = stateAny.adminActions;

		// Strip handlers from custom actions for client consumption
		const customActions = (actionsConfig.custom || []).map(
			(action: { handler?: unknown; [key: string]: unknown }) => {
				const { handler: _handler, ...rest } = action;
				return rest;
			},
		);

		result.actions = {
			builtin: actionsConfig.builtin || [
				"create",
				"save",
				"delete",
				"deleteMany",
			],
			custom: customActions,
		};
	}

	return result;
}

/**
 * Map relation type from RelationType to RelationSchema type.
 */
function mapRelationType(
	type: "one" | "many" | "manyToMany",
): RelationSchema["type"] {
	switch (type) {
		case "one":
			return "belongsTo";
		case "many":
			return "hasMany";
		case "manyToMany":
			return "manyToMany";
	}
}

/**
 * Map inferred relation type to RelationSchema type.
 */
function mapInferredRelationType(
	type:
		| "belongsTo"
		| "hasMany"
		| "manyToMany"
		| "multiple"
		| "morphTo"
		| "morphMany",
): RelationSchema["type"] {
	switch (type) {
		case "belongsTo":
			return "belongsTo";
		case "hasMany":
			return "hasMany";
		case "manyToMany":
			return "manyToMany";
		case "multiple":
			return "hasMany"; // Multiple is similar to hasMany
		case "morphTo":
			return "morphTo";
		case "morphMany":
			return "morphMany";
	}
}

/**
 * Evaluate collection-level access for current user.
 * Falls back to app defaultAccess, then to requiring session (secure by default).
 */
async function evaluateCollectionAccess(
	state: CollectionBuilderState,
	context: CRUDContext, app?: unknown,
): Promise<CollectionAccessInfo> {
	const { access } = state;
	const appDefaultAccess = (app as any)?.defaultAccess;

	const accessContext: AccessContext = {
		app: app,
		session: context.session,
		db: context.db,
		locale: context.locale,
	};

	const operations = {
		create: await evaluateAccessRule(access?.create ?? appDefaultAccess?.create, accessContext),
		read: await evaluateAccessRule(access?.read ?? appDefaultAccess?.read, accessContext),
		update: await evaluateAccessRule(access?.update ?? appDefaultAccess?.update, accessContext),
		delete: await evaluateAccessRule(access?.delete ?? appDefaultAccess?.delete, accessContext),
	};

	// Determine visibility and level
	const hasAnyAccess = Object.values(operations).some(
		(r) => r.allowed !== false,
	);
	const hasFilteredAccess = Object.values(operations).some(
		(r) => r.allowed === "filtered",
	);
	const hasFullAccess = Object.values(operations).every(
		(r) => r.allowed === true,
	);

	return {
		visible: hasAnyAccess,
		level: hasFullAccess ? "full" : hasFilteredAccess ? "filtered" : "none",
		operations,
	};
}

/**
 * Evaluate a single access rule.
 * When no rule is defined, requires session (secure by default).
 */
async function evaluateAccessRule(
	rule: AccessRule | undefined,
	context: AccessContext,
): Promise<AccessResult> {
	// No rule = require session (secure by default)
	if (rule === undefined) {
		return context.session ? { allowed: true } : { allowed: false };
	}

	if (rule === true) {
		return { allowed: true };
	}

	// Explicit false = denied
	if (rule === false) {
		return { allowed: false };
	}

	// Function = evaluate
	if (typeof rule === "function") {
		try {
			const result = await rule(context);

			// Boolean result
			if (typeof result === "boolean") {
				return result ? { allowed: true } : { allowed: false };
			}

			// Where condition = filtered access
			if (result && typeof result === "object") {
				return { allowed: "filtered", where: result };
			}

			return { allowed: false };
		} catch (error) {
			// Access function threw - deny access
			return {
				allowed: false,
				reason: error instanceof Error ? error.message : "Access denied",
			};
		}
	}

	return { allowed: true };
}

/**
 * Evaluate field-level access for current user.
 */
async function evaluateFieldAccess(
	fieldDef: FieldDefinition<FieldDefinitionState>,
	context: CRUDContext, app?: unknown,
): Promise<FieldAccessInfo | undefined> {
	const fieldAccess = fieldDef.state.config?.access;

	// No field-level access config
	if (!fieldAccess) {
		return undefined;
	}

	const accessContext: AccessContext = {
		app: app,
		session: context.session,
		db: context.db,
		locale: context.locale,
	};

	return {
		read: await evaluateFieldAccessRule(fieldAccess.read, accessContext),
		create: await evaluateFieldAccessRule(fieldAccess.create, accessContext),
		update: await evaluateFieldAccessRule(fieldAccess.update, accessContext),
	};
}

/**
 * Evaluate a field-level access rule.
 */
async function evaluateFieldAccessRule(
	rule: boolean | ((ctx: any) => boolean | Promise<boolean>) | undefined,
	context: AccessContext,
): Promise<AccessResult> {
	// No rule = allowed
	if (rule === undefined || rule === true) {
		return { allowed: true };
	}

	// Explicit false = denied
	if (rule === false) {
		return { allowed: false };
	}

	// Function = evaluate
	if (typeof rule === "function") {
		try {
			const result = await rule(context);
			return result ? { allowed: true } : { allowed: false };
		} catch (error) {
			return {
				allowed: false,
				reason: error instanceof Error ? error.message : "Access denied",
			};
		}
	}

	return { allowed: true };
}

// ============================================================================
// Batch Introspection
// ============================================================================

/**
 * Introspect multiple collections at once.
 * Only returns visible collections based on user access.
 */
export async function introspectCollections(
	collections: Record<string, Collection<CollectionBuilderState>>,
	context: CRUDContext, app?: unknown,
): Promise<Record<string, CollectionSchema>> {
	const schemas: Record<string, CollectionSchema> = {};

	for (const [name, collection] of Object.entries(collections)) {
		const schema = await introspectCollection(collection, context, app);

		// Only include visible collections
		if (schema.access.visible) {
			schemas[name] = schema;
		}
	}

	return schemas;
}

// ============================================================================
// Reactive Field Configuration Extraction
// ============================================================================

/**
 * Reactive properties supported in form field entries.
 */
type ReactiveFormFieldKey = "hidden" | "readOnly" | "disabled" | "compute";

/**
 * Extract reactive configuration from a field definition.
 * Merges form-level reactive config with field-level dynamic options config.
 *
 * @param fieldDef - Field definition to extract reactive config from
 * @param formReactive - Reactive config extracted from form layout for this field
 * @returns Serialized reactive config or undefined if no reactive behavior
 */
function extractFieldReactiveConfig(
	fieldDef: FieldDefinition<FieldDefinitionState>,
	formReactive?: FieldReactiveSchema,
): FieldReactiveSchema | undefined {
	const optionsReactive = extractFieldOptionsReactiveConfig(fieldDef);

	if (!formReactive && !optionsReactive) {
		return undefined;
	}

	return {
		...(formReactive ?? {}),
		...(optionsReactive ?? {}),
	};
}

/**
 * Extract reactive config map from form view configuration.
 * Supports fields in root layout, sections, tabs, and sidebar.
 */
function extractFormReactiveConfigs(
	formConfig: unknown,
): Record<string, FieldReactiveSchema> {
	const result: Record<string, FieldReactiveSchema> = {};

	if (!formConfig || typeof formConfig !== "object") {
		return result;
	}

	const form = formConfig as Record<string, unknown>;

	collectReactiveFromLayoutItems(form.fields, result);
	collectReactiveFromSections(form.sections, result);
	collectReactiveFromTabs(form.tabs, result);

	if (form.sidebar && typeof form.sidebar === "object") {
		const sidebar = form.sidebar as Record<string, unknown>;
		collectReactiveFromLayoutItems(sidebar.fields, result);
	}

	return result;
}

/**
 * Collect reactive configs from layout items recursively.
 */
function collectReactiveFromLayoutItems(
	items: unknown,
	result: Record<string, FieldReactiveSchema>,
): void {
	if (!Array.isArray(items)) {
		return;
	}

	for (const item of items) {
		if (!item || typeof item !== "object") {
			continue;
		}

		const entry = item as Record<string, unknown>;

		if (typeof entry.field === "string") {
			const reactive = serializeFormFieldReactiveConfig(entry);
			if (reactive) {
				const existing = result[entry.field] ?? {};
				result[entry.field] = { ...existing, ...reactive };
			}
			continue;
		}

		if (entry.type === "section") {
			collectReactiveFromLayoutItems(entry.fields, result);
			continue;
		}

		if (entry.type === "tabs") {
			collectReactiveFromTabs(entry.tabs, result);
		}
	}
}

/**
 * Collect reactive configs from sections.
 */
function collectReactiveFromSections(
	sections: unknown,
	result: Record<string, FieldReactiveSchema>,
): void {
	if (!Array.isArray(sections)) {
		return;
	}

	for (const section of sections) {
		if (!section || typeof section !== "object") {
			continue;
		}

		const sectionConfig = section as Record<string, unknown>;
		collectReactiveFromLayoutItems(sectionConfig.fields, result);
	}
}

/**
 * Collect reactive configs from tabs.
 */
function collectReactiveFromTabs(
	tabs: unknown,
	result: Record<string, FieldReactiveSchema>,
): void {
	if (!Array.isArray(tabs)) {
		return;
	}

	for (const tab of tabs) {
		if (!tab || typeof tab !== "object") {
			continue;
		}

		const tabConfig = tab as Record<string, unknown>;
		collectReactiveFromLayoutItems(tabConfig.fields, result);
		collectReactiveFromSections(tabConfig.sections, result);
	}
}

/**
 * Serialize reactive config for a single form field entry.
 */
function serializeFormFieldReactiveConfig(
	fieldEntry: Record<string, unknown>,
): FieldReactiveSchema | undefined {
	const reactiveKeys: ReactiveFormFieldKey[] = [
		"hidden",
		"readOnly",
		"disabled",
		"compute",
	];

	const result: FieldReactiveSchema = {};
	let hasReactive = false;

	for (const key of reactiveKeys) {
		const value = fieldEntry[key];

		if (typeof value === "boolean" || value === undefined) {
			continue;
		}

		if (isReactiveConfig(value)) {
			hasReactive = true;
			result[key] = {
				watch: extractDependencies(value),
				debounce: getDebounce(value),
			};
			continue;
		}

		if (
			value &&
			typeof value === "object" &&
			"deps" in value &&
			Array.isArray((value as { deps?: unknown }).deps)
		) {
			hasReactive = true;
			const serializedValue = value as { deps: string[]; debounce?: unknown };
			result[key] = {
				watch: serializedValue.deps,
				debounce:
					typeof serializedValue.debounce === "number"
						? serializedValue.debounce
						: undefined,
			};
		}
	}

	return hasReactive ? result : undefined;
}

/**
 * Extract reactive options config from field definition.
 */
function extractFieldOptionsReactiveConfig(
	fieldDef: FieldDefinition<FieldDefinitionState>,
): Pick<FieldReactiveSchema, "options"> | undefined {
	const config = fieldDef.state.config as Record<string, unknown> | undefined;

	// Also check for dynamic options on select/relation fields
	const options = config?.options;
	if (options && typeof options === "object" && "handler" in options) {
		// Options is an OptionsConfig - extract deps
		const optionsConfig = options as { handler: unknown; deps?: unknown };

		let watch: string[] = [];
		if (Array.isArray(optionsConfig.deps)) {
			watch = optionsConfig.deps as string[];
		} else if (typeof optionsConfig.deps === "function") {
			// Track deps from function
			const deps = new Set<string>();
			const createProxy = (prefix: string): any =>
				new Proxy({} as any, {
					get(_, prop: string | symbol) {
						if (typeof prop === "symbol" || prop === "then") {
							return undefined;
						}
						const path = prefix ? `${prefix}.${prop}` : prop;
						deps.add(path);
						return createProxy(path);
					},
				});

			try {
				(optionsConfig.deps as (ctx: any) => any[])({
					data: createProxy(""),
					sibling: createProxy("$sibling"),
				});
			} catch {
				// Ignore
			}
			watch = [...deps];
		}

		return {
			options: {
				watch,
				searchable: true,
				paginated: true,
			},
		};
	}

	return undefined;
}
