/**
 * useValidationErrorMap Hook
 *
 * Creates a Zod error map that uses the admin i18n system
 * for localized validation error messages.
 */

import { createZodErrorMap, type ZodErrorMapFn } from "questpie/shared";
import { useMemo } from "react";
import { useSafeI18n } from "../i18n/hooks";

/**
 * Create a Zod error map with i18n support
 *
 * Uses the admin's i18n adapter for translations.
 * Falls back to English messages if no adapter is available.
 *
 * @returns Zod error map function
 *
 * @example
 * ```tsx
 * import { zodResolver } from "@hookform/resolvers/zod";
 *
 * function MyForm() {
 *   const errorMap = useValidationErrorMap();
 *   const schema = useCollectionValidation("posts");
 *
 *   const form = useForm({
 *     resolver: schema
 *       ? zodResolver(schema, { errorMap })
 *       : undefined,
 *   });
 * }
 * ```
 */
export function useValidationErrorMap(): ZodErrorMapFn {
	const i18n = useSafeI18n();

	return useMemo(() => {
		// Create translate function that uses admin i18n
		const translate = (
			key: string,
			params?: Record<string, unknown>,
		): string => {
			if (i18n) {
				return i18n.t(key, params);
			}

			// Fallback: return key with interpolated params
			if (!params) return key;

			return key.replace(/\{\{(\w+)\}\}/g, (_, paramKey) => {
				const value = params[paramKey];
				return value !== undefined ? String(value) : `{{${paramKey}}}`;
			});
		};

		return createZodErrorMap(translate);
	}, [i18n]);
}

/**
 * Create a static error map (for use outside of React components)
 *
 * @param t - Translate function
 * @returns Zod error map function
 */
function createAdminZodErrorMap(
	t: (key: string, params?: Record<string, unknown>) => string,
): ZodErrorMapFn {
	return createZodErrorMap(t);
}
