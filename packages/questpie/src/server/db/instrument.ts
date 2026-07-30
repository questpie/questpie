/**
 * DB query spans — attached at the Drizzle SESSION, not at the driver.
 *
 * The obvious seam is the driver (bun's `SQL`, node-postgres' `Pool`), and it
 * is complete: everything Drizzle runs goes through it. It is also unavailable
 * for half our configs — `{ drizzle }` and `{ create }` hand us a fully built
 * client and we never see the driver. Those are the Hyperdrive / Neon / Vercel
 * deployments, i.e. exactly where query latency matters most, so instrumenting
 * only the two variants we construct would ship a trace that silently omits
 * queries on the deployments people care about. A waterfall with the DB missing
 * reads as "the DB was fast".
 *
 * `PgDatabase.session` is equally complete and available in every variant.
 * Verified experimentally against drizzle-orm 1.0.0-beta.6, not inferred from
 * the types: a builder query, a raw `.execute()`, and both statements inside a
 * `.transaction()` all arrive here, and rollback still works through the
 * wrapper.
 *
 * Two things that are easy to get wrong and are the reason this file exists:
 *
 *  1. `prepareQuery` runs when the query is BUILT. The SQL runs later, in
 *     `.execute()` on the object it returns. Timing `prepareQuery` measures
 *     string assembly and reports every query as instant.
 *  2. `transaction()` hands the callback a `tx` with its OWN session. Without
 *     re-wrapping that one, every statement inside a transaction goes untraced
 *     — and transactions are where the interesting latency lives.
 */

import type { ObservabilityService } from "#questpie/server/modules/core/integrated/observability/service.js";

/** Cheap operation sniff for the span name — no parsing, just the leading verb. */
function operationOf(sql: string): string {
	const match = /^\s*(\w+)/.exec(sql);
	return match ? match[1]!.toLowerCase() : "query";
}

/**
 * Table name for `db.sql.table`, best-effort. Returns undefined rather than
 * guessing wrong — a missing attribute is better than a misleading one.
 */
function tableOf(sql: string): string | undefined {
	const match = /\b(?:from|into|update|join)\s+"?([\w.]+)"?/i.exec(sql);
	return match?.[1];
}

type AnyFn = (...args: never[]) => unknown;

/**
 * Wrap one prepared query so the span covers actual execution.
 *
 * The SQL text is attached; the PARAMS are deliberately not. Parameters are
 * user data, and a tracing backend is not a place to leak it.
 */
function instrumentPreparedQuery(
	prepared: Record<string, unknown>,
	observability: ObservabilityService,
	sqlText: string,
): Record<string, unknown> {
	const execute = prepared.execute as AnyFn | undefined;
	if (typeof execute !== "function") return prepared;

	const operation = operationOf(sqlText);
	const table = tableOf(sqlText);

	const proxy: Record<string, unknown> = new Proxy(prepared, {
		get(target, prop, receiver) {
			if (prop !== "execute") {
				const value = Reflect.get(target, prop, receiver);
				if (typeof value !== "function") return value;
				// Builder chains call fluent methods that `return this` — most
				// visibly `setToken`, which a plain `.bind(target)` hands back
				// UNWRAPPED, so the `.execute()` that follows runs on the raw
				// object and the query is never spanned. Re-wrap on identity.
				return (...args: never[]) => {
					const result = (value as AnyFn).apply(target, args);
					return result === target ? proxy : result;
				};
			}
			return (...args: never[]) =>
				observability.span(
					`db.${operation}`,
					() => execute.apply(target, args),
					{
						kind: "client",
						attributes: {
							"db.system": "postgresql",
							"db.operation": operation,
							"db.statement": sqlText,
							...(table ? { "db.sql.table": table } : {}),
						},
					},
				);
		},
	});
	return proxy;
}

function instrumentSession(
	session: Record<string, unknown>,
	observability: ObservabilityService,
): Record<string, unknown> {
	return new Proxy(session, {
		get(target, prop, receiver) {
			const value = Reflect.get(target, prop, receiver);

			// Both query paths: `prepareRelationalQuery` is what `with: {...}`
			// goes through, and missing it would leave relational reads untraced.
			if (prop === "prepareQuery" || prop === "prepareRelationalQuery") {
				return (...args: unknown[]) => {
					const prepared = (value as AnyFn).apply(
						target,
						args as never[],
					) as Record<string, unknown>;
					const query = args[0] as { sql?: string } | undefined;
					if (!query?.sql) return prepared;
					return instrumentPreparedQuery(prepared, observability, query.sql);
				};
			}

			if (prop === "transaction") {
				return (callback: (tx: unknown) => unknown, config?: unknown) =>
					observability.span(
						"db.transaction",
						() =>
							(value as AnyFn).apply(target, [
								(tx: Record<string, unknown>) => {
									// See the note at the top: the tx carries its own
									// session, and it is not writable in place on every
									// driver — fall back to leaving it untraced rather
									// than breaking the transaction.
									try {
										Object.defineProperty(tx, "session", {
											value: instrumentSession(
												tx.session as Record<string, unknown>,
												observability,
											),
											configurable: true,
										});
									} catch {
										/* untraced, but still correct */
									}
									return callback(tx);
								},
								config,
							] as never[]),
						{ kind: "client", attributes: { "db.system": "postgresql" } },
					);
			}

			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}

/**
 * Attach query spans to a Drizzle client. Returns the client unchanged when
 * observability is disabled, so the no-adapter path costs nothing.
 *
 * Exported publicly: a consumer who builds their own Drizzle client and wants
 * it traced can call this, though the `db` service does it for every config
 * variant already.
 */
export function instrumentDbClient<T>(
	db: T,
	// Genuinely optional: the db service is created early enough that the
	// observability service may not be on the app yet, and a mock app in a unit
	// test never has one. Typing it as always-present made this throw at
	// startup rather than quietly skip instrumentation.
	observability: ObservabilityService | undefined,
): T {
	if (!observability?.enabled) return db;
	const client = db as Record<string, unknown>;
	const session = client.session;
	if (!session || typeof session !== "object") return db;

	try {
		Object.defineProperty(client, "session", {
			value: instrumentSession(
				session as Record<string, unknown>,
				observability,
			),
			configurable: true,
		});
	} catch {
		// A frozen client is not worth failing startup over.
		return db;
	}
	return db;
}
