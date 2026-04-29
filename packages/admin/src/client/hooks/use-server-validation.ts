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
import type { CollectionSchema } from "questpie/client";
import type { ValidationTranslateFn } from "questpie/shared";
import { useMemo } from "react";
import type {
	FieldError,
	FieldErrors,
	FieldValues,
	Resolver,
} from "react-hook-form";

import type {
	RegisteredCMS,
	RegisteredCollectionNames,
} from "../builder/registry";
import { useCollectionSchema } from "./use-collection-schema";
import { useGlobalSchema } from "./use-global-schema";
import { useValidationTranslator } from "./use-validation-error-map";

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

function translateResolverErrors<TFieldValues extends FieldValues>(
	errors: FieldErrors<TFieldValues>,
	translate: ValidationTranslateFn,
	parentPath = "",
): FieldErrors<TFieldValues> {
	const translatedErrors: any = Array.isArray(errors)
		? [...errors]
		: { ...errors };

	for (const [key, value] of Object.entries(translatedErrors)) {
		if (!value || typeof value !== "object") continue;

		const path = parentPath ? `${parentPath}.${key}` : key;
		if (isFieldError(value)) {
			translatedErrors[key] = translateFieldError(value, translate, path);
		} else {
			translatedErrors[key] = translateResolverErrors(
				value as FieldErrors<TFieldValues>,
				translate,
				path,
			);
		}
	}

	return translatedErrors as FieldErrors<TFieldValues>;
}

function isFieldError(value: object): value is FieldError {
	return "message" in value || "type" in value;
}

function translateFieldError(
	error: FieldError,
	translate: ValidationTranslateFn,
	path: string,
): FieldError {
	const translated = translateAjvMessage(error, translate, path);
	const types =
		error.types && typeof error.types === "object"
			? Object.fromEntries(
					Object.entries(error.types).map(([key, value]) => [
						key,
						Array.isArray(value)
							? value.map((message) =>
									translateAjvMessage(
										{ ...error, type: key, message: String(message) },
										translate,
										path,
									),
								)
							: translateAjvMessage(
									{ ...error, type: key, message: String(value) },
									translate,
									path,
								),
					]),
				)
			: error.types;

	return {
		...error,
		message: translated,
		...(types && { types }),
	};
}

function translateAjvMessage(
	error: Pick<FieldError, "message" | "type">,
	translate: ValidationTranslateFn,
	field: string,
): string {
	const message = typeof error.message === "string" ? error.message : "";
	const type = typeof error.type === "string" ? error.type : "";
	const baseParams = { field };

	if (message.startsWith("validation.")) {
		return translate(message, baseParams);
	}

	switch (type) {
		case "required":
			return translate("validation.required", baseParams);
		case "type":
			return translate("validation.invalidType", {
				...baseParams,
				expected: extractExpectedType(message) ?? "unknown",
				received: extractReceivedType(message) ?? "unknown",
			});
		case "enum":
			return translate("validation.enum.invalid", baseParams);
		case "minLength":
			return translate("validation.string.min", {
				...baseParams,
				min: extractFirstNumber(message) ?? "",
			});
		case "maxLength":
			return translate("validation.string.max", {
				...baseParams,
				max: extractFirstNumber(message) ?? "",
			});
		case "pattern":
			return translate("validation.string.regex", baseParams);
		case "format":
			return translate(formatMessageToValidationKey(message), baseParams);
		case "minimum":
		case "exclusiveMinimum":
			return translate("validation.number.min", {
				...baseParams,
				min: extractFirstNumber(message) ?? "",
			});
		case "maximum":
		case "exclusiveMaximum":
			return translate("validation.number.max", {
				...baseParams,
				max: extractFirstNumber(message) ?? "",
			});
		case "minItems":
			return translate("validation.array.min", {
				...baseParams,
				min: extractFirstNumber(message) ?? "",
			});
		case "maxItems":
			return translate("validation.array.max", {
				...baseParams,
				max: extractFirstNumber(message) ?? "",
			});
		default:
			return interpolateMessage(message, baseParams);
	}
}

function extractFirstNumber(message: string): number | undefined {
	const match = message.match(/\d+/);
	return match ? Number(match[0]) : undefined;
}

function extractExpectedType(message: string): string | undefined {
	return (
		message.match(/must be (?:a |an )?([A-Za-z_][\w-]*)/)?.[1] ??
		message.match(/expected ([A-Za-z_][\w-]*)/)?.[1]
	);
}

function extractReceivedType(message: string): string | undefined {
	return message.match(/received ([A-Za-z_][\w-]*)/)?.[1];
}

function formatMessageToValidationKey(message: string): string {
	if (message.includes('"email"')) return "validation.string.email";
	if (message.includes('"uri"') || message.includes('"url"')) {
		return "validation.string.url";
	}
	if (message.includes('"date-time"')) return "validation.string.datetime";
	if (message.includes('"time"')) return "validation.time.invalid";
	return "validation.string.regex";
}

function interpolateMessage(
	message: string,
	params: Record<string, unknown>,
): string {
	return message.replace(/\{\{(\w+)\}\}/g, (_, key) => {
		const value = params[key];
		return value !== undefined ? String(value) : "";
	});
}

function withTranslatedResolver<TFieldValues extends FieldValues>(
	resolver: Resolver<TFieldValues>,
	translate: ValidationTranslateFn,
): Resolver<TFieldValues> {
	return async (values, context, options) => {
		const result = await resolver(values, context, options);
		return {
			...result,
			errors: translateResolverErrors(
				result.errors as FieldErrors<TFieldValues>,
				translate,
			),
		} as any;
	};
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
type ValidationMode = "create" | "update";

/**
 * Options for useServerValidation hook
 */
interface UseServerValidationOptions {
	/** Validation mode - determines which JSON Schema to use */
	mode?: ValidationMode;
	/** Whether to enable validation (defaults to true) */
	enabled?: boolean;
	/** Optional already-fetched schema to avoid creating another query observer */
	schema?: CollectionSchema;
}

/**
 * Result of useServerValidation hook
 */
interface ServerValidationResult<TFieldValues extends FieldValues> {
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
function useServerValidation<
	K extends ResolvedCollectionNames,
	TFieldValues extends FieldValues = FieldValues,
>(
	collection: K,
	options: UseServerValidationOptions = {},
): ServerValidationResult<TFieldValues> {
	const { mode = "create", enabled = true, schema: schemaOverride } = options;
	const translateValidation = useValidationTranslator();
	const shouldFetchSchema = enabled && !schemaOverride;

	const {
		data: queriedSchema,
		isLoading: queriedIsLoading,
		error: queriedError,
	} = useCollectionSchema(collection, {
		enabled: shouldFetchSchema,
	});

	const schema = schemaOverride ?? queriedSchema;
	const isLoading = schemaOverride ? false : queriedIsLoading;
	const error = schemaOverride
		? null
		: (queriedError as Error | null | undefined);

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
			const resolver = withTranslatedResolver(
				ajvResolver(
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
				) as Resolver<TFieldValues>,
				translateValidation,
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
	}, [schema, mode, isLoading, error, collection, translateValidation]);

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
	const translateValidation = useValidationTranslator();

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
			const resolver = withTranslatedResolver(
				ajvResolver(
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
				) as Resolver<TFieldValues>,
				translateValidation,
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
	}, [schema, isLoading, error, globalName, translateValidation]);

	return result;
}
