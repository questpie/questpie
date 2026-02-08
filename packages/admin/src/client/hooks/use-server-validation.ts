/**
 * useServerValidation Hook
 *
 * Creates a react-hook-form resolver using the server's JSON Schema.
 * Uses AJV for validation, ensuring client-side validation matches server-side exactly.
 *
 * This hook fetches the collection schema from the server and uses the
 * `validation.insert` or `validation.update` JSON Schema for form validation.
 */

import { ajvResolver } from "@hookform/resolvers/ajv";
import type { Options as AjvOptions, JSONSchemaType } from "ajv";
import type { Questpie } from "questpie";
import { useMemo } from "react";
import type { FieldValues, Resolver } from "react-hook-form";
import type {
	RegisteredCMS,
	RegisteredCollectionNames,
} from "../builder/registry";
import { useCollectionSchema } from "./use-collection-schema";
import { useGlobalSchema } from "./use-global-schema";

// ============================================================================
// Helpers
// ============================================================================

/**
 * Recursively strip `additionalProperties: false` and `$schema` from a JSON Schema.
 *
 * Zod's `z.toJSONSchema()` sets `additionalProperties: false` on every object,
 * which causes AJV to reject form data containing extra fields such as `id`,
 * `createdAt`, `updatedAt`, etc. that are part of the loaded document but not
 * in the validation schema.
 *
 * It also sets `$schema: "https://json-schema.org/draft/2020-12/schema"` which
 * is not supported by @hookform/resolvers/ajv out of the box.
 */
function stripAdditionalProperties(schema: unknown): unknown {
	if (!schema || typeof schema !== "object") return schema;
	const s = { ...(schema as Record<string, unknown>) };
	delete s.additionalProperties;
	// Remove $schema as AJV resolver doesn't support draft 2020-12 by default
	delete s.$schema;
	if (s.properties && typeof s.properties === "object") {
		const props: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(
			s.properties as Record<string, unknown>,
		)) {
			props[k] = stripAdditionalProperties(v);
		}
		s.properties = props;
	}
	if (s.items) {
		s.items = stripAdditionalProperties(s.items);
	}
	return s;
}

// ============================================================================
// Type Helpers
// ============================================================================

/**
 * Resolved collection names (string if not registered)
 */
type ResolvedCollectionNames =
	RegisteredCMS extends Questpie<any> ? RegisteredCollectionNames : string;

/**
 * Validation mode for the hook
 */
export type ValidationMode = "create" | "update";

/**
 * Options for useServerValidation hook
 */
export interface UseServerValidationOptions {
	/** Validation mode - determines which JSON Schema to use */
	mode?: ValidationMode;
	/** Whether to enable validation (defaults to true) */
	enabled?: boolean;
}

/**
 * Result of useServerValidation hook
 */
