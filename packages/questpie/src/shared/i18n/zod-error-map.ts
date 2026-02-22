/**
 * Shared Zod Error Map
 *
 * Maps Zod validation errors to i18n keys.
 * Works with both Zod v3 and v4.
 * Used by both frontend and backend.
 */

import type { ValidationTranslateFn } from "./validation-messages.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Zod error map function type (compatible with both v3 and v4)
 */
export type ZodErrorMapFn = (issue: ZodIssue) => { message: string };

/**
 * Simplified Zod issue type for compatibility
 */
export interface ZodIssue {
	code: string;
	message: string;
	path?: (string | number)[];
	// Common issue properties
	expected?: string;
	received?: string;
	minimum?: number;
	maximum?: number;
	inclusive?: boolean;
	exact?: boolean;
	type?: string;
	// String-specific
	validation?: string;
	// v4 format
	format?: string;
	// Custom params
	params?: Record<string, unknown>;
}

// ============================================================================
// Error Map Factory
// ============================================================================

/**
 * Translate function that also accepts locale as third parameter (backend translator)
 */
export type BackendTranslateFn = (
	key: string,
	params?: Record<string, unknown>,
	locale?: string,
) => string;

/**
 * Create a Zod error map with i18n support
 *
 * Maps Zod error codes to validation message keys.
 * The translate function handles the actual translation.
 *
 * @param t - Translate function for validation messages
 * @param locale - Optional locale for backend translators that accept locale as 3rd param
 *
 * @example
 * ```ts
 * // Create error map with translator
 * const t = createValidationTranslator(customMessages, "sk");
 * const errorMap = createZodErrorMap(t);
 *
 * // Or with backend translator and locale binding
 * const translator = createTranslator(config);
 * const errorMap = createZodErrorMap(translator, "sk");
 *
 * // Use with Zod schema
 * const schema = z.string().min(5);
 * const result = schema.safeParse("ab", { errorMap });
 *
 * // Or set globally (not recommended for multi-tenant)
 * z.setErrorMap(errorMap);
 * ```
 */
export function createZodErrorMap(
	t: ValidationTranslateFn | BackendTranslateFn,
	locale?: string,
): ZodErrorMapFn {
	// Bind locale to the translate function if provided
	const translate: ValidationTranslateFn = locale
		? (key, params) => (t as BackendTranslateFn)(key, params, locale)
		: (t as ValidationTranslateFn);
	return (issue: ZodIssue) => {
		// Check for custom i18n key in params first
		if (issue.params?.i18nKey) {
			return {
				message: translate(
					issue.params.i18nKey as string,
					issue.params as Record<string, unknown>,
				),
			};
		}

		switch (issue.code) {
			// ================================================================
			// Type errors
			// ================================================================
			case "invalid_type":
				if (issue.received === "undefined" || issue.received === "null") {
					return { message: translate("validation.required") };
				}
				return {
					message: translate("validation.invalidType", {
						expected: issue.expected,
						received: issue.received,
					}),
				};

			// ================================================================
			// Size/length errors (too_small, too_big)
			// ================================================================
			case "too_small":
				return handleTooSmall(issue, translate);

			case "too_big":
				return handleTooBig(issue, translate);

			// ================================================================
			// String format errors
			// ================================================================
			case "invalid_string":
				return handleInvalidString(issue, translate);

			// Zod v4 uses invalid_format for string validations
			case "invalid_format":
				return handleInvalidFormat(issue, translate);

			// ================================================================
			// Date errors
			// ================================================================
			case "invalid_date":
				return { message: translate("validation.date.invalid") };

			// ================================================================
			// Enum/Union errors
			// ================================================================
			case "invalid_enum_value":
				return {
					message: translate("validation.enum.invalid", {
						options: issue.params?.options
							? (issue.params.options as string[]).join(", ")
							: "",
					}),
				};

			case "invalid_union":
			case "invalid_union_discriminator":
				return { message: translate("validation.union.invalid") };

			// ================================================================
			// Object errors
			// ================================================================
			case "unrecognized_keys":
				return {
					message: translate("validation.object.unrecognizedKeys", {
						keys: issue.params?.keys
							? (issue.params.keys as string[]).join(", ")
							: "",
					}),
				};

			// ================================================================
			// Custom errors
			// ================================================================
			case "custom":
				// If custom error has a message, use it
				if (issue.message && issue.message !== "Invalid input") {
					return { message: issue.message };
				}
				// If params has message key, translate it
				if (issue.params?.message) {
					return {
						message: translate("validation.custom", {
							message: issue.params.message,
						}),
					};
				}
				return { message: issue.message };

			// ================================================================
			// Default - return original message
			// ================================================================
			default:
				return { message: issue.message };
		}
	};
}

