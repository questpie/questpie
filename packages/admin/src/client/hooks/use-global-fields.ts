/**
 * Hook for resolving field definitions from global schema
 *
 * Builds FieldDefinition objects from server introspection schema.
 */

import type { UseQueryOptions } from "@tanstack/react-query";
import type { GlobalSchema } from "questpie";
import { useMemo } from "react";
import type { FieldDefinition } from "../builder/field/field";
import { selectAdmin, useAdminStore } from "../runtime";
import {
  type BuildFieldDefinitionsOptions,
  buildFieldDefinitionsFromSchema,
} from "../utils/build-field-definitions-from-schema";
import { useGlobalSchema } from "./use-global-schema";

export interface UseGlobalFieldsOptions {
  /**
   * React Query options for schema fetching
   */
  schemaQueryOptions?: Omit<
    UseQueryOptions<GlobalSchema>,
    "queryKey" | "queryFn"
  >;
  /**
   * Options for building field definitions from schema
   */
  buildOptions?: BuildFieldDefinitionsOptions;
}

export function useGlobalFields(
  globalName: string,
  options: UseGlobalFieldsOptions = {},
) {
  const admin = useAdminStore(selectAdmin);
  const {
    data: schema,
    isLoading,
    error,
  } = useGlobalSchema(globalName, options.schemaQueryOptions);

  const fields = useMemo(() => {
    if (!schema || !admin) return {};
    const registry = admin.getFields() as Record<string, any>;
    return buildFieldDefinitionsFromSchema(
      schema,
      registry,
      options.buildOptions,
    );
  }, [schema, admin, options.buildOptions]);

  return { fields, schema, isLoading, error };
}
