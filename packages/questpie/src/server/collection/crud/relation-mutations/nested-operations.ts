/**
 * Nested Relation Operations
 *
 * Handles nested relation mutations (create, connect, connectOrCreate, set)
 * during create and update operations.
 */

import type { RelationConfig } from "#questpie/server/collection/builder/types.js";
import type { resolveFieldKey as ResolveFieldKeyFn } from "#questpie/server/collection/crud/shared/field-resolver.js";
import type {
  CRUD,
  CRUDContext,
} from "#questpie/server/collection/crud/types.js";
import type { Questpie } from "#questpie/server/config/cms.js";
import { ApiError } from "#questpie/server/errors/index.js";

/**
 * Options for processing nested relations
 */
export interface ProcessNestedRelationsOptions {
  /** The parent record (with id) */
  parentRecord: Record<string, any>;
  /** Nested relation operations to process */
  nestedRelations: Record<string, any>;
  /** Collection state with relations config */
  relations: Record<string, RelationConfig>;
  /** CMS instance for accessing related CRUDs */
  cms: Questpie<any>;
  /** CRUD context */
  context: CRUDContext;
  /** Transaction client */
  tx: any;
  /** Function to resolve field keys */
  resolveFieldKey: typeof ResolveFieldKeyFn;
}

/**
 * Separate nested relation operations from regular fields
 *
 * @param input - Input data that may contain nested relations
 * @param relationNames - Set of relation names to detect
 * @returns Separated regular fields and nested relations
 */
export function separateNestedRelations(
  input: Record<string, any>,
  relationNames: Set<string>,
): {
  regularFields: Record<string, any>;
  nestedRelations: Record<string, any>;
} {
  const regularFields: Record<string, any> = {};
  const nestedRelations: Record<string, any> = {};

  for (const [key, value] of Object.entries(input)) {
    if (relationNames.has(key) && typeof value === "object" && value !== null) {
      nestedRelations[key] = value;
    } else {
      regularFields[key] = value;
    }
  }

  return { regularFields, nestedRelations };
}

/**
 * Transform simple relation field values to FK column names.
 *
 * When a user passes `{ author: "user-uuid" }` (simple string value),
 * this transforms it to `{ authorId: "user-uuid" }` for belongsTo relations.
 *
 * This allows users to use the relation field name (author) instead of
 * the FK column name (authorId) when providing simple ID values.
 *
 * @param regularFields - Regular field values (may contain relation field names with string values)
 * @param relations - Relation configurations
 * @param resolveFieldKey - Function to resolve field keys
 * @param state - Collection state
 * @param table - Collection table
 * @returns Transformed fields with relation names converted to FK column names
 */
export function transformSimpleRelationValues(
  regularFields: Record<string, any>,
  relations: Record<string, RelationConfig>,
  resolveFieldKey: typeof ResolveFieldKeyFn,
  state: any,
  table: any,
): Record<string, any> {
  const transformedFields = { ...regularFields };

  for (const [relationName, relation] of Object.entries(relations)) {
    // Only handle belongsTo relations (type: "one" with fields)
    if (relation.type !== "one" || !relation.fields?.length) {
      continue;
    }

    // Check if the relation field name exists in regularFields with a simple value
    const value = regularFields[relationName];
    if (value === undefined) {
      continue;
    }

    // Only transform simple values (string IDs), not objects
    if (typeof value === "object" && value !== null) {
      continue;
    }

    // Get the FK column name
    const fieldKeys = relation.fields
      .map((field) => resolveFieldKey(state, field, table) ?? field?.name)
      .filter(Boolean) as string[];

    if (fieldKeys.length !== 1) {
      continue;
    }

    const foreignKeyField = fieldKeys[0];

    // Transform: author → authorId
    // Remove the relation field name and add the FK column name
    delete transformedFields[relationName];
    transformedFields[foreignKeyField] = value;
  }

  return transformedFields;
}

/**
 * Pre-process connect operations before validation.
 * This extracts FK values from belongsTo relation connect operations,
 * allowing validation to pass even when the FK field is required but
 * the user provides the value via nested relation syntax.
 *
 * This only handles "connect" operations - "create" and "connectOrCreate"
 * require database operations and are handled later.
 *
 * @param regularFields - Regular field values
 * @param nestedRelations - Nested relation operations
 * @param relations - Relation configurations
 * @param resolveFieldKey - Function to resolve field keys
 * @param state - Collection state
 * @param table - Collection table
 * @returns Updated fields and relations
 */
