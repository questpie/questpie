/**
 * RequestScope — per-request service memoization.
 *
 * All scoped services are lazy — resolved on first access, memoized per scope.
 * Async factories return Promise<T> — callers `await` the result.
 * The type system distinguishes sync vs async services at compile time.
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
	 * Async factories return Promise — caller must await.
	 * Result is memoized (including the Promise itself for async services).
	 */
	getOrCreate<T>(name: string, factory: () => T): T {
		if (this._disposed) {
			throw new Error("Cannot resolve from a disposed request scope");
		}

		const cached = this._cache.get(name);
		if (cached !== undefined) return cached as T;

		const instance = factory();
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
