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

/**
 * Per-request scope for memoized service resolution.
 */
export class RequestScope {
	private _cache = new Map<string, unknown>();
	private _disposed = false;

	/**
	 * Get a cached scoped service, or resolve it lazily via factory.
	 * Throws if factory returns a Promise (async services must be pre-resolved
	 * via set() before handler execution).
	 */
	getOrCreate<T>(name: string, factory: () => T): T {
		if (this._disposed) {
			throw new Error("Cannot resolve from a disposed request scope");
		}

		const cached = this._cache.get(name);
		if (cached !== undefined) return cached as T;

		const instance = factory();
		if (instance instanceof Promise) {
			throw new Error(
				`Scoped service "${name}" returned a Promise from sync resolution. ` +
					`Async scoped services must be eagerly resolved at createContext() time.`,
			);
		}

		this._cache.set(name, instance);
		return instance;
	}

	/**
	 * Pre-populate a service into the scope cache.
	 * Used for eagerly-resolved async services.
	 */
	set(name: string, instance: unknown): void {
		this._cache.set(name, instance);
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
		disposers?: Map<string, (instance: unknown) => void | Promise<void>>,
	): Promise<void> {
		if (this._disposed) return;
		this._disposed = true;

		if (disposers) {
			const entries = [...this._cache.entries()].reverse();
			for (const [name, instance] of entries) {
				const dispose = disposers.get(name);
				if (dispose) {
					try {
						await dispose(instance);
					} catch (err) {
						console.error(
							`[RequestScope] Failed to dispose "${name}":`,
							err,
						);
					}
				}
			}
		}

		this._cache.clear();
	}
}