export function extractBelongsToConnectValues(
  regularFields: Record<string, any>,
  nestedRelations: Record<string, any>,
  relations: Record<string, RelationConfig>,
  resolveFieldKey: typeof ResolveFieldKeyFn,
  state: any,
  table: any,
): {
  regularFields: Record<string, any>;
  nestedRelations: Record<string, any>;
} {
  const updatedFields = { ...regularFields };
  const remainingRelations = { ...nestedRelations };

  for (const [relationName, operations] of Object.entries(nestedRelations)) {
    const relation = relations[relationName];
    if (!relation || relation.type !== "one" || !relation.fields?.length) {
      continue;
    }

    // Only process connect operations here
    if (!operations?.connect) {
      continue;
    }

    const fieldKeys = relation.fields
      .map((field) => resolveFieldKey(state, field, table) ?? field?.name)
      .filter(Boolean) as string[];

    if (fieldKeys.length !== 1) {
      continue; // Will be handled/rejected in applyBelongsToRelations
    }

    const foreignKeyField = fieldKeys[0];

    // Extract FK value from connect operation
    if (Array.isArray(operations.connect)) {
      if (operations.connect.length === 1) {
        updatedFields[foreignKeyField] = operations.connect[0].id;
      }
      // Multiple connect targets will be rejected later
    } else {
      updatedFields[foreignKeyField] = operations.connect.id;
    }

    // Remove connect from operations, keep create/connectOrCreate for later processing
    const { connect, ...restOperations } = operations;
    if (Object.keys(restOperations).length === 0) {
      delete remainingRelations[relationName];
    } else {
      remainingRelations[relationName] = restOperations;
    }
  }

  return {
    regularFields: updatedFields,
    nestedRelations: remainingRelations,
  };
}

/**
 * Apply belongsTo relation operations (create, connect, connectOrCreate)
 * These operations set FK values on the parent record BEFORE insert/update.
 *
 * @param regularFields - Regular field values
 * @param nestedRelations - Nested relation operations
 * @param relations - Relation configurations
 * @param cms - CMS instance
 * @param context - CRUD context
 * @param tx - Transaction client
 * @param resolveFieldKey - Function to resolve field keys
 * @param state - Collection state
 * @param table - Collection table
 * @returns Updated fields and relations
 */
export async function applyBelongsToRelations(
  regularFields: Record<string, any>,
  nestedRelations: Record<string, any>,
  relations: Record<string, RelationConfig>,
  cms: Questpie<any>,
  context: CRUDContext,
  tx: any,
  resolveFieldKey: typeof ResolveFieldKeyFn,
  state: any,
  table: any,
): Promise<{
  regularFields: Record<string, any>;
  nestedRelations: Record<string, any>;
}> {
  const updatedFields = { ...regularFields };
  const remainingRelations = { ...nestedRelations };

  for (const [relationName, operations] of Object.entries(nestedRelations)) {
    const relation = relations[relationName];
    if (!relation || relation.type !== "one" || !relation.fields?.length) {
      continue;
    }

    const actionKeys = ["connect", "create", "connectOrCreate"].filter(
      (key) => operations?.[key] !== undefined,
    );

    if (actionKeys.length === 0) {
      delete remainingRelations[relationName];
      continue;
    }

    if (actionKeys.length > 1) {
      throw ApiError.badRequest(
        `Nested relation "${relationName}" supports only one operation at a time.`,
      );
    }

    const fieldKeys = relation.fields
      .map((field) => resolveFieldKey(state, field, table) ?? field?.name)
      .filter(Boolean) as string[];

    if (fieldKeys.length !== 1) {
      throw ApiError.badRequest(
        `Nested relation "${relationName}" requires exactly one foreign key field.`,
      );
    }

    const foreignKeyField = fieldKeys[0];
    const referenceKey = relation.references?.[0] || "id";
    const relatedCrud = cms.api.collections[relation.collection];

    if (operations.connect) {
      if (Array.isArray(operations.connect)) {
        if (operations.connect.length !== 1) {
          throw ApiError.badRequest(
            `Nested relation "${relationName}" supports a single connect target.`,
          );
        }
        updatedFields[foreignKeyField] = operations.connect[0].id;
      } else {
        updatedFields[foreignKeyField] = operations.connect.id;
      }
    } else if (operations.create) {
      if (Array.isArray(operations.create)) {
        throw ApiError.badRequest(
          `Nested relation "${relationName}" supports a single create payload.`,
        );
      }
      const created = await relatedCrud.create(operations.create, {
        ...context,
        db: tx,
      });
      updatedFields[foreignKeyField] =
        (created as Record<string, unknown> | undefined)?.[referenceKey] ??
        created?.id;
    } else if (operations.connectOrCreate) {
      if (Array.isArray(operations.connectOrCreate)) {
        throw ApiError.badRequest(
          `Nested relation "${relationName}" supports a single connectOrCreate payload.`,
        );
      }

      const existing = await relatedCrud.findOne(
        { where: operations.connectOrCreate.where },
        { ...context, db: tx },
      );

      const target = existing
        ? existing
        : await relatedCrud.create(operations.connectOrCreate.create, {
            ...context,
            db: tx,
          });

      updatedFields[foreignKeyField] =
        (target as Record<string, unknown> | undefined)?.[referenceKey] ??
        target?.id;
    }

    delete remainingRelations[relationName];
  }

  return {
    regularFields: updatedFields,
    nestedRelations: remainingRelations,
  };
}

