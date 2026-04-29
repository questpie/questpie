/**
 * Dependency tracking utilities for dynamic field resolvers.
 *
 * Uses a proxy to detect which properties are accessed during resolver execution.
 */

type AnyRecord = Record<string, any>;

interface DependencyTrackingResult<T> {
	result: T | undefined;
	deps: string[];
	error: Error | null;
}

/**
 * Track value dependencies accessed by a resolver function.
 */
export function trackDependencies<T>(
	values: AnyRecord,
	resolver: (values: AnyRecord) => T,
): DependencyTrackingResult<T> {
	const deps = new Set<string>();

	const createProxy = (target: unknown, prefix = ""): unknown => {
		if (!target || typeof target !== "object") {
			return target;
		}

		return new Proxy(target as AnyRecord, {
			get(currentTarget, prop: string | symbol) {
				if (typeof prop === "symbol" || prop === "then") {
					return Reflect.get(currentTarget, prop);
				}

				const path = prefix ? `${prefix}.${prop}` : prop;
				deps.add(path);

				const nextValue = Reflect.get(currentTarget, prop);
				if (nextValue && typeof nextValue === "object") {
					return createProxy(nextValue, path);
				}

				return nextValue;
			},
			has(currentTarget, prop: string | symbol) {
				if (typeof prop === "symbol") {
					return Reflect.has(currentTarget, prop);
				}

				const path = prefix ? `${prefix}.${prop}` : prop;
				deps.add(path);
				return Reflect.has(currentTarget, prop);
			},
			ownKeys(currentTarget) {
				const keys = Reflect.ownKeys(currentTarget);
				for (const key of keys) {
					if (typeof key !== "string") continue;
					const path = prefix ? `${prefix}.${key}` : key;
					deps.add(path);
				}
				return keys;
			},
			getOwnPropertyDescriptor(currentTarget, prop) {
				return Reflect.getOwnPropertyDescriptor(currentTarget, prop);
			},
		});
	};

	try {
		const proxy = createProxy(values) as AnyRecord;
		const result = resolver(proxy);

		return {
			result,
			deps: [...deps],
			error: null,
		};
	} catch (error) {
		return {
			result: undefined,
			deps: [...deps],
			error: error instanceof Error ? error : new Error(String(error)),
		};
	}
}

/**
 * Scope dependency paths for nested field prefixes.
 */
export function scopeDependencies(
	deps: string[],
	fieldPrefix?: string,
): string[] {
	if (!fieldPrefix) {
		return deps.filter((dep) => dep.length > 0 && !dep.startsWith("$"));
	}

	return deps
		.filter((dep) => dep.length > 0 && !dep.startsWith("$"))
		.map((dep) => `${fieldPrefix}.${dep}`);
}
