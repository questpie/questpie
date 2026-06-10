/**
 * Driver-result contract
 *
 * Drizzle's `db.execute()` returns driver-native results: node-postgres and
 * PGlite return `{ rows }`, postgres-js returns a `RowList` (array subclass),
 * bun-sql returns a `SQLResultArray` (array subclass). Any code holding a
 * drizzle instance of unknown driver cannot assume a shape.
 *
 * This module owns that ambiguity at one seam: normalize once, trust everywhere.
 */

/**
 * Normalize a drizzle `db.execute()` result to a rows array.
 *
 * - node-postgres / PGlite → `{ rows: [...] }`
 * - postgres-js / bun-sql → array (subclass)
 * - anything else → `[]`
 */
export function rowsOf<T = Record<string, unknown>>(result: unknown): T[] {
	if (Array.isArray(result)) return result as T[];
	if (
		result &&
		typeof result === "object" &&
		Array.isArray((result as { rows?: unknown }).rows)
	) {
		return (result as { rows: T[] }).rows;
	}
	return [];
}

/**
 * Minimal drizzle-instance facade for drizzle-kit APIs that assume
 * node-postgres shape (`execute().rows`). Wraps any questpie db so
 * `.execute()` always returns `{ rows }`, regardless of the underlying driver.
 */
export function toKitDb<TQuery>(db: { execute: (q: TQuery) => unknown }) {
	return {
		execute: async (q: TQuery) => ({ rows: rowsOf(await db.execute(q)) }),
	};
}