/**
 * Process HasMany nested relation operations
 */
export async function processHasManyNestedOperations(
  parentRecord: Record<string, any>,
  operations: Record<string, any>,
  relation: RelationConfig,
  relatedCrud: CRUD,
  reverseRelation: RelationConfig,
  context: CRUDContext,
  tx: any,
  resolveFieldKey: typeof ResolveFieldKeyFn,
): Promise<void> {
  const foreignKeyField =
    resolveFieldKey(
      relatedCrud["~internalState"],
      reverseRelation.fields![0],
      relatedCrud["~internalRelatedTable"],
    ) ?? reverseRelation.fields![0].name;
  const primaryKeyField = reverseRelation.references?.[0] || "id";

  // Create operations
  if (operations.create) {
    const createInputs = Array.isArray(operations.create)
      ? operations.create
      : [operations.create];

    for (const createInput of createInputs) {
      await relatedCrud.create(
        {
          ...createInput,
          [foreignKeyField]: parentRecord[primaryKeyField],
        },
        { ...context, db: tx },
      );
    }
  }

  // Connect operations
  if (operations.connect) {
    const connectInputs = Array.isArray(operations.connect)
      ? operations.connect
      : [operations.connect];

    for (const connectInput of connectInputs) {
      await relatedCrud.updateById(
        {
          id: connectInput.id,
          data: { [foreignKeyField]: parentRecord[primaryKeyField] },
        },
        { ...context, db: tx },
      );
    }
  }

  // ConnectOrCreate operations
  if (operations.connectOrCreate) {
    const connectOrCreateInputs = Array.isArray(operations.connectOrCreate)
      ? operations.connectOrCreate
      : [operations.connectOrCreate];

    for (const connectOrCreateInput of connectOrCreateInputs) {
      const existing = await relatedCrud.findOne(
        { where: connectOrCreateInput.where },
        { ...context, db: tx },
      );

      if (existing) {
        await relatedCrud.updateById(
          {
            id: existing.id,
            data: { [foreignKeyField]: parentRecord[primaryKeyField] },
          },
          { ...context, db: tx },
        );
      } else {
        await relatedCrud.create(
          {
            ...connectOrCreateInput.create,
            [foreignKeyField]: parentRecord[primaryKeyField],
          },
          { ...context, db: tx },
        );
      }
    }
  }
}

/**
 * Process ManyToMany nested relation operations
 */
export async function processManyToManyNestedOperations(
  parentRecord: Record<string, any>,
  operations: Record<string, any> | any[],
  relation: RelationConfig,
  junctionCrud: CRUD,
  relatedCrud: CRUD,
  context: CRUDContext,
  tx: any,
): Promise<void> {
  const sourceField = relation.sourceField!;
  const targetField = relation.targetField!;
  const sourceKey = relation.sourceKey || "id";

  // Handle array of IDs directly (treat as 'set' operation)
  // This supports admin forms that send: services: ["id1", "id2"]
  if (Array.isArray(operations)) {
    await handleManyToManySet(
      parentRecord,
      operations
        .map((item: any) => (typeof item === "string" ? item : item?.id))
        .filter(Boolean),
      sourceField,
      targetField,
      sourceKey,
      junctionCrud,
      context,
      tx,
    );
    return;
  }

  // Handle 'set' operation explicitly
  if (operations.set) {
    const setInputs = Array.isArray(operations.set)
      ? operations.set
      : [operations.set];
    const newIds = setInputs
      .map((item: any) => (typeof item === "string" ? item : item?.id))
      .filter(Boolean) as string[];

    await handleManyToManySet(
      parentRecord,
      newIds,
      sourceField,
      targetField,
      sourceKey,
      junctionCrud,
      context,
      tx,
    );
  }

  // Create operations
  if (operations.create) {
    const createInputs = Array.isArray(operations.create)
      ? operations.create
      : [operations.create];

    for (const createInput of createInputs) {
      const relatedRecord = await relatedCrud.create(createInput, {
        ...context,
        db: tx,
      });

      await junctionCrud.create(
        {
          [sourceField]: parentRecord[sourceKey],
          [targetField]: relatedRecord.id,
        },
        { ...context, db: tx },
      );
    }
  }

  // Connect operations
  if (operations.connect) {
    const connectInputs = Array.isArray(operations.connect)
      ? operations.connect
      : [operations.connect];

    for (const connectInput of connectInputs) {
      await junctionCrud.create(
        {
          [sourceField]: parentRecord[sourceKey],
          [targetField]: connectInput.id,
        },
        { ...context, db: tx },
      );
    }
  }

  // ConnectOrCreate operations
  if (operations.connectOrCreate) {
    const connectOrCreateInputs = Array.isArray(operations.connectOrCreate)
      ? operations.connectOrCreate
      : [operations.connectOrCreate];

    for (const connectOrCreateInput of connectOrCreateInputs) {
      const existing = await relatedCrud.findOne(
        { where: connectOrCreateInput.where },
        { ...context, db: tx },
      );

      const targetId = existing
        ? existing.id
        : (
            await relatedCrud.create(connectOrCreateInput.create, {
              ...context,
              db: tx,
            })
          ).id;

      await junctionCrud.create(
        {
          [sourceField]: parentRecord[sourceKey],
          [targetField]: targetId,
        },
        { ...context, db: tx },
      );
    }
  }
}

