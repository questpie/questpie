/**
 * ScopedContainer — PoC for QUE-246
 *
 * Demonstrates:
 * 1. Per-scope memoization (same service resolved once per scope)
 * 2. Async service creation within a scope
 * 3. Disposal on scope end (reverse creation order)
 * 4. Circular dependency detection at scope level
 * 5. Singleton → scoped dependency guard
 *
 * This is a standalone PoC. Phase 4 will integrate these patterns
 * into the main Questpie service container.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Lifecycle = "singleton" | "scoped";

export interface ServiceDef<T = unknown> {
	lifecycle: Lifecycle;
	create: (ctx: ResolutionContext) => T | Promise<T>;
	dispose?: (instance: T) => void | Promise<void>;
}

export interface ResolutionContext {
	resolve<T = unknown>(name: string): T;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class CircularDependencyError extends Error {
	constructor(cycle: string[]) {
		super(
			`Circular dependency detected: ${[...cycle, cycle[0]!].join(" -> ")}`,
		);
		this.name = "CircularDependencyError";
	}
}

export class SingletonScopedViolationError extends Error {
	constructor(singletonName: string, scopedName: string) {
		super(
			`Singleton "${singletonName}" cannot depend on scoped service "${scopedName}" at init time`,
		);
		this.name = "SingletonScopedViolationError";
	}
}

// ---------------------------------------------------------------------------
// ScopedContainer
// ---------------------------------------------------------------------------

export class ScopedContainer {
	private readonly _defs = new Map<string, ServiceDef>();
	private readonly _singletons = new Map<string, unknown>();
	private readonly _singletonCreationOrder: string[] = [];
	private _initialized = false;

	register(name: string, def: ServiceDef): void {
		if (this._initialized) {
			throw new Error("Cannot register services after initialization");
		}
		this._defs.set(name, def);
	}

	/**
	 * Initialize all singleton services (async, in registration order).
	 * Dependency order is handled by lazy resolution — if A depends on B,
	 * B is created when A's factory accesses it.
	 */
	async init(): Promise<void> {
		for (const [name, def] of this._defs) {
			if (def.lifecycle !== "singleton") continue;
			if (this._singletons.has(name)) continue;

			await this._resolveSingleton(name, []);
		}
		this._initialized = true;
	}

	/**
	 * Create a new execution scope.
	 * All scoped services resolved within this scope are memoized and
	 * disposed when `scope.dispose()` is called.
	 */
	createScope(): Scope {
		if (!this._initialized) {
			throw new Error("Container must be initialized before creating scopes");
		}
		return new Scope(this._defs, this._singletons);
	}

	/**
	 * Destroy the container: dispose singletons in reverse creation order.
	 */
	async destroy(): Promise<void> {
		for (let i = this._singletonCreationOrder.length - 1; i >= 0; i--) {
			const name = this._singletonCreationOrder[i]!;
			const def = this._defs.get(name);
			const instance = this._singletons.get(name);
			if (def?.dispose && instance !== undefined) {
				await def.dispose(instance);
			}
		}
		this._singletons.clear();
		this._singletonCreationOrder.length = 0;
	}

	// -- private --

	private async _resolveSingleton(
		name: string,
		stack: string[],
	): Promise<unknown> {
		const existing = this._singletons.get(name);
		if (existing !== undefined) return existing;

		const def = this._defs.get(name);
		if (!def) throw new Error(`Unknown service: ${name}`);

		// Check circular
		const idx = stack.indexOf(name);
		if (idx !== -1) {
			throw new CircularDependencyError(stack.slice(idx));
		}

		const childStack = [...stack, name];

		const ctx: ResolutionContext = {
			resolve: <T = unknown>(depName: string): T => {
				const depDef = this._defs.get(depName);
				if (!depDef) throw new Error(`Unknown service: ${depName}`);

				if (depDef.lifecycle === "scoped") {
					throw new SingletonScopedViolationError(name, depName);
				}

				// Sync resolution for already-resolved singletons
				const cached = this._singletons.get(depName);
				if (cached !== undefined) return cached as T;

				// Lazy trigger — must be sync (same as current behavior)
				const result = this._resolveSingletonSync(depName, childStack);
				return result as T;
			},
		};

		const instance = await def.create(ctx);
		this._singletons.set(name, instance);
		this._singletonCreationOrder.push(name);
		return instance;
	}

	private _resolveSingletonSync(name: string, stack: string[]): unknown {
		const existing = this._singletons.get(name);
		if (existing !== undefined) return existing;

		const def = this._defs.get(name);
		if (!def) throw new Error(`Unknown service: ${name}`);

		const idx = stack.indexOf(name);
		if (idx !== -1) {
			throw new CircularDependencyError(stack.slice(idx));
		}

		const childStack = [...stack, name];

		const ctx: ResolutionContext = {
			resolve: <T = unknown>(depName: string): T => {
				const depDef = this._defs.get(depName);
				if (!depDef) throw new Error(`Unknown service: ${depName}`);

				if (depDef.lifecycle === "scoped") {
					throw new SingletonScopedViolationError(name, depName);
				}

				return this._resolveSingletonSync(depName, childStack) as T;
			},
		};

		const result = def.create(ctx);
		if (result instanceof Promise) {
			throw new Error(
				`Singleton "${name}" has async create() but was lazily triggered. Reorder so it initializes first.`,
			);
		}

		this._singletons.set(name, result);
		this._singletonCreationOrder.push(name);
		return result;
	}
}

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

