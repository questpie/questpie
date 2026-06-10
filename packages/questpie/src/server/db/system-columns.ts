import { timestamp } from "drizzle-orm/pg-core";

/**
 * System timestamp column (`created_at`, `updated_at`, `deleted_at`, ...).
 *
 * Millisecond precision (`timestamp(3)`) so stored values round-trip a JS
 * `Date` exactly: a `Date` read from the API equals the value in the database,
 * which keeps equality and keyset-cursor comparisons (`eq`/`lt`/`gt` on
 * returned timestamps) exact. Without the precision cap, Postgres stores
 * microseconds that JS `Date` cannot represent, so round-tripped values
 * silently drift below the stored ones.
 *
 * Apps that genuinely need microsecond precision should declare their own
 * field with `f.datetime({ precision: 6 })`.
 */
export const systemTimestamp = (name: string) =>
	timestamp(name, { precision: 3, mode: "date" });