/**
 * Handle ManyToMany 'set' operation
 * Computes diff and adds/removes junction records
 */
async function handleManyToManySet(
  parentRecord: Record<string, any>,
  newIds: string[],
  sourceField: string,
  targetField: string,
  sourceKey: string,
  junctionCrud: CRUD,
  context: CRUDContext,
  tx: any,
): Promise<void> {
  // Get current relations
  const currentJunctions = await junctionCrud.find(
    { where: { [sourceField]: parentRecord[sourceKey] } },
    { ...context, db: tx },
  );
  const currentIds = currentJunctions.docs.map(
    (j: any) => j[targetField],
  ) as string[];

  // Compute what to add and remove
  const toConnect = newIds.filter((id) => !currentIds.includes(id));
  const toDisconnect = currentIds.filter((id) => !newIds.includes(id));

  // Connect new relations
  for (const targetId of toConnect) {
    await junctionCrud.create(
      {
        [sourceField]: parentRecord[sourceKey],
        [targetField]: targetId,
      },
      { ...context, db: tx },
    );
  }

  // Disconnect removed relations
  for (const targetId of toDisconnect) {
    await junctionCrud.delete(
      {
        where: {
          AND: [
            { [sourceField]: parentRecord[sourceKey] },
            { [targetField]: targetId },
          ],
        },
      },
      { ...context, db: tx },
    );
  }
}

/**
 * Process all nested relation operations after parent record is created/updated
 *
 * @param options - Processing options
 */
export async function processNestedRelations(
  options: ProcessNestedRelationsOptions,
): Promise<void> {
  const {
    parentRecord,
    nestedRelations,
    relations,
    cms,
    context,
    tx,
    resolveFieldKey,
  } = options;

  for (const [relationName, operations] of Object.entries(nestedRelations)) {
    const relation = relations[relationName];
    if (!relation) continue;

    // Skip BelongsTo (handled before insert/update)
    if (
      relation.type === "one" &&
      relation.fields &&
      relation.fields.length > 0
    ) {
      continue;
    }

    // Handle HasMany relations
    if (relation.type === "many" && !relation.fields) {
      const reverseRelationName = relation.relationName;
      if (!reverseRelationName) continue;

      const relatedCrud = cms.api.collections[relation.collection];
      const reverseRelation =
        relatedCrud["~internalState"].relations?.[reverseRelationName];
      if (!reverseRelation?.fields || reverseRelation.fields.length === 0)
        continue;

      await processHasManyNestedOperations(
        parentRecord,
        operations,
        relation,
        relatedCrud,
        reverseRelation,
        context,
        tx,
        resolveFieldKey,
      );
    }

    // Handle ManyToMany relations
    else if (relation.type === "manyToMany" && relation.through) {
      const sourceField = relation.sourceField;
      const targetField = relation.targetField;

      if (!sourceField || !targetField) continue;

      const junctionCrud = cms.api.collections[relation.through];
      const relatedCrud = cms.api.collections[relation.collection];

      await processManyToManyNestedOperations(
        parentRecord,
        operations,
        relation,
        junctionCrud,
        relatedCrud,
        context,
        tx,
      );
    }
  }
}
