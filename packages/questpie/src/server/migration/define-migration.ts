import type { Migration } from "./types.js";

/**
 * Define a migration using the file-convention format.
 * Migrations placed in `migrations/*.ts` are auto-discovered by codegen.
 *
 * @example
 * ```ts
 * import { migration } from "questpie";
 * import { sql } from "drizzle-orm";
 *
 * export default migration({
 *   id: "addUsersTable20260101T120000",
 *   async up({ db }) {
 *     await db.execute(sql`CREATE TABLE "users" (...)`);
 *   },
 *   async down({ db }) {
 *     await db.execute(sql`DROP TABLE "users"`);
 *   },
 * });
 * ```
 */
export function migration(def: Migration): Migration {
	return def;
}
