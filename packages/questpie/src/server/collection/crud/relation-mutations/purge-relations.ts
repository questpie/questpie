import { and, eq, ne, sql, type SQL } from "drizzle-orm";
import {
	getTableConfig,
	type AnyPgColumn,
	type PgTable,
} from "drizzle-orm/pg-core";

import type {
	CollectionBuilderState,
	RelationConfig,
} from "#questpie/server/collection/builder/types.js";
import {
	getColumn,
	resolveFieldKey,
} from "#questpie/server/collection/crud/shared/field-resolver.js";
import type { CRUD } from "#questpie/server/collection/crud/types.js";
import type { Questpie } from "#questpie/server/config/questpie.js";
import { rowsOf } from "#questpie/server/db/driver-result.js";
import { ApiError } from "#questpie/server/errors/base.js";

const RETAINED_REFERENCE_MESSAGE =
	"Cannot purge record while retained references exist";

type PhysicalForeignKey = {
	childSchema: string;
	childTable: string;
	childColumns: string[];
	parentColumns: string[];
};

type ApplicationReference = {
	table: PgTable;
	sourceColumn: AnyPgColumn;
	targetKey: string;
	predicate?: {
		column: AnyPgColumn;
		value: string;
	};
};

type RelationSourceCrud = {
	"~internalRelatedTable"?: PgTable;
	"~internalState"?: {
		name: string;
		relations?: Record<string, RelationConfig>;
	};
};

export type PreparedPurgeRelations = {
	assertNoReferences(record: Record<string, unknown>): Promise<void>;
};

function relationConflict(): ApiError {
	return ApiError.conflict(RETAINED_REFERENCE_MESSAGE);
}

function tableIdentity(table: PgTable): { schema: string; name: string } {
	const config = getTableConfig(table);
	return {
		schema: config.schema ?? "public",
		name: config.name,
	};
}

function qualifiedIdentifier(schema: string, name: string): SQL {
	return sql`${sql.identifier(schema)}.${sql.identifier(name)}`;
}

function columnKey(table: PgTable, databaseName: string): string | undefined {
	for (const [key, value] of Object.entries(table)) {
		if ((value as { name?: string })?.name === databaseName) return key;
	}
	return undefined;
}

function physicalKey(
	schema: string,
	table: string,
	columns: readonly string[],
): string {
	return `${schema}.${table}(${columns.join(",")})`;
}

async function loadPhysicalForeignKeys(
	tx: any,
	parentTable: PgTable,
): Promise<PhysicalForeignKey[]> {
	const parent = tableIdentity(parentTable);
	const result = await tx.execute(sql`
		SELECT
			child_ns.nspname AS "childSchema",
			child.relname AS "childTable",
			ARRAY(
				SELECT child_attr.attname
				FROM unnest(constraint_row.conkey) WITH ORDINALITY AS child_key(attnum, position)
				JOIN pg_attribute child_attr
					ON child_attr.attrelid = constraint_row.conrelid
					AND child_attr.attnum = child_key.attnum
				ORDER BY child_key.position
			) AS "childColumns",
			ARRAY(
				SELECT parent_attr.attname
				FROM unnest(constraint_row.confkey) WITH ORDINALITY AS parent_key(attnum, position)
				JOIN pg_attribute parent_attr
					ON parent_attr.attrelid = constraint_row.confrelid
					AND parent_attr.attnum = parent_key.attnum
				ORDER BY parent_key.position
			) AS "parentColumns"
		FROM pg_constraint constraint_row
		JOIN pg_class parent ON parent.oid = constraint_row.confrelid
		JOIN pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
		JOIN pg_class child ON child.oid = constraint_row.conrelid
		JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
		WHERE constraint_row.contype = 'f'
			AND parent_ns.nspname = ${parent.schema}
			AND parent.relname = ${parent.name}
		ORDER BY child_ns.nspname, child.relname, constraint_row.oid
	`);

	return rowsOf<PhysicalForeignKey>(result).map((row) => ({
		childSchema: row.childSchema,
		childTable: row.childTable,
		childColumns: Array.from(row.childColumns ?? []),
		parentColumns: Array.from(row.parentColumns ?? []),
	}));
}

