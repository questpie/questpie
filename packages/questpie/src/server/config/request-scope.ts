/**
 * RequestScope — per-request service memoization.
 *
 * Each request/execution scope gets a new RequestScope that:
 * - Memoizes scoped service instances (resolved once per scope)
 * - Lazily resolves sync scoped services on first access
 * - Disposes all scoped instances on scope end
 *
 * @module
 */

import { AsyncLocalStorage } from "node:async_hooks";

export type RequestServiceDisposer = (
	instance: unknown,
) => void | Promise<void>;

interface ActiveRequestScope {
	app: unknown;
	scope: RequestScope;
}

const requestScopeStorage = new AsyncLocalStorage<ActiveRequestScope>();

/**
 * Per-request scope for memoized service resolution.
 */
export class RequestScope {
	private _cache = new Map<string, unknown>();
	private _disposers = new Map<string, RequestServiceDisposer>();
	private _disposed = false;

	/**
	 * Get a cached scoped service, or resolve it lazily via factory.
	 * Throws if factory returns a Promise (async services must be pre-resolved
	 * via set() before handler execution).
	 */
	getOrCreate<T>(
		name: string,
		factory: () => T,
		dispose?: RequestServiceDisposer,
	): T {
		if (this._disposed) {
			throw new Error("Cannot resolve from a disposed request scope");
		}

		if (this._cache.has(name)) return this._cache.get(name) as T;

		const instance = factory();
		if (instance instanceof Promise) {
			throw new Error(
				`Scoped service "${name}" returned a Promise from sync resolution. ` +
					`Async scoped services must be eagerly resolved at createContext() time.`,
			);
		}

		this._cache.set(name, instance);
		if (dispose) this._disposers.set(name, dispose);
		return instance;
	}

	/**
	 * Pre-populate a service into the scope cache.
	 * Used for eagerly-resolved async services.
	 */
	set(name: string, instance: unknown, dispose?: RequestServiceDisposer): void {
		this._cache.set(name, instance);
		if (dispose) this._disposers.set(name, dispose);
	}

	/**
	 * Check if a service is already cached.
	 */
	has(name: string): boolean {
		return this._cache.has(name);
	}

	/**
	 * Get a cached instance (no creation).
	 */
	get<T>(name: string): T | undefined {
		return this._cache.get(name) as T | undefined;
	}

	/**
	 * Dispose all scoped services (reverse insertion order).
	 */
	async dispose(
		disposers: Map<string, RequestServiceDisposer> = this._disposers,
	): Promise<void> {
		if (this._disposed) return;
		this._disposed = true;

		const errors: unknown[] = [];
		const entries = [...this._cache.entries()];
		for (let index = entries.length - 1; index >= 0; index--) {
			const [name, instance] = entries[index]!;
			const dispose = disposers.get(name);
			if (dispose) {
				try {
					await dispose(instance);
				} catch (error) {
					errors.push(error);
				}
			}
		}

		this._cache.clear();
		this._disposers.clear();

		if (errors.length > 0) {
			throw new AggregateError(
				errors,
				"Failed to dispose one or more request-scoped services",
			);
		}
	}
}

export function getActiveRequestScope(app: unknown): RequestScope | undefined {
	const active = requestScopeStorage.getStore();
	if (!active || active.app !== app) return undefined;
	return active.scope;
}

export function runWithRequestScope<T>(
	app: unknown,
	scope: RequestScope,
	callback: () => T,
): T {
	return requestScopeStorage.run({ app, scope }, callback);
}

/** Dispose a scope without losing an execution error when cleanup also fails. */
export async function disposeRequestScopeAfterError(
	scope: RequestScope,
	error: unknown,
): Promise<never> {
	try {
		await scope.dispose();
	} catch (cleanupError) {
		// oxlint-disable-next-line preserve-caught-error -- AggregateError.errors retains cleanupError; cause keeps the primary failure.
		throw new AggregateError(
			[error, cleanupError],
			"Request execution and scope disposal both failed",
			{ cause: error },
		);
	}
	throw error;
}

/** Run one framework-owned execution in a fresh, automatically disposed scope. */
export function runInFreshRequestScope<T>(
	app: unknown,
	callback: () => T | Promise<T>,
): Promise<T> {
	const scope = new RequestScope();
	return runWithRequestScope(app, scope, async () => {
		let failed = false;
		let failure: unknown;
		let result: T | undefined;
		try {
			result = await callback();
		} catch (error) {
			failed = true;
			failure = error;
		}

		if (failed) return disposeRequestScopeAfterError(scope, failure);
		await scope.dispose();
		return result as T;
	});
}