export class Scope {
	private readonly _cache = new Map<string, unknown>();
	private readonly _creationOrder: string[] = [];
	private _disposed = false;

	constructor(
		private readonly _defs: Map<string, ServiceDef>,
		private readonly _singletons: Map<string, unknown>,
	) {}

	/**
	 * Resolve a service within this scope.
	 * - Singletons: returned from container cache (no new instance).
	 * - Scoped: memoized per-scope. Created on first access, reused after.
	 */
	resolve<T = unknown>(name: string, stack: string[] = []): T {
		if (this._disposed) {
			throw new Error("Cannot resolve from a disposed scope");
		}

		const def = this._defs.get(name);
		if (!def) throw new Error(`Unknown service: ${name}`);

		// Singletons come from container
		if (def.lifecycle === "singleton") {
			const instance = this._singletons.get(name);
			if (instance === undefined) {
				throw new Error(`Singleton "${name}" not initialized`);
			}
			return instance as T;
		}

		// Scoped: check memo cache
		const cached = this._cache.get(name);
		if (cached !== undefined) return cached as T;

		// Circular check
		const idx = stack.indexOf(name);
		if (idx !== -1) {
			throw new CircularDependencyError(stack.slice(idx));
		}

		const childStack = [...stack, name];

		const ctx: ResolutionContext = {
			resolve: <U = unknown>(depName: string): U => {
				return this.resolve<U>(depName, childStack);
			},
		};

		const result = def.create(ctx);
		if (result instanceof Promise) {
			throw new Error(
				`Scoped service "${name}" returned a Promise. Use scope.resolveAsync() for async services.`,
			);
		}

		this._cache.set(name, result);
		this._creationOrder.push(name);
		return result as T;
	}

	/**
	 * Async-resolve a scoped service.
	 * Memoized: if already resolved (sync or async), returns cached.
	 */
	async resolveAsync<T = unknown>(
		name: string,
		stack: string[] = [],
	): Promise<T> {
		if (this._disposed) {
			throw new Error("Cannot resolve from a disposed scope");
		}

		const def = this._defs.get(name);
		if (!def) throw new Error(`Unknown service: ${name}`);

		if (def.lifecycle === "singleton") {
			const instance = this._singletons.get(name);
			if (instance === undefined) {
				throw new Error(`Singleton "${name}" not initialized`);
			}
			return instance as T;
		}

		const cached = this._cache.get(name);
		if (cached !== undefined) return cached as T;

		const idx = stack.indexOf(name);
		if (idx !== -1) {
			throw new CircularDependencyError(stack.slice(idx));
		}

		const childStack = [...stack, name];

		const ctx: ResolutionContext = {
			resolve: <U = unknown>(depName: string): U => {
				// In async resolution context, only already-cached services
				// can be resolved synchronously
				const cachedDep = this._cache.get(depName);
				if (cachedDep !== undefined) return cachedDep as U;

				const singletonDep = this._singletons.get(depName);
				if (singletonDep !== undefined) return singletonDep as U;

				// If it's a sync scoped dep, resolve it immediately
				const depDef = this._defs.get(depName);
				if (!depDef) throw new Error(`Unknown service: ${depName}`);

				return this.resolve<U>(depName, childStack);
			},
		};

		const result = await def.create(ctx);
		this._cache.set(name, result);
		this._creationOrder.push(name);
		return result as T;
	}

	/**
	 * Dispose all scoped services in reverse creation order.
	 */
	async dispose(): Promise<void> {
		if (this._disposed) return;
		this._disposed = true;

		for (let i = this._creationOrder.length - 1; i >= 0; i--) {
			const name = this._creationOrder[i]!;
			const def = this._defs.get(name);
			const instance = this._cache.get(name);
			if (def?.dispose && instance !== undefined) {
				await def.dispose(instance);
			}
		}

		this._cache.clear();
		this._creationOrder.length = 0;
	}
}