// ============================================================================
// Helper Functions
// ============================================================================

function handleTooSmall(issue: ZodIssue, t: ValidationTranslateFn) {
	const min = issue.minimum;
	const inclusive = issue.inclusive !== false;

	switch (issue.type) {
		case "string":
			if (issue.exact) {
				return { message: t("validation.string.length", { length: min }) };
			}
			return { message: t("validation.string.min", { min }) };

		case "number":
		case "bigint":
			if (issue.exact) {
				return { message: t("validation.number.min", { min }) };
			}
			if (min === 0 && inclusive) {
				return { message: t("validation.number.nonnegative") };
			}
			if (min === 0 && !inclusive) {
				return { message: t("validation.number.positive") };
			}
			return { message: t("validation.number.min", { min }) };

		case "array":
			if (issue.exact) {
				return { message: t("validation.array.length", { length: min }) };
			}
			if (min === 1) {
				return { message: t("validation.array.nonempty") };
			}
			return { message: t("validation.array.min", { min }) };

		case "date":
			return { message: t("validation.date.min", { min: String(min) }) };

		default:
			return { message: issue.message };
	}
}

function handleTooBig(issue: ZodIssue, t: ValidationTranslateFn) {
	const max = issue.maximum;
	const inclusive = issue.inclusive !== false;

	switch (issue.type) {
		case "string":
			if (issue.exact) {
				return { message: t("validation.string.length", { length: max }) };
			}
			return { message: t("validation.string.max", { max }) };

		case "number":
		case "bigint":
			if (issue.exact) {
				return { message: t("validation.number.max", { max }) };
			}
			if (max === 0 && inclusive) {
				return { message: t("validation.number.nonpositive") };
			}
			if (max === 0 && !inclusive) {
				return { message: t("validation.number.negative") };
			}
			return { message: t("validation.number.max", { max }) };

		case "array":
			if (issue.exact) {
				return { message: t("validation.array.length", { length: max }) };
			}
			return { message: t("validation.array.max", { max }) };

		case "date":
			return { message: t("validation.date.max", { max: String(max) }) };

		default:
			return { message: issue.message };
	}
}

function handleInvalidString(issue: ZodIssue, t: ValidationTranslateFn) {
	switch (issue.validation) {
		case "email":
			return { message: t("validation.string.email") };
		case "url":
			return { message: t("validation.string.url") };
		case "uuid":
			return { message: t("validation.string.uuid") };
		case "regex":
			return { message: t("validation.string.regex") };
		case "datetime":
			return { message: t("validation.string.datetime") };
		case "ip":
			return { message: t("validation.string.ip") };
		case "base64":
			return { message: t("validation.string.base64") };
		default:
			return { message: issue.message };
	}
}

// Zod v4 handler
function handleInvalidFormat(issue: ZodIssue, t: ValidationTranslateFn) {
	switch (issue.format) {
		case "email":
			return { message: t("validation.string.email") };
		case "url":
			return { message: t("validation.string.url") };
		case "uuid":
			return { message: t("validation.string.uuid") };
		case "regex":
			return { message: t("validation.string.regex") };
		case "datetime":
			return { message: t("validation.string.datetime") };
		case "ip":
			return { message: t("validation.string.ip") };
		case "base64":
			return { message: t("validation.string.base64") };
		default:
			return { message: issue.message };
	}
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Create i18n params for custom Zod refinements
 *
 * Use this when adding custom validation with .refine() or .superRefine()
 * to enable i18n translation of the error message.
 *
 * @example
 * ```ts
 * const schema = z.string().refine(
 *   (val) => val.startsWith("Q-"),
 *   i18nParams("validation.string.startsWith", { prefix: "Q-" })
 * );
 * ```
 */
export function i18nParams(
	i18nKey: string,
	params?: Record<string, unknown>,
): { params: Record<string, unknown> } {
	return {
		params: {
			i18nKey,
			...params,
		},
	};
}
