/**
 * ManyToMany Relation Resolver
 *
 * Resolves "manyToMany" relations through a junction table.
 */

import type { RelationConfig } from "#questpie/server/collection/builder/types.js";
import { INHERIT_ACCESS } from "#questpie/server/collection/crud/shared/context.js";
import type {
	CRUD,
	CRUDContext,
} from "#questpie/server/collection/crud/types.js";

/**
 * Options for resolving manyToMany relations
 */
export interface ResolveManyToManyOptions {
	/** Rows to resolve relations for */
	rows: Record<string, any>[];
	/** Name of the relation */
	relationName: string;
	/** Relation configuration */
	relation: RelationConfig;
	/** CRUD instance for the junction collection */
	junctionCrud: CRUD;
	/** CRUD instance for the related collection */
	relatedCrud: CRUD;
	/** Nested query options for the relation */
	nestedOptions: Record<string, any>;
	/** CRUD context */
	context: CRUDContext;
}

/**
 * Resolve manyToMany relations for rows
 *
 * ManyToMany relations are characterized by:
 * - relation.type === "manyToMany"
 * - relation.through specifies the junction collection
 *
 * @param options - Resolution options
 */
export async function resolveManyToManyRelation(
	options: ResolveManyToManyOptions,
): Promise<void> {
	const {
		rows,
		relationName,
		relation,
		junctionCrud,
		relatedCrud,
		nestedOptions,
		context,
	} = options;

	if (rows.length === 0) return;

	const sourceKey = relation.sourceKey || "id";
	const targetKey = relation.targetKey || "id";
	const sourceField = relation.sourceField;
	const targetField = relation.targetField;

	if (!sourceField || !targetField) return;

	// Collect source IDs
	const sourceIds = new Set(
		rows
			.map((row) => row[sourceKey])
			.filter((id) => id !== null && id !== undefined),
	);

	if (sourceIds.size === 0) return;

	// Fetch junction records. Inherit-access relations (f.upload through a
	// junction) read the join rows through the parent's read decision too —
	// the junction rows are pure composition, not user-facing data.
	const junctionOptions: Record<string, any> = {
		where: { [sourceField]: { in: Array.from(sourceIds) } },
	};
	if (
		(nestedOptions as Record<PropertyKey, unknown>)[INHERIT_ACCESS] === true
	) {
		(junctionOptions as Record<PropertyKey, unknown>)[INHERIT_ACCESS] = true;
	}
	const { docs: junctionRows } = await junctionCrud.find(
		junctionOptions,
		context,
	);

	if (!junctionRows.length) {
		// No relations found, set empty arrays
		for (const row of rows) {
			row[relationName] = [];
		}
		return;
	}

	// Collect target IDs from junction
	const targetIds = [
		...new Set(
			junctionRows
				.map((row: any) => row[targetField])
				.filter((id: any) => id !== null && id !== undefined),
		),
	];

	if (!targetIds.length) {
		// No target records, set empty arrays
		for (const row of rows) {
			row[relationName] = [];
		}
		return;
	}

	// Build where clause for related records
	const relatedWhere: any = {
		[targetKey]: { in: targetIds },
	};

	if (nestedOptions.where) {
		relatedWhere.AND = [nestedOptions.where];
	}

	// Fetch related records
	const { docs: relatedRows } = await relatedCrud.find(
		{
			...nestedOptions,
			where: relatedWhere,
		},
		context,
	);

	// Build junction map (source ID -> target IDs)
	const junctionMap = new Map<any, any[]>();
	for (const j of junctionRows) {
		const junctionRow = j as Record<string, any>;
		const sid = junctionRow[sourceField];
		if (!junctionMap.has(sid)) {
			junctionMap.set(sid, []);
		}
		junctionMap.get(sid)?.push(junctionRow[targetField]);
	}

	// Build related map (target ID -> related record)
	const relatedMap = new Map<any, any>();
	for (const row of relatedRows) {
		relatedMap.set((row as Record<string, any>)[targetKey], row);
	}

	// Assign related records to rows
	for (const row of rows) {
		const sourceId = row[sourceKey];
		const relatedIds = junctionMap.get(sourceId) || [];
		row[relationName] = relatedIds
			.map((tid) => relatedMap.get(tid))
			.filter((rel) => rel !== undefined);
	}
}