function pushScalarReference(
	references: ApplicationReference[],
	sourceCrud: RelationSourceCrud,
	relation: RelationConfig,
): boolean {
	const sourceState = sourceCrud["~internalState"] as CollectionBuilderState;
	const sourceTable = sourceCrud["~internalRelatedTable"] as PgTable;
	const configuredField = relation.fields?.[0] ?? relation.field;
	if (!configuredField || (relation.fields?.length ?? 1) !== 1) return false;

	const sourceKey =
		resolveFieldKey(sourceState, configuredField, sourceTable) ??
		(typeof configuredField === "string"
			? configuredField
			: configuredField.name);
	const sourceColumn = sourceKey
		? getColumn(sourceTable, sourceKey)
		: undefined;
	if (!sourceColumn) return false;

	references.push({
		table: sourceTable,
		sourceColumn,
		targetKey: relation.references?.[0] ?? "id",
	});
	return true;
}

function collectApplicationReferences(
	app: Questpie<any>,
	targetCollection: string,
): {
	references: ApplicationReference[];
	unsupportedTables: PgTable[];
	unsupported: boolean;
} {
	const references: ApplicationReference[] = [];
	const unsupportedTables: PgTable[] = [];
	let unsupported = false;

	const sources = [
		...Object.entries(app.collections),
		...Object.entries(app.globals),
	] as Array<[string, RelationSourceCrud]>;
	for (const [sourceCollection, sourceCrud] of sources) {
		const sourceState = sourceCrud["~internalState"] as CollectionBuilderState;
		if (!sourceState || !sourceCrud["~internalRelatedTable"]) {
			unsupported = true;
			continue;
		}
		const relations = sourceState.relations ?? {};

		for (const relation of Object.values(relations) as RelationConfig[]) {
			if (relation.polymorphicTargets) {
				for (const target of relation.polymorphicTargets) {
					if (
						target.collection !== undefined &&
						target.collection !== targetCollection
					) {
						continue;
					}
					const sourceTable = sourceCrud["~internalRelatedTable"] as PgTable;
					const sourceColumn = getColumn(sourceTable, target.idField);
					const typeColumn = getColumn(sourceTable, target.typeField);
					if (!sourceColumn || !typeColumn) {
						unsupported = true;
						unsupportedTables.push(sourceTable);
						continue;
					}
					references.push({
						table: sourceTable,
						sourceColumn,
						targetKey: relation.references?.[0] ?? "id",
						predicate: {
							column: typeColumn,
							value: target.discriminator,
						},
					});
				}
				continue;
			}

			if (relation.collection === targetCollection && relation.type === "one") {
				if (!pushScalarReference(references, sourceCrud, relation)) {
					unsupported = true;
					unsupportedTables.push(
						sourceCrud["~internalRelatedTable"] as PgTable,
					);
				}
				continue;
			}

			if (
				sourceCollection === targetCollection &&
				relation.type === "many" &&
				!relation.fields
			) {
				const relatedCrud = app.collections[relation.collection] as
					| CRUD
					| undefined;
				const relatedState = relatedCrud?.["~internalState"] as
					| CollectionBuilderState
					| undefined;
				const reverse = relation.relationName
					? relatedState?.relations?.[relation.relationName]
					: undefined;
				if (
					!relatedCrud ||
					!(
						(relation.field &&
							pushScalarReference(references, relatedCrud, relation)) ||
						(reverse && pushScalarReference(references, relatedCrud, reverse))
					)
				) {
					unsupported = true;
					if (relatedCrud) {
						unsupportedTables.push(
							relatedCrud["~internalRelatedTable"] as PgTable,
						);
					}
				}
				continue;
			}

			if (relation.type !== "manyToMany") continue;
			if (
				sourceCollection !== targetCollection &&
				relation.collection !== targetCollection
			) {
				continue;
			}

			const junctionCrud = relation.through
				? (app.collections[relation.through] as CRUD | undefined)
				: undefined;
			if (!junctionCrud) {
				unsupported = true;
				continue;
			}

			const junctionTable = junctionCrud["~internalRelatedTable"] as PgTable;
			const junctionReferences: Array<{
				field: string | undefined;
				targetKey: string;
			}> = [];
			if (sourceCollection === targetCollection) {
				junctionReferences.push({
					field: relation.sourceField,
					targetKey: relation.sourceKey ?? "id",
				});
			}
			if (relation.collection === targetCollection) {
				junctionReferences.push({
					field: relation.targetField,
					targetKey: relation.targetKey ?? "id",
				});
			}
			for (const junctionReference of junctionReferences) {
				const sourceColumn = junctionReference.field
					? getColumn(junctionTable, junctionReference.field)
					: undefined;
				if (!sourceColumn) {
					unsupported = true;
					unsupportedTables.push(junctionTable);
					continue;
				}
				references.push({
					table: junctionTable,
					sourceColumn,
					targetKey: junctionReference.targetKey,
				});
			}
		}
	}

	const unique = new Map<string, ApplicationReference>();
	for (const reference of references) {
		const identity = tableIdentity(reference.table);
		unique.set(
			[
				identity.schema,
				identity.name,
				reference.sourceColumn.name,
				reference.targetKey,
				reference.predicate?.column.name,
				reference.predicate?.value,
			].join(":"),
			reference,
		);
	}
	return {
		references: [...unique.values()],
		unsupportedTables,
		unsupported,
	};
}

