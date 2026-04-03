/**
 * Action System Types
 *
 * Server-side action definitions, handlers, forms, and context types
 * for the collection action system.
 */

import type { I18nText } from "questpie/shared";

import type { ComponentReference } from "./common.js";
import type { ComponentFactory } from "./views.js";

// ============================================================================
// Server-Side Action System
// ============================================================================

/**
 * Action result types returned from action handlers.
 */
export type ServerActionResult =
	| ServerActionSuccess
	| ServerActionError
	| ServerActionRedirect
	| ServerActionDownload;

/**
 * Successful action result
 */
export interface ServerActionSuccess {
	type: "success";
	/** Toast notification to show */
	toast?: {
		message: string;
		title?: string;
	};
	/** Side effects to trigger */
	effects?: ServerActionEffects;
}

/**
 * Error action result
 */
export interface ServerActionError {
	type: "error";
	/** Toast notification to show */
	toast?: {
		message: string;
		title?: string;
	};
	/** Field-level errors */
	errors?: Record<string, string>;
}

/**
 * Redirect action result
 */
export interface ServerActionRedirect {
	type: "redirect";
	/** URL to redirect to */
	url: string;
	/** Open in new tab */
	external?: boolean;
}

/**
 * Download action result
 */
export interface ServerActionDownload {
	type: "download";
	/** File data */
	file: {
		name: string;
		content: string | Uint8Array;
		mimeType: string;
	};
}

/**
 * Action side effects
 */
export interface ServerActionEffects {
	/** Close the action modal */
	closeModal?: boolean;
	/** Invalidate queries (true = all, string[] = specific collections) */
	invalidate?: boolean | string[];
	/** Redirect after success */
	redirect?: string;
}

/**
 * Action handler context
 */
export interface ServerActionContext<TData = Record<string, unknown>> {
	/** Form data submitted */
	data: TData;
	/** Item ID (for single-item actions) */
	itemId?: string;
	/** Item IDs (for bulk actions) */
	itemIds?: string[];
	/** Auth instance (Better Auth API) */
	auth: any;
	/** Collection CRUD APIs */
	collections: any;
	/** Global CRUD APIs */
	globals: any;
	/** Database client */
	db: unknown;
	/** Current user session */
	session?: unknown;
	/** Current locale */
	locale?: string;
}

/**
 * Action handler function type
 */
export type ServerActionHandler<TData = Record<string, unknown>> = (
	ctx: ServerActionContext<TData>,
) => Promise<ServerActionResult> | ServerActionResult;

/**
 * Server-side action form field definition.
 * Can be either a field definition from the registry or a simple config object.
 */
export type ServerActionFormField =
	| ServerActionFormFieldConfig
	| ServerActionFormFieldDefinition;

/**
 * Simple field config for action forms (when not using field registry)
 */
export interface ServerActionFormFieldConfig {
	/** Field type */
	type: string;
	/** Field label */
	label?: I18nText;
	/** Field description */
	description?: I18nText;
	/** Whether field is required */
	required?: boolean;
	/** Default value */
	default?: unknown;
	/** Field-specific options */
	options?: unknown;
}

/**
 * Field definition from field registry (has getMetadata method)
 */
export interface ServerActionFormFieldDefinition {
	/** Field definition state */
	state: {
		type?: string;
		config?: {
			label?: I18nText;
			description?: I18nText;
			required?: boolean;
			[key: string]: unknown;
		};
		/** @deprecated Use state.config.label instead */
		label?: I18nText;
		/** @deprecated Use state.config.description instead */
		description?: I18nText;
		/** @deprecated Use state.config.required instead */
		required?: boolean;
	};
	/** Get metadata for introspection */
	getMetadata(): {
		type: string;
		label?: I18nText;
		description?: I18nText;
		required?: boolean;
	};
	/** Generate Zod schema for validation */
	toZodSchema(): unknown;
}

/**
 * Server-side action form configuration
 */
export interface ServerActionForm {
	/** Form dialog title */
	title: I18nText;
	/** Form dialog description */
	description?: I18nText;
	/** Form fields */
	fields: Record<string, ServerActionFormField>;
	/** Submit button label */
	submitLabel?: I18nText;
	/** Cancel button label */
	cancelLabel?: I18nText;
	/** Dialog width */
	width?: "sm" | "md" | "lg" | "xl";
}

