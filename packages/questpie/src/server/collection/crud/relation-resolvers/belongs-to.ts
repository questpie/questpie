/**
 * BelongsTo Relation Resolver
 *
 * Resolves "one" relations where the current collection has a foreign key
 * pointing to the related collection.
 */

import type { RelationConfig } from "#questpie/server/collection/builder/types.js";
import type { resolveFieldKey as ResolveFieldKeyFn } from "#questpie/server/collection/crud/shared/field-resolver.js";
import type {
	CRUD,
	CRUDContext,
} from "#questpie/server/collection/crud/types.js";

/**
 * Options for resolving belongsTo relations
 */
export interface ResolveBelongsToOptions {
	/** Rows to resolve relations for */
	rows: Record<string, any>[];
	/** Name of the relation */
	relationName: string;
	/** Relation configuration */
	relation: RelationConfig;
	/** CRUD instance for the related collection */
	relatedCrud: CRUD;
	/** Nested query options for the relation */
	nestedOptions: Record<string, any>;
	/** CRUD context */
	context: CRUDContext;
	/** Function to resolve field keys */
	resolveFieldKey: typeof ResolveFieldKeyFn;
	/** State of the source collection */
	sourceState: any;
	/** Table of the source collection */
	sourceTable: any;
}

/**
 * Resolve belongsTo relations for rows
 *
 * BelongsTo relations are characterized by:
 * - relation.type === "one"
 * - relation.fields has length (foreign key on this table)
 *
 * @param options - Resolution options
 */
export async function resolveBelongsToRelation(
	options: ResolveBelongsToOptions,
): Promise<void> {
	const {
		rows,
		relationName,
		relation,
		relatedCrud,
		nestedOptions,
		context,
		resolveFieldKey,
		sourceState,
		sourceTable,
	} = options;

	if (rows.length === 0) return;

	// Determine source and target field names
	let sourceFieldName: string | undefined;
	let targetFieldName: string | undefined;

	if (typeof (relation as any).field === "string") {
		// Simple string field reference
		sourceFieldName = (relation as any).field;
		targetFieldName = Array.isArray(relation.references)
			? relation.references[0]
			: (relation.references as string | undefined);
	} else {
		// Column object reference
		const sourceField = relation.fields?.[0];
		sourceFieldName = sourceField
			? (resolveFieldKey(sourceState, sourceField, sourceTable) ??
				sourceField.name)
			: undefined;
		targetFieldName = Array.isArray(relation.references)
			? relation.references[0]
			: relation.references?.[0];
	}

	if (!sourceFieldName || !targetFieldName) return;

	// Collect unique source IDs
	const sourceIds = new Set(
		rows
			.map((row) => row[sourceFieldName as string])
			.filter((id) => id !== null && id !== undefined),
	);

	if (sourceIds.size === 0) return;

	// Fetch related records
	const { docs: relatedRows } = await relatedCrud.find(
		{
			...nestedOptions,
			where: {
				...(nestedOptions.where || {}),
				[targetFieldName]: { in: Array.from(sourceIds) },
			},
		},
		context,
	);

	// Build lookup map
	const relatedMap = new Map<any, any>();
	for (const row of relatedRows) {
		relatedMap.set((row as Record<string, any>)[targetFieldName], row);
	}

	// Assign related records to rows
	for (const row of rows) {
		const sourceId = row[sourceFieldName];
		if (sourceId !== null && sourceId !== undefined) {
			row[relationName] = relatedMap.get(sourceId) || null;
		} else {
			row[relationName] = null;
		}
	}
}
