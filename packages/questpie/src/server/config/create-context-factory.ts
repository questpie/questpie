/**
 * Context Factory
 *
 * Creates a typed `createContext()` function bound to an app instance.
 * Previously emitted as 12 lines of string code in every generated index.ts —
 * now a single importable utility.
 *
 * @see QUE-163 — Codegen Simplification
 */

import type { AppContext } from "#questpie/server/config/app-context.js";
import { extractAppServices } from "#questpie/server/config/app-context.js";
import type { RequestContext } from "#questpie/server/config/context.js";
import { runWithInternalAppContextStore } from "#questpie/server/config/internal-context.js";
import {
	RequestScope,
	runWithRequestScope,
} from "#questpie/server/config/request-scope.js";

export type DisposableAppContext = AppContext &
	Partial<RequestContext> &
	AsyncDisposable;

function bindContextResource<T>(
	resource: T,
	run: <TResult>(callback: () => TResult) => TResult,
	cache = new WeakMap<object, unknown>(),
): T {
	if (
		resource === null ||
		(typeof resource !== "object" && typeof resource !== "function")
	) {
		return resource;
	}

	const bind = (value: unknown): unknown => {
		if (
			value === null ||
			(typeof value !== "object" && typeof value !== "function")
		) {
			return value;
		}
		const cached = cache.get(value);
		if (cached) return cached;

		const methodCache = new Map<PropertyKey, unknown>();
		const facade =
			typeof value === "function" ? (..._args: unknown[]) => undefined : {};
		let bound: object;
		bound = new Proxy(facade, {
			get(_target, property) {
				const child = Reflect.get(value, property, value);
				if (typeof child === "function") {
					const cachedMethod = methodCache.get(property);
					if (cachedMethod) return cachedMethod;
					const wrapped = (...args: unknown[]) =>
						run(() => Reflect.apply(child, value, args));
					methodCache.set(property, wrapped);
					return wrapped;
				}
				return bind(child);
			},
			apply(_target, thisArg, args) {
				return run(() =>
					Reflect.apply(
						value as (...args: unknown[]) => unknown,
						thisArg === bound ? value : thisArg,
						args,
					),
				);
			},
			getPrototypeOf: () => Reflect.getPrototypeOf(value),
			has: (_target, property) => Reflect.has(value, property),
			set: (_target, property, nextValue) =>
				Reflect.set(value, property, nextValue, value),
		});
		cache.set(value, bound);
		return bound;
	};

	return bind(resource) as T;
}

function bindContextResources<T extends Record<string, unknown>>(
	resources: T,
	run: <TResult>(callback: () => TResult) => TResult,
): T {
	return new Proxy(resources, {
		get(target, property, receiver) {
			return bindContextResource(Reflect.get(target, property, receiver), run);
		},
	}) as T;
}

function bindServiceSurfaces(
	context: Record<string, unknown>,
	app: { _serviceDefs?: unknown; config?: { services?: unknown } },
	run: <TResult>(callback: () => TResult) => TResult,
): void {
	const serviceDefs = app._serviceDefs ?? app.config?.services;
	if (!serviceDefs) return;
	const cache = new WeakMap<object, unknown>();
	const reservedContextKeys = new Set([
		"accessMode",
		"actor",
		"app",
		"collections",
		"db",
		"email",
		"executor",
		"globals",
		"kv",
		"locale",
		"logger",
		"observability",
		"principal",
		"queue",
		"realtime",
		"search",
		"services",
		"session",
		"stage",
		"storage",
		"t",
		"tables",
	]);

	for (const [name, input] of Object.entries(
		serviceDefs as Record<string, any>,
	)) {
		const state =
			input && typeof input === "object" && "state" in input
				? input.state
				: input;
		const namespace = state?.namespace as string | null | undefined;
		if (namespace === undefined || namespace === "services") {
			const services = context.services as Record<string, unknown>;
			services[name] = bindContextResource(services[name], run, cache);
		} else if (namespace === null) {
			if (!reservedContextKeys.has(name)) {
				context[name] = bindContextResource(context[name], run, cache);
			}
		} else {
			const services = context[namespace] as Record<string, unknown>;
			services[name] = bindContextResource(services[name], run, cache);
		}
	}
}

/**
 * Create a `createContext()` function bound to the given app instance.
 *
 * The returned function creates a typed `AppContext` for use in scripts,
 * tests, or standalone code outside of request handlers.
 *
 * @example
 * ```ts
 * // In .generated/index.ts:
 * import { createContextFactory } from "questpie";
 * export const createContext = createContextFactory(app);
 *
 * // In user code:
 * import { createContext } from "#questpie";
 * const ctx = await createContext();
 * const posts = await ctx.collections.posts.find({});
 * ```
 */
export function createContextFactory(
	app: any,
): (options?: {
	accessMode?: "system" | "user";
}) => Promise<DisposableAppContext> {
	return async (options) => {
		const scope = new RequestScope();
		try {
			return await runWithRequestScope(app, scope, async () => {
				const reqCtx = await app.createContext({
					accessMode: options?.accessMode ?? "system",
				});
				const services = extractAppServices(app, {
					db: app.db,
					session: reqCtx.session,
					principal: reqCtx.principal,
					actor: reqCtx.actor,
					accessMode: options?.accessMode ?? "system",
					scope,
				});
				const context = { ...services, ...reqCtx } as DisposableAppContext;
				const run = <TResult>(callback: () => TResult): TResult =>
					runWithRequestScope(app, scope, () =>
						runWithInternalAppContextStore(context, callback),
					);
				context.collections = bindContextResources(
					context.collections as Record<string, unknown>,
					run,
				) as typeof context.collections;
				context.globals = bindContextResources(
					context.globals as Record<string, unknown>,
					run,
				) as typeof context.globals;
				bindServiceSurfaces(context, app, run);
				Object.defineProperty(context, Symbol.asyncDispose, {
					configurable: false,
					enumerable: false,
					value: () => scope.dispose(),
				});
				return context;
			});
		} catch (error) {
			try {
				await scope.dispose();
			} catch (cleanupError) {
				throw new AggregateError(
					[error, cleanupError],
					"Standalone context creation and scope disposal both failed",
					{ cause: error },
				);
			}
			throw error;
		}
	};
}
