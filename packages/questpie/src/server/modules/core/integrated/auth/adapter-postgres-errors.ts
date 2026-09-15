import type { BetterAuthOptions } from "better-auth";

type AdapterFactory<TAdapter extends object> = (
	options: BetterAuthOptions,
) => TAdapter;

const QUERY_METHODS = [
	"create",
	"findOne",
	"findMany",
	"count",
	"update",
	"updateMany",
	"delete",
	"deleteMany",
] as const;

/** SQLSTATEs Better Auth recognises by their Postgres message. */
const RECOGNISED_SQLSTATES = new Set([
	"42P01", // undefined_table: a table not migrated yet
	"23505", // unique_violation: another process inserted the same row first
]);

/**
 * Drizzle wraps a failed query in `DrizzleQueryError`, whose message is the SQL
 * rather than Postgres' reason. Better Auth reads that reason to tell benign
 * failures apart: `@better-auth/oauth-provider` 1.7 seeds `oauthResource` rows
 * at init and defers on a missing table, and treats a unique violation as a row
 * another replica already seeded. Through Drizzle neither matched, so an auth
 * instance built before migrations ran, or losing a boot race, rejected its init
 * and took the process down. Rethrowing Postgres' own error for exactly those
 * SQLSTATEs restores both paths; every other failure keeps Drizzle's error.
 *
 * The adapter is patched in place rather than proxied: Better Auth keys the
 * adapter's schema check by object identity, and a proxy would silently drop it.
 *
 * @internal
 */
export function surfaceRecognisedPostgresErrors<TAdapter extends object>(
	factory: AdapterFactory<TAdapter>,
): AdapterFactory<TAdapter> {
	return (options) => {
		const adapter = factory(options) as Record<string, unknown>;
		for (const method of QUERY_METHODS) {
			const query = adapter[method];
			if (typeof query !== "function") continue;
			adapter[method] = async (...args: unknown[]) => {
				try {
					return await query.apply(adapter, args);
				} catch (error) {
					throw recognisedPostgresError(error) ?? error;
				}
			};
		}
		return adapter as TAdapter;
	};
}

/**
 * The Postgres error inside a driver/ORM wrapper, when its SQLSTATE is one Better
 * Auth recognises. Bun SQL carries the SQLSTATE in `errno` (its `code` is
 * `ERR_POSTGRES_SERVER_ERROR`); node-postgres and PGlite carry it in `code`.
 */
function recognisedPostgresError(error: unknown): unknown {
	let current: unknown = error;
	for (
		let depth = 0;
		current && typeof current === "object" && depth < 5;
		depth++
	) {
		const candidate = current as {
			errno?: unknown;
			code?: unknown;
			cause?: unknown;
		};
		const sqlstate =
			typeof candidate.errno === "string" ? candidate.errno : candidate.code;
		if (typeof sqlstate === "string" && RECOGNISED_SQLSTATES.has(sqlstate)) {
			return current;
		}
		current = candidate.cause;
	}
	return undefined;
}