async function physicalReferenceExists(
	tx: any,
	foreignKey: PhysicalForeignKey,
	parentTable: PgTable,
	record: Record<string, unknown>,
): Promise<boolean> {
	if (
		foreignKey.childColumns.length === 0 ||
		foreignKey.childColumns.length !== foreignKey.parentColumns.length
	) {
		throw relationConflict();
	}

	const predicates = foreignKey.childColumns.map((childColumn, index) => {
		const parentColumn = foreignKey.parentColumns[index];
		const parentKey = columnKey(parentTable, parentColumn);
		if (!parentKey) throw relationConflict();
		const parentValue = record[parentKey];
		if (parentValue === undefined) throw relationConflict();
		return sql`${sql.identifier(childColumn)} = ${parentValue}`;
	});
	const result = await tx.execute(sql`
		SELECT 1
		FROM ${qualifiedIdentifier(foreignKey.childSchema, foreignKey.childTable)}
		WHERE ${and(...predicates)}
		LIMIT 1
	`);
	return rowsOf(result).length > 0;
}

/**
 * Inventory and lock all application-only incoming reference tables before
 * the owner row is locked. Table-first deterministic ordering avoids
 * self-relation deadlocks and closes phantom inserts where no physical FK
 * exists. Physical FKs are protected by PostgreSQL's parent-row locking and
 * are still scanned so `ON DELETE CASCADE` never becomes implicit purge.
 */