export interface ServerValidationResult<TFieldValues extends FieldValues> {
	/** Resolver for react-hook-form, undefined if schema not available */
	resolver: Resolver<TFieldValues> | undefined;
	/** Whether server validation schema is available */
	hasServerSchema: boolean;
	/** Whether the schema is currently loading */
	isLoading: boolean;
	/** Any error that occurred while fetching the schema */
	error: Error | null;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Default AJV options for form validation
 */
const DEFAULT_AJV_OPTIONS: AjvOptions = {
	allErrors: true,
	// Allow additional properties by default (forms may have extra fields)
	strict: false,
	// Coerce types for better form compatibility
	coerceTypes: true,
	// Use defaults from schema
	useDefaults: true,
};

// ============================================================================
// Hook
// ============================================================================

/**
 * Hook to create a react-hook-form resolver using server's JSON Schema
 *
 * Uses the collection's validation schema from the server for client-side
 * validation, ensuring validation rules are consistent between client and server.
 *
 * @param collection - Collection name
 * @param options - Validation options
 * @returns Server validation result with resolver
 *
 * @example
 * ```tsx
 * function CreatePostForm() {
 *   const { resolver, isLoading } = useServerValidation("posts", { mode: "create" });
 *
 *   const form = useForm({
 *     resolver,
 *   });
 *
 *   if (isLoading) return <Loading />;
 *
 *   return <Form {...form}>...</Form>;
 * }
 * ```
 *
 * @example
 * ```tsx
 * // With fallback to client-side validation
 * function PostForm({ isEditing }) {
 *   const { resolver: serverResolver, hasServerSchema } = useServerValidation(
 *     "posts",
 *     { mode: isEditing ? "update" : "create" }
 *   );
 *   const clientResolver = useCollectionValidation("posts");
 *
 *   // Prefer server validation, fall back to client
 *   const resolver = hasServerSchema ? serverResolver : clientResolver;
 *
 *   const form = useForm({ resolver });
 * }
 * ```
 */
export function useServerValidation<
	K extends ResolvedCollectionNames,
	TFieldValues extends FieldValues = FieldValues,
>(
	collection: K,
	options: UseServerValidationOptions = {},
): ServerValidationResult<TFieldValues> {
	const { mode = "create", enabled = true } = options;

	const {
		data: schema,
		isLoading,
		error,
	} = useCollectionSchema(collection, {
		enabled,
	});

	const result = useMemo((): ServerValidationResult<TFieldValues> => {
		// Get the appropriate JSON Schema based on mode
		const rawSchema =
			mode === "create"
				? schema?.validation?.insert
				: schema?.validation?.update;
		const jsonSchema = stripAdditionalProperties(rawSchema);

		if (!jsonSchema || typeof jsonSchema !== "object") {
			return {
				resolver: undefined,
				hasServerSchema: false,
				isLoading,
				error: error ?? null,
			};
		}

		try {
			// Create resolver using AJV
			const resolver = ajvResolver(
				jsonSchema as JSONSchemaType<TFieldValues>,
				{
					// Use our pre-configured AJV instance options
					allErrors: true,
					strict: false,
					coerceTypes: true,
					useDefaults: true,
					// AJV formats plugin options
					formats: {},
				},
				{
					mode: "async",
				},
			);

			return {
				resolver,
				hasServerSchema: true,
				isLoading: false,
				error: null,
			};
		} catch (e) {
			// If schema compilation fails, return undefined resolver
			console.warn(
				`[useServerValidation] Failed to compile JSON Schema for ${collection}:`,
				e,
			);
			return {
				resolver: undefined,
				hasServerSchema: false,
				isLoading: false,
				error: e instanceof Error ? e : new Error(String(e)),
			};
		}
	}, [schema, mode, isLoading, error, collection]);

	return result;
}

/**
 * Hook to get a combined resolver that prefers server validation
 *
 * This is a convenience hook that combines server and client validation,
 * preferring server validation when available.
 *
 * @param collection - Collection name
 * @param options - Validation options
 * @param fallbackResolver - Optional client-side resolver to use as fallback
 * @returns Resolver function for react-hook-form
 *
 * @example
 * ```tsx
 * function PostForm({ isEditing }) {
 *   const clientResolver = useCollectionValidation("posts");
 *   const resolver = usePreferServerValidation("posts", {
 *     mode: isEditing ? "update" : "create"
 *   }, clientResolver);
 *
 *   const form = useForm({ resolver });
 * }
 * ```
 */
export function usePreferServerValidation<
	K extends ResolvedCollectionNames,
	TFieldValues extends FieldValues = FieldValues,
>(
	collection: K,
	options: UseServerValidationOptions = {},
	fallbackResolver?: Resolver<TFieldValues>,
): Resolver<TFieldValues> | undefined {
	const { resolver: serverResolver, hasServerSchema } = useServerValidation<
		K,
		TFieldValues
	>(collection, options);

	return hasServerSchema ? serverResolver : fallbackResolver;
}

// ============================================================================
// Global Validation Hook
// ============================================================================

/**
 * Hook to create a react-hook-form resolver for global settings using server's JSON Schema
 *
 * @param globalName - Global name
 * @param options - Validation options (mode is always "update" for globals)
 * @returns Server validation result with resolver
 */
export function useGlobalServerValidation<
	TFieldValues extends FieldValues = FieldValues,
>(
	globalName: string,
	options: Omit<UseServerValidationOptions, "mode"> = {},
): ServerValidationResult<TFieldValues> {
	const { enabled = true } = options;

	const {
		data: schema,
		isLoading,
		error,
	} = useGlobalSchema(globalName, {
		enabled,
	});

	const result = useMemo((): ServerValidationResult<TFieldValues> => {
		// Globals only have update validation
		const jsonSchema = stripAdditionalProperties(schema?.validation?.update);

		if (!jsonSchema || typeof jsonSchema !== "object") {
			return {
				resolver: undefined,
				hasServerSchema: false,
				isLoading,
				error: error ?? null,
			};
		}

		try {
			const resolver = ajvResolver(
				jsonSchema as JSONSchemaType<TFieldValues>,
				{
					allErrors: true,
					strict: false,
					coerceTypes: true,
					useDefaults: true,
				},
				{
					mode: "async",
				},
			);

			return {
				resolver,
				hasServerSchema: true,
				isLoading: false,
				error: null,
			};
		} catch (e) {
			console.warn(
				`[useGlobalServerValidation] Failed to compile JSON Schema for ${globalName}:`,
				e,
			);
			return {
				resolver: undefined,
				hasServerSchema: false,
				isLoading: false,
				error: e instanceof Error ? e : new Error(String(e)),
			};
		}
	}, [schema, isLoading, error, globalName]);

	return result;
}
