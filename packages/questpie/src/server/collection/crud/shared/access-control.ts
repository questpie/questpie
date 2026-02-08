/**
 * Access Control Utilities
 *
 * Pure functions for handling access control in CRUD operations.
 * Supports boolean and function-based access rules.
 */

import type {
  AccessContext,
  AccessWhere,
  CollectionAccess,
} from "#questpie/server/collection/builder/types.js";
import type { CRUDContext } from "#questpie/server/collection/crud/types.js";
import type { Questpie } from "#questpie/server/config/cms.js";
import type {
  FieldAccessContext,
  FieldDefinitionAccess,
} from "#questpie/server/fields/types.js";
import { getDb, normalizeContext } from "./context.js";

/**
 * Context for access rule evaluation
 */
export interface AccessRuleEvaluationContext {
  cms?: Questpie<any>;
  db: any;
  session?: CRUDContext["session"];
  locale?: string;
  row?: any;
  input?: any;
}

/**
 * Execute an access rule and return boolean or AccessWhere
 *
 * @param rule - The access rule to execute
 * @param context - Evaluation context
 * @returns true (allow), false (deny), or AccessWhere (conditional access)
 */
export async function executeAccessRule(
  rule:
    | boolean
    | ((
        ctx: AccessContext,
      ) => boolean | AccessWhere | Promise<boolean | AccessWhere>)
    | undefined,
  context: AccessRuleEvaluationContext,
): Promise<boolean | AccessWhere> {
  // No rule = allow
  if (rule === undefined) return true;

  // Boolean rule
  if (typeof rule === "boolean") {
    return rule;
  }

  // Function rule
  if (typeof rule === "function") {
    const result = await rule({
      app: context.cms as any,
      session: context.session,
      data: context.row,
      input: context.input,
      db: context.db,
      locale: context.locale,
    });

    return result;
  }

  return true;
}

/**
 * Check if a row matches access conditions recursively
 *
 * @param conditions - AccessWhere conditions to check
 * @param row - Row data to check against
 * @returns true if row matches conditions
 */
