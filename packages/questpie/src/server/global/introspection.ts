/**
 * Global Introspection API
 *
 * Provides runtime introspection of globals for admin UI consumption.
 * Evaluates access control and returns schema with permissions.
 */

import { z } from "zod";
import { buildFieldBasedSchema } from "#questpie/server/collection/builder/field-schema-builder.js";
import type { CRUDContext } from "#questpie/server/collection/crud/types.js";
import type {
	FieldDefinition,
	FieldDefinitionAccess,
	FieldDefinitionState,
	FieldLocation,
	FieldMetadata,
} from "#questpie/server/fields/types.js";
import type { Global } from "#questpie/server/global/builder/global.js";
import type {
	GlobalAccess,
	GlobalAccessContext,
	GlobalAccessRule,
	GlobalBuilderState,
} from "#questpie/server/global/builder/types.js";
import type { I18nText } from "#questpie/shared/i18n/types.js";

// ============================================================================
// Introspected Schema Types
// ============================================================================

/**
 * Introspected global schema for admin consumption.
 */
export interface GlobalSchema {
	/** Global name */
	name: string;

	/** Display label */
	label?: I18nText;

	/** Description */
	description?: I18nText;

	/** Icon component reference */
	icon?: { type: string; props: Record<string, unknown> };

	/** Field schemas */
	fields: Record<string, GlobalFieldSchema>;

	/** Access information */
	access: GlobalAccessInfo;

	/** Global options */
	options: {
		timestamps: boolean;
		versioning: boolean;
	};

	/**
	 * JSON Schema for client-side validation.
	 * Generated from Zod schemas via z.toJSONSchema().
	 */
	validation?: {
		/** JSON Schema for update operations */
		update?: unknown;
	};

	/**
	 * Admin configuration from .admin(), .form()
	 * Only present when adminModule is used.
	 */
	admin?: {
		/** Global metadata (label, icon, hidden, group, order) */
		config?: AdminGlobalSchema;
		/** Form view configuration */
		form?: AdminFormViewSchema;
	};
}

/**
 * Introspected global field schema.
 */
export interface GlobalFieldSchema {
	/** Field name (key) */
	name: string;

	/** Full metadata including admin config */
	metadata: FieldMetadata;

	/** Field location */
	location: FieldLocation;

	/** Field-level access */
	access?: GlobalFieldAccessInfo;

	/**
	 * JSON Schema for this specific field.
	 */
	validation?: unknown;
}

/**
 * Global access information.
 */
export interface GlobalAccessInfo {
	/** Can user see this global at all? */
	visible: boolean;

	/** Access level */
	level: "none" | "filtered" | "full";

	/** Operations access */
	operations: {
		read: GlobalAccessResult;
		update: GlobalAccessResult;
	};
}

/**
 * Global field access information.
 */
export interface GlobalFieldAccessInfo {
	read: GlobalAccessResult;
	write: GlobalAccessResult;
}

/**
 * Access evaluation result.
 */
export type GlobalAccessResult =
	| { allowed: true }
	| { allowed: false; reason?: string };

/**
 * Admin global metadata schema (from .admin())
 */
