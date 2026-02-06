/**
 * Hook for resolving field definitions from collection schema
 *
 * Builds FieldDefinition objects from server introspection schema
 * and merges with any local overrides.
 */

import type { UseQueryOptions } from "@tanstack/react-query";
import type { CollectionSchema } from "questpie";
import { useMemo } from "react";
import type { FieldDefinition } from "../builder/field/field";
import { selectAdmin, useAdminStore } from "../runtime";
import {
  type BuildFieldDefinitionsOptions,
  buildFieldDefinitionsFromSchema,
} from "../utils/build-field-definitions-from-schema";
import { useCollectionSchema } from "./use-collection-schema";

export interface UseCollectionFieldsOptions {
  /**
   * React Query options for schema fetching
   */
  schemaQueryOptions?: Omit<
    UseQueryOptions<CollectionSchema>,
    "queryKey" | "queryFn"
  >;
  /**
   * Options for building field definitions from schema
   */
  buildOptions?: BuildFieldDefinitionsOptions;
  /**
   * Local field definitions to merge as overrides
   */
  fallbackFields?: Record<string, FieldDefinition>;
}

export function useCollectionFields(
  collection: string,
  options: UseCollectionFieldsOptions = {},
) {
  const admin = useAdminStore(selectAdmin);
  const {
    data: schema,
    isLoading,
    error,
  } = useCollectionSchema(collection, options.schemaQueryOptions);

  const fields = useMemo(() => {
    const fallback = options.fallbackFields ?? {};
    if (!schema || !admin) {
      return fallback;
    }

    const registry = admin.getFields() as Record<string, any>;
    const schemaFields = buildFieldDefinitionsFromSchema(
      schema,
      registry,
      options.buildOptions,
    );

    return {
      ...schemaFields,
      ...fallback,
    };
  }, [schema, admin, options.buildOptions, options.fallbackFields]);

  return { fields, schema, isLoading, error };
}
