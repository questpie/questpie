/**
 * useCollectionValidation Hook
 *
 * Creates a Zod validation schema from a collection's field definitions.
 * Provides automatic validation with i18n support for react-hook-form.
 */

import type { ZodErrorMapFn } from "questpie/shared";
import { useCallback, useMemo } from "react";
import type { FieldErrors, FieldValues, Resolver } from "react-hook-form";
import type { z } from "zod";
import { createFormSchema } from "../builder/validation";
import { selectAdmin, useAdminStore } from "../runtime";
import { useCollectionFields } from "./use-collection-fields";
import { useValidationErrorMap } from "./use-validation-error-map";

/**
 * Result of useCollectionValidation hook
 */
export interface CollectionValidationResult {
  /** Zod schema for the collection's fields */
  schema: z.ZodTypeAny | undefined;
  /** Error map for i18n support */
  errorMap: ZodErrorMapFn;
}

/**
 * Get a ready-to-use resolver for react-hook-form
 *
 * This is the recommended hook - provides full automatic validation
 * with i18n error messages. Just pass the result to useForm's resolver.
 *
 * @param collection - Collection name
 * @returns Resolver function for react-hook-form, or undefined if collection not found
 *
 * @example
 * ```tsx
 * function MyForm() {
 *   const resolver = useCollectionValidation("posts");
 *
 *   const form = useForm({
 *     resolver,
 *   });
 *
 *   // That's it! Validation and i18n errors work automatically.
 * }
 * ```
 */
export function useCollectionValidation<
  TFieldValues extends FieldValues = FieldValues,
>(collection: string): Resolver<TFieldValues> | undefined {
  const admin = useAdminStore(selectAdmin);
  const { fields } = useCollectionFields(collection);
  const schema = useMemo(() => {
    if (!admin) return undefined;
    if (!fields || Object.keys(fields).length === 0) return undefined;
    return createFormSchema(fields, admin.getFields());
  }, [admin, fields]);
  const errorMap = useValidationErrorMap();

  const resolver: Resolver<TFieldValues> = useCallback(
    async (values, _context, _options) => {
      if (!schema) {
        return {
          values: values as TFieldValues,
          errors: {} as Record<string, never>,
        };
      }

      const result = schema.safeParse(values);

      if (result.success) {
        return {
          values: result.data as TFieldValues,
          errors: {} as Record<string, never>,
        };
      }

      return {
        values: {} as Record<string, never>,
        errors: zodErrorToFieldErrors(
          result.error,
          errorMap,
        ) as FieldErrors<TFieldValues>,
      };
    },
    [schema, errorMap],
  );

  return schema ? resolver : undefined;
}

/**
 * Convert Zod error to react-hook-form FieldErrors format with i18n support
 */
function zodErrorToFieldErrors(
  error: z.ZodError,
  errorMap: ZodErrorMapFn,
): FieldErrors<FieldValues> {
  const errors: FieldErrors<FieldValues> = {};

  for (const issue of error.issues) {
    const path = issue.path.join(".");
    // Apply i18n error map to get translated message
    const { message } = errorMap(issue as Parameters<ZodErrorMapFn>[0]);

    if (path && !errors[path]) {
      errors[path] = {
        type: issue.code,
        message,
      };
    }
  }

  return errors;
}