export async function matchesAccessConditions(
  conditions: AccessWhere,
  row: Record<string, any>,
): Promise<boolean> {
  for (const [key, value] of Object.entries(conditions)) {
    if (key === "AND") {
      // All conditions must match
      for (const cond of value as AccessWhere[]) {
        if (!(await matchesAccessConditions(cond, row))) {
          return false;
        }
      }
    } else if (key === "OR") {
      // At least one condition must match
      let anyMatch = false;
      for (const cond of value as AccessWhere[]) {
        if (await matchesAccessConditions(cond, row)) {
          anyMatch = true;
          break;
        }
      }
      if (!anyMatch) return false;
    } else if (key === "NOT") {
      // Condition must NOT match
      if (await matchesAccessConditions(value as AccessWhere, row)) {
        return false;
      }
    } else {
      // Simple field equality check
      if (row[key] !== value) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Options for filtering fields based on read access
 */
export interface FilterFieldsForReadOptions {
  cms?: Questpie<any>;
  db: any;
  fieldAccess?: Record<string, FieldDefinitionAccess>;
}

function createFieldAccessContext(params: {
  context: CRUDContext;
  operation: "create" | "read" | "update" | "delete";
  doc?: Record<string, unknown>;
}): FieldAccessContext {
  const request =
    (params.context as any).req ??
    (params.context as any).request ??
    (typeof Request !== "undefined"
      ? new Request("http://questpie.local")
      : ({} as Request));

  return {
    req: request,
    user: (params.context.session as any)?.user,
    doc: params.doc,
    operation: params.operation,
  };
}

async function evaluateFieldAccess(
  rule:
    | FieldDefinitionAccess["read"]
    | FieldDefinitionAccess["create"]
    | FieldDefinitionAccess["update"],
  context: FieldAccessContext,
): Promise<boolean> {
  if (rule === undefined || rule === true) return true;
  if (rule === false) return false;
  if (typeof rule === "function") {
    return (await rule(context)) === true;
  }
  return true;
}

/**
 * Get list of fields that should be restricted from read
 *
 * @param result - Row data to check
 * @param context - CRUD context
 * @param options - Configuration options
 * @returns Array of field names to remove
 */
export async function getRestrictedReadFields(
  result: Record<string, any>,
  context: CRUDContext,
  options: FilterFieldsForReadOptions,
): Promise<string[]> {
  if (!result) return [];

  const normalized = normalizeContext(context);

  // System mode bypasses field access control
  if (normalized.accessMode === "system") return [];

  const fieldAccess = options.fieldAccess;
  if (!fieldAccess) return [];

  const fieldsToRemove: string[] = [];

  for (const fieldName of Object.keys(result)) {
    // Skip meta fields
    if (
      fieldName === "id" ||
      fieldName === "_title" ||
      fieldName === "createdAt" ||
      fieldName === "updatedAt" ||
      fieldName === "deletedAt"
    ) {
      continue;
    }

    const access = fieldAccess[fieldName];
    if (!access || access.read === undefined) {
      // No access rule for this field - allow read
      continue;
    }

    const canRead = await evaluateFieldAccess(
      access.read,
      createFieldAccessContext({
        context: normalized,
        operation: "read",
        doc: result,
      }),
    );

    if (!canRead) {
      fieldsToRemove.push(fieldName);
    }
  }

  return fieldsToRemove;
}

/**
 * Check if user can write to a specific field
 *
 * @param fieldName - Name of the field
 * @param fieldAccess - Field access rules
 * @param context - CRUD context
 * @param options - Configuration options
 * @param existingRow - Optional existing row data (for update operations)
 * @returns true if user can write to field
 */
export async function checkFieldWriteAccess(
  fieldName: string,
  fieldAccess: Record<string, FieldDefinitionAccess> | undefined,
  context: CRUDContext,
  options: { cms?: Questpie<any>; db: any },
  operation: "create" | "update",
  existingRow?: any,
): Promise<boolean> {
  const normalized = normalizeContext(context);

  // System mode can write all fields
  if (normalized.accessMode === "system") return true;

  if (!fieldAccess) return true;

  const access = fieldAccess[fieldName];
  if (!access) {
    // No access rule for this field - allow write
    return true;
  }

  const rule = operation === "create" ? access.create : access.update;
  return evaluateFieldAccess(
    rule,
    createFieldAccessContext({
      context: normalized,
      operation,
      doc: existingRow,
    }),
  );
}

/**
 * Validate write access for all fields in input data
 * Throws ApiError if any field cannot be written
 *
 * @param data - Input data to validate
 * @param fieldAccess - Field access rules
 * @param context - CRUD context
 * @param options - Configuration options
 * @param existingRow - Optional existing row data (for update operations)
 * @param collectionName - Collection name for error message
 */
export async function validateFieldsWriteAccess(
  data: Record<string, any>,
  fieldAccess: Record<string, FieldDefinitionAccess> | undefined,
  context: CRUDContext,
  options: { cms?: Questpie<any>; db: any },
  collectionName: string,
  operation: "create" | "update",
  existingRow?: any,
): Promise<void> {
  // Lazy import to avoid circular dependency
  const { ApiError } = await import("#questpie/server/errors/index.js");

  const normalized = normalizeContext(context);

  // System mode bypasses field access control
  if (normalized.accessMode === "system") return;

  if (!fieldAccess) return;

  for (const fieldName of Object.keys(data)) {
    // Skip meta fields
    if (
      fieldName === "id" ||
      fieldName === "createdAt" ||
      fieldName === "updatedAt" ||
      fieldName === "deletedAt"
    ) {
      continue;
    }

    const canWrite = await checkFieldWriteAccess(
      fieldName,
      fieldAccess,
      context,
      options,
      operation,
      existingRow,
    );

    if (!canWrite) {
      throw ApiError.forbidden({
        operation: "update",
        resource: collectionName,
        reason: `Cannot write field '${fieldName}': access denied`,
        fieldPath: fieldName,
      });
    }
  }
}

/**
 * Merge user WHERE with access control WHERE conditions
 *
 * @param userWhere - User-provided WHERE clause
 * @param accessWhere - Access control conditions
 * @returns Merged WHERE clause
 */
export function mergeWhereWithAccess<TWhere = any>(
  userWhere?: TWhere,
  accessWhere?: boolean | AccessWhere,
): TWhere | undefined {
  // Access explicitly denied - caller should handle this and throw forbidden
  // This function should not be called with accessWhere === false
  // The CRUD layer checks for false before calling this function
  if (accessWhere === false) {
    throw new Error(
      "mergeWhereWithAccess called with accessWhere === false. " +
        "This should be handled at the CRUD level by throwing a forbidden error.",
    );
  }

  // Access explicitly allowed or no access rule - use user WHERE only
  if (accessWhere === true || !accessWhere) {
    return userWhere;
  }

  // Merge access conditions with user conditions
  if (!userWhere) {
    return accessWhere as TWhere;
  }

  // Combine with AND
  return {
    AND: [userWhere, accessWhere],
  } as TWhere;
}