/**
 * Server-side action definition
 */
export interface ServerActionDefinition<TData = Record<string, unknown>> {
	/** Unique action ID */
	id: string;
	/** Display label */
	label: I18nText;
	/** Action description */
	description?: I18nText;
	/** Icon reference */
	icon?: ComponentReference;
	/** Button variant */
	variant?: "default" | "destructive" | "outline" | "secondary" | "ghost";
	/** Where the action appears */
	scope?: "single" | "bulk" | "header" | "row";
	/** Form configuration (for actions with input) */
	form?: ServerActionForm;
	/** Confirmation dialog */
	confirmation?: {
		title: I18nText;
		description?: I18nText;
		confirmLabel?: I18nText;
		cancelLabel?: I18nText;
		destructive?: boolean;
	};
	/** Action handler (runs on server) */
	handler: ServerActionHandler<TData>;
}

/**
 * Built-in action types
 */
export type BuiltinActionType =
	| "create"
	| "save"
	| "delete"
	| "deleteMany"
	| "restore"
	| "restoreMany"
	| "duplicate";

/**
 * Server-side actions configuration for a collection
 */
export interface ServerActionsConfig {
	/** Built-in actions to enable */
	builtin?: BuiltinActionType[];
	/** Custom actions */
	custom?: ServerActionDefinition[];
}

/**
 * Context for actions config function.
 *
 * Uses the same field registry as collections, so you can use `f.text()`, `f.select()` etc.
 * for action form fields.
 *
 * @example
 * ```ts
 * .actions(({ a, c, f }) => ({
 *   custom: [
 *     a.action({
 *       id: "send-email",
 *       label: { en: "Send Email" },
 *       form: {
 *         title: { en: "Send Email" },
 *         fields: {
 *           subject: f.text({ label: { en: "Subject" }, required: true }),
 *           message: f.textarea({ label: { en: "Message" } }),
 *           priority: f.select({
 *             label: { en: "Priority" },
 *             options: [
 *               { value: "low", label: { en: "Low" } },
 *               { value: "high", label: { en: "High" } },
 *             ],
 *           }),
 *         },
 *       },
 *       handler: async ({ data }) => {
 *         // data.subject, data.message, data.priority are typed
 *         return { type: "success" };
 *       },
 *     }),
 *   ],
 * }))
 * ```
 */
export interface ActionsConfigContext<
	_TFields extends Record<string, unknown> = Record<string, unknown>,
	TComponents extends Record<string, any> | string = string,
> {
	/** Action builders */
	a: {
		/** Enable create action */
		create: () => BuiltinActionType;
		/** Enable save action */
		save: () => BuiltinActionType;
		/** Enable delete action */
		delete: () => BuiltinActionType;
		/** Enable delete many action */
		deleteMany: () => BuiltinActionType;
		/** Enable restore action */
		restore: () => BuiltinActionType;
		/** Enable restore many action */
		restoreMany: () => BuiltinActionType;
		/** Enable duplicate action */
		duplicate: () => BuiltinActionType;
		/** Define a custom action */
		action: <TData = Record<string, unknown>>(
			def: Omit<ServerActionDefinition<TData>, "scope"> & {
				scope?: "single" | "row";
			},
		) => ServerActionDefinition<TData>;
		/** Define a bulk action */
		bulkAction: <TData = Record<string, unknown>>(
			def: Omit<ServerActionDefinition<TData>, "scope">,
		) => ServerActionDefinition<TData>;
		/** Define a header action */
		headerAction: <TData = Record<string, unknown>>(
			def: Omit<ServerActionDefinition<TData>, "scope">,
		) => ServerActionDefinition<TData>;
	};
	/** Component helpers (from registered component registry) */
	c: ComponentFactory<TComponents>;
	/**
	 * Field proxy from field registry.
	 * Use the same field types as in collections: f.text(), f.select(), etc.
	 */
	f: Record<
		string,
		(config?: Record<string, unknown>) => ServerActionFormField
	>;
}
