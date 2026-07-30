/**
 * Push diff-scope guards.
 *
 * `questpie push` diffs the live database against the APP schema
 * (`app.getSchema()`). Anything in the database that is NOT part of that
 * schema — the framework's own migration ledger (`questpie_migrations`),
 * job-queue state owned by pg-boss (the `pgboss` schema), or any other
 * third-party schema — must never enter the diff, otherwise the differ
 * plans DROPs for "extra" objects and destroys framework state.
 * (Live incident: push dropped the migration ledger and pg-boss tables.)
 *
 * Two layers:
 * 1. `computePushEntities()` — restricts the drizzle-kit diff to the
 *    schemas the app schema actually uses and excludes the ledger table.
 * 2. `assertPushStatementsSafe()` — belt-and-suspenders scan of the
 *    PLANNED statements; aborts before `apply()` if anything still
 *    targets framework/foreign state (filter semantics drifting in a
 *    drizzle-kit bump must fail loud, not destructive).
 */

import { getTableConfig } from "drizzle-orm/pg-core";

/** Runner-managed ledger table — never part of the app diff. */
export const MIGRATIONS_LEDGER_TABLE = "questpie_migrations";

/** Schemas owned by infrastructure adapters, never by the app diff. */
export const FOREIGN_SCHEMAS = ["pgboss"];

/**
 * Compute the drizzle-kit entities filter for push:
 * only schemas referenced by the app schema, all tables except the ledger.
 */
export function computePushEntities(schema: Record<string, unknown>): {
	schemas: string[];
	tables: string[];
} {
	const schemas = new Set<string>(["public"]);
	for (const value of Object.values(schema)) {
		try {
			const config = getTableConfig(value as never);
			if (config?.schema) schemas.add(config.schema);
		} catch {
			// not a PgTable (enums, relations, …) — schema-irrelevant
		}
	}
	return {
		schemas: [...schemas],
		tables: ["*", `!${MIGRATIONS_LEDGER_TABLE}`],
	};
}

/**
 * Scan planned push statements and throw if any would touch framework or
 * foreign state. Returns the (unchanged) statements for chaining.
 */
export function assertPushStatementsSafe(
	statements: string[],
	appSchemas: string[],
): string[] {
	const offending: string[] = [];
	const schemaSet = new Set(appSchemas);

	for (const stmt of statements) {
		const s = stmt.toLowerCase();

		// 1. Ledger must never be written to by push
		if (
			s.includes(MIGRATIONS_LEDGER_TABLE) &&
			/\b(drop|truncate|alter)\b/.test(s)
		) {
			offending.push(stmt);
			continue;
		}

		// 2. Foreign schemas (pg-boss & friends) are owned by their adapters
		if (
			FOREIGN_SCHEMAS.some((f) => new RegExp(`"?${f}"?\\.`).test(s)) &&
			/\b(drop|truncate|alter)\b/.test(s)
		) {
			offending.push(stmt);
			continue;
		}

		// 3. DROP SCHEMA outside the app's schemas
		const dropSchema = s.match(
			/drop\s+schema\s+(?:if\s+exists\s+)?"?([\w$]+)"?/,
		);
		if (dropSchema && !schemaSet.has(dropSchema[1])) {
			offending.push(stmt);
		}
	}

	if (offending.length > 0) {
		throw new Error(
			"[questpie push] Refusing to apply — the planned diff touches framework or foreign database state:\n" +
				offending.map((o) => `   ${o}`).join("\n") +
				"\n\nThis is a questpie bug (the diff scope should exclude these objects) — please report it." +
				"\nNo statements were executed. Use migrations (questpie migrate:generate && migrate:up) in the meantime.",
		);
	}

	return statements;
}