export interface AdminGlobalSchema {
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
 */
export type FormFieldEntry =
	| string
	| ({
			/** Field name (use f.fieldName proxy) */
			field: string;
	  } & FormFieldReactiveConfig);

/**
 * Form section with fields that can have inline reactive config.
 */
export interface FormSection {
	label?: I18nText;
	description?: I18nText;
	fields: FormFieldEntry[];
	collapsible?: boolean;
	defaultCollapsed?: boolean;
}

/**
 * Admin form view schema (from .form())
 */
export interface AdminFormViewSchema {
	/** View type (form, wizard, etc.) */
	view?: string;
	/** Fields to include - can be simple names or objects with reactive config */
	fields?: FormFieldEntry[];
	/** Form sections */
	sections?: FormSection[];
	/** Form tabs */
	tabs?: Array<{
		label: I18nText;
		icon?: { type: string; props: Record<string, unknown> };
		sections: FormSection[];
	}>;
}

// ============================================================================
// Introspection Functions
// ============================================================================

/**
 * Introspect a global for admin consumption.
 * Evaluates access control and returns schema with permissions.
 */
export async function introspectGlobal(
	global: Global<GlobalBuilderState>,
	context: CRUDContext,
	cms?: unknown,
): Promise<GlobalSchema> {
	const { state } = global;
	const fieldDefinitions = state.fieldDefinitions || {};

	// Evaluate global-level access
	const access = await evaluateGlobalAccess(state, context, cms);

	// Build field schemas
	const fields: Record<string, GlobalFieldSchema> = {};
	for (const [name, fieldDef] of Object.entries(fieldDefinitions)) {
		const metadata = fieldDef.getMetadata();
		const fieldAccess = await evaluateGlobalFieldAccess(fieldDef, context, cms);

		// Generate field-level JSON Schema if possible
		let validation: unknown;
		try {
			const zodSchema = fieldDef.toZodSchema();
			validation = z.toJSONSchema(zodSchema);
		} catch {
			// Field doesn't support JSON Schema generation
		}

		fields[name] = {
			name,
			metadata,
			location: fieldDef.state.location,
			access: fieldAccess,
			validation,
		};
	}

	// Extract admin configuration if present (from adminModule)
	const adminConfig = extractAdminConfig(state);

	return {
		name: state.name,
		// Use admin config label/description/icon if available
		label: adminConfig?.config?.label,
		description: adminConfig?.config?.description,
		icon: adminConfig?.config?.icon,
		fields,
		access,
		options: {
			timestamps: state.options?.timestamps !== false,
			versioning: !!state.options?.versioning,
		},
		validation: buildGlobalValidation(fieldDefinitions),
		admin: adminConfig,
	};
}

/**
 * Build validation schemas for globals.
 * Uses field definitions as source of truth - respects input/output/virtual attributes.
 */
function buildGlobalValidation(
	fieldDefinitions: Record<string, FieldDefinition<FieldDefinitionState>>,
): GlobalSchema["validation"] {
	if (!fieldDefinitions || Object.keys(fieldDefinitions).length === 0) {
		return undefined;
	}

	try {
		// Globals only need update schema (they are singleton, no "create")
		const updateSchema = buildFieldBasedSchema(fieldDefinitions, "update");
		return {
			update: updateSchema
				? z.toJSONSchema(updateSchema.passthrough())
				: undefined,
		};
	} catch {
		// Schema doesn't support JSON Schema generation
		return undefined;
	}
}

/**
 * Extract admin configuration from global state.
 * These properties are added by adminModule via monkey patching.
 */
function extractAdminConfig(
	state: GlobalBuilderState,
): GlobalSchema["admin"] | undefined {
	// Check if any admin config exists
	const stateAny = state as any;
	const hasAdminConfig = stateAny.admin || stateAny.adminForm;

	if (!hasAdminConfig) {
		return undefined;
	}

	const result: GlobalSchema["admin"] = {};

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

	// Extract form view config (.form())
	if (stateAny.adminForm) {
		result.form = {
			view: stateAny.adminForm.view,
			fields: stateAny.adminForm.fields,
			sections: stateAny.adminForm.sections,
			tabs: stateAny.adminForm.tabs,
		};
	}

	return result;
}

/**
 * Evaluate global-level access for current user.
 */
async function evaluateGlobalAccess(
	state: GlobalBuilderState,
	context: CRUDContext,
	cms?: unknown,
): Promise<GlobalAccessInfo> {
	const { access } = state;

	// No access config = full access
	if (!access || Object.keys(access).length === 0) {
		return {
			visible: true,
			level: "full",
			operations: {
				read: { allowed: true },
				update: { allowed: true },
			},
		};
	}

	const accessContext: GlobalAccessContext = {
		app: cms,
		session: context.session,
		db: context.db,
		locale: context.locale,
	};

	const operations = {
		read: await evaluateAccessRule(access.read, accessContext),
		update: await evaluateAccessRule(access.update, accessContext),
	};

	// Determine visibility and level
	const hasAnyAccess = Object.values(operations).some(
		(r) => r.allowed !== false,
	);
	const hasFullAccess = Object.values(operations).every(
		(r) => r.allowed === true,
	);

	return {
		visible: hasAnyAccess,
		level: hasFullAccess ? "full" : "none",
		operations,
	};
}

/**
 * Evaluate a single access rule.
 */
async function evaluateAccessRule(
	rule: GlobalAccessRule | undefined,
	context: GlobalAccessContext,
): Promise<GlobalAccessResult> {
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

/**
 * Evaluate field-level access for current user.
 */
async function evaluateGlobalFieldAccess(
	fieldDef: FieldDefinition<FieldDefinitionState>,
	context: CRUDContext,
	cms?: unknown,
): Promise<GlobalFieldAccessInfo | undefined> {
	const fieldAccess = fieldDef.state.config?.access as
		| FieldDefinitionAccess
		| undefined;

	// No field-level access config
	if (!fieldAccess) {
		return undefined;
	}

	const req =
		(context as any).req ??
		(context as any).request ??
		(typeof Request !== "undefined"
			? new Request("http://questpie.local")
			: ({} as Request));

	const read = fieldAccess.read;
	const update = fieldAccess.update;

	const evaluateFieldRule = async (
		rule: typeof read | typeof update,
		operation: "read" | "update",
	): Promise<GlobalAccessResult> => {
		if (rule === undefined || rule === true) {
			return { allowed: true };
		}

		if (rule === false) {
			return { allowed: false };
		}

		try {
			const allowed = await rule({
				req,
				user: (context.session as any)?.user,
				doc: undefined,
				operation,
			});
			return allowed ? { allowed: true } : { allowed: false };
		} catch (error) {
			return {
				allowed: false,
				reason: error instanceof Error ? error.message : "Access denied",
			};
		}
	};

	return {
		read: await evaluateFieldRule(read, "read"),
		write: await evaluateFieldRule(update, "update"),
	};
}

// ============================================================================
// Batch Introspection
// ============================================================================

/**
 * Introspect multiple globals at once.
 * Only returns visible globals based on user access.
 */
export async function introspectGlobals(
	globals: Record<string, Global<GlobalBuilderState>>,
	context: CRUDContext,
	cms?: unknown,
): Promise<Record<string, GlobalSchema>> {
	const schemas: Record<string, GlobalSchema> = {};

	for (const [name, global] of Object.entries(globals)) {
		const schema = await introspectGlobal(global, context, cms);

		// Only include visible globals
		if (schema.access.visible) {
			schemas[name] = schema;
		}
	}

	return schemas;
}