export async function preparePurgeRelations(options: {
	tx: any;
	app: Questpie<any>;
	targetTable: PgTable;
	i18nTable: PgTable | null;
}): Promise<PreparedPurgeRelations> {
	const { tx, app, targetTable, i18nTable } = options;
	const targetCollection = Object.entries(app.collections).find(
		([, crud]) => crud["~internalRelatedTable"] === targetTable,
	)?.[0];
	if (!targetCollection) throw relationConflict();
	const targetIdentity = tableIdentity(targetTable);
	const [lockTimeoutRow] = rowsOf(
		await tx.execute(
			sql`SELECT current_setting('lock_timeout') AS "lockTimeout"`,
		),
	) as Array<{ lockTimeout?: string }>;
	const previousLockTimeout = lockTimeoutRow?.lockTimeout ?? "0";
	await tx.execute(sql`SELECT set_config('lock_timeout', '3s', true)`);
	await tx.execute(
		sql`LOCK TABLE ${qualifiedIdentifier(targetIdentity.schema, targetIdentity.name)} IN SHARE UPDATE EXCLUSIVE MODE`,
	);
	const physicalForeignKeys = await loadPhysicalForeignKeys(tx, targetTable);
	const applicationInventory = collectApplicationReferences(
		app,
		targetCollection,
	);
	const applicationReferences = applicationInventory.references;
	const physicalColumns = new Set(
		physicalForeignKeys.map((foreignKey) =>
			physicalKey(
				foreignKey.childSchema,
				foreignKey.childTable,
				foreignKey.childColumns,
			),
		),
	);

	const applicationOnlyTables = new Map<
		string,
		{ schema: string; name: string }
	>();
	for (const reference of applicationReferences) {
		const identity = tableIdentity(reference.table);
		if (
			physicalColumns.has(
				physicalKey(identity.schema, identity.name, [
					reference.sourceColumn.name,
				]),
			)
		) {
			continue;
		}
		applicationOnlyTables.set(`${identity.schema}.${identity.name}`, identity);
	}
	for (const table of applicationInventory.unsupportedTables) {
		const identity = tableIdentity(table);
		applicationOnlyTables.set(`${identity.schema}.${identity.name}`, identity);
	}

	for (const entry of [...applicationOnlyTables.values()].sort((a, b) =>
		`${a.schema}.${a.name}`.localeCompare(`${b.schema}.${b.name}`),
	)) {
		await tx.execute(
			sql`LOCK TABLE ${qualifiedIdentifier(entry.schema, entry.name)} IN SHARE ROW EXCLUSIVE MODE`,
		);
	}
	await tx.execute(
		sql`SELECT set_config('lock_timeout', ${previousLockTimeout}, true)`,
	);

	const i18nIdentity = i18nTable ? tableIdentity(i18nTable) : null;
	return {
		async assertNoReferences(record) {
			if (applicationInventory.unsupported) throw relationConflict();

			for (const reference of applicationReferences) {
				const targetValue = record[reference.targetKey];
				if (targetValue === undefined) throw relationConflict();
				const referenceIdentity = tableIdentity(reference.table);
				const isSelfReferenceTable =
					referenceIdentity.schema === targetIdentity.schema &&
					referenceIdentity.name === targetIdentity.name;
				const sourceId = isSelfReferenceTable
					? getColumn(reference.table, "id")
					: undefined;
				const predicates = [eq(reference.sourceColumn, targetValue)];
				if (reference.predicate) {
					predicates.push(
						eq(reference.predicate.column, reference.predicate.value),
					);
				}
				if (sourceId && record.id !== undefined) {
					predicates.push(ne(sourceId, record.id));
				}
				const rows = await tx
					.select({ value: sql<number>`1` })
					.from(reference.table)
					.where(and(...predicates))
					.limit(1);
				if (rows.length > 0) throw relationConflict();
			}

			for (const foreignKey of physicalForeignKeys) {
				if (
					i18nIdentity &&
					foreignKey.childSchema === i18nIdentity.schema &&
					foreignKey.childTable === i18nIdentity.name
				) {
					continue;
				}
				if (
					await physicalReferenceExists(tx, foreignKey, targetTable, record)
				) {
					throw relationConflict();
				}
			}
		},
	};
}

export function isForeignKeyViolation(error: unknown): boolean {
	let current = error;
	const seen = new Set<object>();
	while (current && typeof current === "object" && !seen.has(current)) {
		seen.add(current);
		const candidate = current as {
			code?: unknown;
			errno?: unknown;
			cause?: unknown;
		};
		if (candidate.code === "23503" || candidate.errno === "23503") return true;
		current = candidate.cause;
	}
	return false;
}

