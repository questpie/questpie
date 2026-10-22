import { is } from "drizzle-orm";
import { PgTransaction } from "drizzle-orm/pg-core";

/**
 * A transaction view for application work that can outlive its callback.
 * The owner retains the original handle for COMMIT/ROLLBACK. Prepared builders
 * and relational queries receive a separate session whose driver rejects work
 * after this lifetime ends, even when the connection has returned to the pool.
 */
export function transactionLifetime<T extends object>(
	transaction: T,
	assertActive: () => void,
): T {
	const session = Reflect.get(transaction, "session");
	const client = session && Reflect.get(session, "client");
	if (!is(transaction, PgTransaction) || !client) {
		throw new Error("Query transaction does not support a guarded lifetime");
	}

	const wrapLazyQuery = (value: unknown): unknown => {
		// Bun SQL queries execute lazily. Guard awaiting a query created before
		// cancellation too; plain driver promises have already submitted SQL.
		if (
			!value ||
			(typeof value !== "object" && typeof value !== "function") ||
			typeof Reflect.get(value, "values") !== "function" ||
			typeof Reflect.get(value, "then") !== "function"
		)
			return value;
		return new Proxy(value, {
			get(target, key) {
				const member = Reflect.get(target, key, target);
				return typeof member === "function"
					? (...args: unknown[]) => {
							assertActive();
							return wrapLazyQuery(Reflect.apply(member, target, args));
						}
					: member;
			},
		});
	};
	const guardedClient = new Proxy(client, {
		get(target, key) {
			const member = Reflect.get(target, key, target);
			return typeof member === "function"
				? (...args: unknown[]) => {
						assertActive();
						return wrapLazyQuery(Reflect.apply(member, target, args));
					}
				: member;
		},
		apply(target, receiver, args) {
			assertActive();
			return wrapLazyQuery(
				Reflect.apply(
					target as (...args: unknown[]) => unknown,
					receiver,
					args,
				),
			);
		},
	});
	const guardedSession = new Proxy(session, {
		get(target, key, receiver) {
			return key === "client"
				? guardedClient
				: Reflect.get(target, key, receiver);
		},
	});
	// These constructor fields are shared by the pinned PostgreSQL Drizzle
	// transactions (Bun SQL, node-postgres, PGlite). Rebuild query registries so
	// they cannot retain a prepared query's original, unguarded session.
	const view = Reflect.construct(Reflect.get(transaction, "constructor"), [
		Reflect.get(transaction, "dialect"),
		guardedSession,
		Reflect.get(transaction, "relations"),
		Reflect.get(transaction, "schema"),
		Reflect.get(transaction, "nestedIndex"),
	]);
	Object.defineProperty(view, "transaction", {
		value: () => {
			throw new Error("Query routes cannot open nested transactions");
		},
	});
	return view as T;
}
