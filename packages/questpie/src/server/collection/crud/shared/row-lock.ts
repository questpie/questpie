import { getTableColumns, is, SQL } from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";

/**
 * Row lock a write takes before it compares or writes a row.
 *
 * `FOR NO KEY UPDATE` is the lock Postgres itself takes for an UPDATE that
 * leaves every key column unchanged: it serializes writers of the row but does
 * not conflict with the `FOR KEY SHARE` a foreign-key insert (or
 * `lockRelationTargetsForWrite`) takes on the referenced row. Deletes, and
 * updates that may change a key column, lock `FOR UPDATE`, the lock Postgres
 * would upgrade them to anyway; pre-locking weaker would let a child insert in
 * between and then deadlock on the upgrade.
 */
export type RowLockStrength = "update" | "no key update";

const keyColumnsByTable = new WeakMap<PgTable, ReadonlySet<string>>();

/**
 * Property keys and database names of the columns Postgres treats as key
 * columns: those of the primary key and of every unique index or constraint
 * that could back a foreign key (not partial, no expressions).
 */
function keyColumns(table: PgTable): ReadonlySet<string> {
	const cached = keyColumnsByTable.get(table);
	if (cached) return cached;

	const config = getTableConfig(table);
	const keyDbNames = new Set<string>();
	for (const column of config.columns) {
		if (column.primary || column.isUnique) keyDbNames.add(column.name);
	}
	for (const constraint of [
		...config.primaryKeys,
		...config.uniqueConstraints,
	]) {
		for (const column of constraint.columns) keyDbNames.add(column.name);
	}
	for (const index of config.indexes) {
		const { unique, where, columns } = index.config;
		if (!unique || where || columns.some((column) => is(column, SQL))) {
			continue;
		}
		for (const column of columns) {
			keyDbNames.add((column as { name: string }).name);
		}
	}

	const keys = new Set<string>(keyDbNames);
	for (const [key, column] of Object.entries(getTableColumns(table))) {
		if (keyDbNames.has(column.name)) keys.add(key);
	}
	keyColumnsByTable.set(table, keys);
	return keys;
}

/**
 * Lock for an update writing `data`: `FOR UPDATE` when any written field is a
 * key column, otherwise `FOR NO KEY UPDATE`.
 */
export function rowLockForUpdate(
	table: PgTable,
	...data: Array<object | undefined>
): RowLockStrength {
	const keys = keyColumns(table);
	for (const values of data) {
		if (!values) continue;
		for (const field of Object.keys(values)) {
			if (keys.has(field)) return "update";
		}
	}
	return "no key update";
}