export function isPurgeLockTimeout(error: unknown): boolean {
	let current = error;
	const seen = new Set<object>();
	while (current && typeof current === "object" && !seen.has(current)) {
		seen.add(current);
		const candidate = current as {
			code?: unknown;
			errno?: unknown;
			cause?: unknown;
		};
		if (candidate.code === "55P03" || candidate.errno === "55P03") return true;
		current = candidate.cause;
	}
	return false;
}

export function retainedReferenceConflict(): ApiError {
	return relationConflict();
}

type RelationTargetLock = {
	collection: string;
	key: string;
	value: unknown;
};

function isManyToManyJunctionTable(
	app: Questpie<any>,
	sourceTable: PgTable,
): boolean {
	for (const sourceCrud of Object.values(
		app.collections,
	) as RelationSourceCrud[]) {
		const relations = sourceCrud["~internalState"]?.relations ?? {};
		for (const relation of Object.values(relations)) {
			if (relation.type !== "manyToMany" || !relation.through) continue;
			const junctionCrud = app.collections[relation.through] as
				| RelationSourceCrud
				| undefined;
			if (junctionCrud?.["~internalRelatedTable"] === sourceTable) return true;
		}
	}
	return false;
}

/** Acquire the source table lock before any nested relation work starts. */
export async function lockRelationSourceForWrite(options: {
	tx: any;
	app?: Questpie<any>;
	sourceState: CollectionBuilderState;
	sourceTable: PgTable;
}): Promise<void> {
	const hasOwnedReference =
		Object.values(options.sourceState.relations ?? {}).some(
			(relation) =>
				relation.polymorphicTargets ||
				(relation.type === "one" && (relation.fields?.length ?? 0) === 1),
		) ||
		(options.app
			? isManyToManyJunctionTable(options.app, options.sourceTable)
			: false);
	if (!hasOwnedReference) return;
	const sourceIdentity = tableIdentity(options.sourceTable);
	await options.tx.execute(
		sql`LOCK TABLE ${qualifiedIdentifier(sourceIdentity.schema, sourceIdentity.name)} IN ROW EXCLUSIVE MODE`,
	);
}

/**
 * Serialize application-only relation writes with purge.
 *
 * The caller has already taken the source table's normal write lock before
 * nested work. It now key-shares every referenced target row before DML.
 * Purge takes the stronger source-table lock before locking the owner.
 */
