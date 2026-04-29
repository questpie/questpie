/**
 * useValidationErrorMap Hook
 *
 * Creates a Zod error map that uses the admin i18n system
 * for localized validation error messages.
 */

import {
	createValidationTranslator,
	createZodErrorMap,
	type ValidationTranslateFn,
	type ZodErrorMapFn,
} from "questpie/shared";
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
export function useValidationTranslator(): ValidationTranslateFn {
	const i18n = useSafeI18n();

	return useMemo(() => {
		const fallbackTranslate = createValidationTranslator(
			undefined,
			i18n?.locale,
		);

		return (key, params) => {
			if (i18n) {
				const translated = i18n.t(key, params);
				if (translated !== key) return translated;
			}

			return fallbackTranslate(key, params);
		};
	}, [i18n]);
}

export function useValidationErrorMap(): ZodErrorMapFn {
	const translate = useValidationTranslator();

	return useMemo(() => createZodErrorMap(translate), [translate]);
}