export async function lockRelationTargetsForWrite(options: {
	tx: any;
	app: Questpie<any>;
	sourceState: CollectionBuilderState;
	sourceTable: PgTable;
	values: Record<string, unknown>;
	originalRows?: Record<string, unknown>[];
}): Promise<void> {
	const { tx, app, sourceState, sourceTable, values, originalRows } = options;
	const targets: RelationTargetLock[] = [];

	for (const relation of Object.values(
		sourceState.relations ?? {},
	) as RelationConfig[]) {
		if (relation.polymorphicTargets) {
			const configured = relation.polymorphicTargets[0];
			if (!configured) continue;
			if (
				!Object.hasOwn(values, configured.typeField) &&
				!Object.hasOwn(values, configured.idField)
			) {
				continue;
			}
			const candidateValues =
				originalRows && originalRows.length > 0
					? originalRows.map((row) => ({ ...row, ...values }))
					: [values];
			for (const candidateValuesForRow of candidateValues) {
				const typeValue = candidateValuesForRow[configured.typeField];
				const idValue = candidateValuesForRow[configured.idField];
				if (typeValue == null && idValue == null) continue;
				if (typeof typeValue !== "string" || idValue == null) {
					throw ApiError.badRequest(
						"Polymorphic relation writes require both type and id",
					);
				}
				const target = relation.polymorphicTargets.find(
					(candidate) => candidate.discriminator === typeValue,
				);
				if (!target?.collection) {
					throw ApiError.badRequest(
						`Unknown polymorphic relation type "${typeValue}"`,
					);
				}
				targets.push({
					collection: target.collection,
					key: relation.references?.[0] ?? "id",
					value: idValue,
				});
			}
			continue;
		}

		if (relation.type !== "one" || (relation.fields?.length ?? 0) !== 1) {
			continue;
		}
		const configuredField = relation.fields![0]!;
		const sourceKey =
			resolveFieldKey(sourceState, configuredField, sourceTable) ??
			configuredField.name;
		if (!sourceKey || !Object.hasOwn(values, sourceKey)) continue;
		const value = values[sourceKey];
		if (value == null) continue;
		targets.push({
			collection: relation.collection,
			key: relation.references?.[0] ?? "id",
			value,
		});
	}

	for (const [sourceCollection, sourceCrud] of Object.entries(
		app.collections,
	) as Array<[string, RelationSourceCrud]>) {
		for (const relation of Object.values(
			sourceCrud["~internalState"]?.relations ?? {},
		)) {
			if (relation.type !== "manyToMany" || !relation.through) continue;
			const junctionCrud = app.collections[relation.through] as
				| RelationSourceCrud
				| undefined;
			if (junctionCrud?.["~internalRelatedTable"] !== sourceTable) continue;

			if (relation.sourceField && Object.hasOwn(values, relation.sourceField)) {
				const value = values[relation.sourceField];
				if (value != null) {
					targets.push({
						collection: sourceCollection,
						key: relation.sourceKey ?? "id",
						value,
					});
				}
			}
			if (relation.targetField && Object.hasOwn(values, relation.targetField)) {
				const value = values[relation.targetField];
				if (value != null) {
					targets.push({
						collection: relation.collection,
						key: relation.targetKey ?? "id",
						value,
					});
				}
			}
		}
	}

	if (targets.length === 0) return;

	const resolvedTargets: Array<
		RelationTargetLock & {
			targetTable: PgTable;
			targetColumn: AnyPgColumn;
			identity: { schema: string; name: string };
		}
	> = [];
	for (const target of targets) {
		const targetCrud =
			(app.collections[target.collection] as RelationSourceCrud | undefined) ??
			(app.globals[target.collection] as RelationSourceCrud | undefined);
		const targetTable = targetCrud?.["~internalRelatedTable"] as
			| PgTable
			| undefined;
		const targetColumn = targetTable
			? getColumn(targetTable, target.key)
			: undefined;
		if (!targetTable || !targetColumn) {
			continue;
		}
		const identity = tableIdentity(targetTable);
		resolvedTargets.push({
			...target,
			targetTable,
			targetColumn,
			identity,
		});
	}
	const uniqueTargets = new Map<string, (typeof resolvedTargets)[number]>();
	for (const target of resolvedTargets) {
		uniqueTargets.set(
			[
				target.identity.schema,
				target.identity.name,
				target.targetColumn.name,
				String(target.value),
			].join(":"),
			target,
		);
	}

	for (const target of [...uniqueTargets.values()].sort((left, right) =>
		[
			left.identity.schema,
			left.identity.name,
			left.targetColumn.name,
			String(left.value),
		]
			.join(":")
			.localeCompare(
				[
					right.identity.schema,
					right.identity.name,
					right.targetColumn.name,
					String(right.value),
				].join(":"),
			),
	)) {
		const rows = await tx
			.select({ value: target.targetColumn })
			.from(target.targetTable)
			.where(eq(target.targetColumn, target.value))
			.limit(1)
			.for("key share");
		if (rows.length === 0) {
			throw ApiError.badRequest(
				`Relation target "${target.collection}.${target.key}" does not exist`,
			);
		}
	}
}
