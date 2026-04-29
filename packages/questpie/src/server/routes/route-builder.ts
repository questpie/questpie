/**
 * Route Builder
 *
 * Immutable builder with type-state generics for defining routes.
 * Each method returns a new frozen instance.
 *
 * @example JSON route:
 * ```ts
 * route().post().schema(z.object({ name: z.string() })).handler(({ input }) => ({ ok: true }))
 * ```
 *
 * @example Raw route:
 * ```ts
 * route().get().raw().handler(({ request }) => new Response("ok"))
 * ```
 *
 * @see QUE-158 (Unified route() builder + URL flattening)
 */

import type { z } from "zod";

import type {
	HttpMethod,
	JsonRouteParams,
	JsonRouteDefinition,
	JsonRouteHandlerArgs,
	RawRouteDefinition,
	RawRouteHandlerArgs,
	RouteAccess,
} from "./types.js";

// ============================================================================
// Builder State Types (phantom types for compile-time enforcement)
// ============================================================================

type NoMethod = { __method: false };
type HasMethod<M extends HttpMethod = HttpMethod> = { __method: M };

type NoMode = { __mode: false };
type JsonMode = { __mode: "json" };
type RawMode = { __mode: "raw" };

type NoSchema = { __schema: false };
type HasSchema<T = any> = { __schema: T };

// ============================================================================
// Internal config shape
// ============================================================================

interface BuilderConfig {
	method?: HttpMethod | HttpMethod[];
	mode?: "json" | "raw";
	schema?: z.ZodSchema<any>;
	outputSchema?: z.ZodSchema<any>;
	access?: RouteAccess;
	handler?: (...args: any[]) => any;
}

// ============================================================================
// RouteBuilder class
// ============================================================================

/**
 * Immutable route builder. Each step returns a new frozen instance.
 * `.handler()` is terminal — returns a `RouteDefinition`.
 *
 * Default method: POST
 */
export class RouteBuilder<
	TParams extends JsonRouteParams = JsonRouteParams,
	_TMethod extends NoMethod | HasMethod = NoMethod,
	TMode extends NoMode | JsonMode | RawMode = NoMode,
	TSchema extends NoSchema | HasSchema = NoSchema,
> {
	/** @internal */
	private readonly _config: Readonly<BuilderConfig>;

	constructor(config: BuilderConfig = {}) {
		this._config = Object.freeze({ ...config });
		Object.freeze(this);
	}

	// ── HTTP Method setters ─────────────────────────────────────
	// Chainable: `.get().post()` registers both GET and POST.

	private _addMethod(m: HttpMethod): HttpMethod | HttpMethod[] {
		const existing = this._config.method;
		if (!existing) return m;
		const arr = Array.isArray(existing) ? existing : [existing];
		return arr.includes(m) ? arr : [...arr, m];
	}

	get(): RouteBuilder<TParams, HasMethod<"GET">, TMode, TSchema> {
		return new RouteBuilder({ ...this._config, method: this._addMethod("GET") });
	}

	post(): RouteBuilder<TParams, HasMethod<"POST">, TMode, TSchema> {
		return new RouteBuilder({ ...this._config, method: this._addMethod("POST") });
	}

	put(): RouteBuilder<TParams, HasMethod<"PUT">, TMode, TSchema> {
		return new RouteBuilder({ ...this._config, method: this._addMethod("PUT") });
	}

	delete(): RouteBuilder<TParams, HasMethod<"DELETE">, TMode, TSchema> {
		return new RouteBuilder({ ...this._config, method: this._addMethod("DELETE") });
	}

	patch(): RouteBuilder<TParams, HasMethod<"PATCH">, TMode, TSchema> {
		return new RouteBuilder({ ...this._config, method: this._addMethod("PATCH") });
	}

	head(): RouteBuilder<TParams, HasMethod<"HEAD">, TMode, TSchema> {
		return new RouteBuilder({ ...this._config, method: this._addMethod("HEAD") });
	}

	options(): RouteBuilder<TParams, HasMethod<"OPTIONS">, TMode, TSchema> {
		return new RouteBuilder({
			...this._config,
			method: this._addMethod("OPTIONS"),
		});
	}

	// ── Mode ────────────────────────────────────────────────────

	/**
	 * Mark this route as raw — handler receives `(request, ctx)` and returns `Response`.
	 * Cannot be combined with `.schema()`.
	 */
	raw(): RouteBuilder<TParams, _TMethod, RawMode, NoSchema> {
		return new RouteBuilder({
			...this._config,
			mode: "raw",
			schema: undefined,
			outputSchema: undefined,
		});
	}

	// ── Schema ──────────────────────────────────────────────────

	/**
	 * Set input validation schema. Implies JSON mode.
	 * Cannot be combined with `.raw()`.
	 */
	schema<TInput>(
		schema: z.ZodSchema<TInput>,
	): RouteBuilder<TParams, _TMethod, JsonMode, HasSchema<TInput>> {
		return new RouteBuilder({ ...this._config, mode: "json", schema });
	}

	/**
	 * Set output validation schema (optional).
	 */
	outputSchema<TOutput>(
		schema: z.ZodSchema<TOutput>,
	): RouteBuilder<TParams, _TMethod, TMode, TSchema> {
		return new RouteBuilder({ ...this._config, outputSchema: schema }) as any;
	}

	/**
	 * Declare the URL params shape available to the handler.
	 *
	 * This is the source-level path to exact params safety. Codegen can infer
	 * route params for generated `AppRoutes`, but it cannot retroactively type
	 * the handler inside this source file from the filename alone.
	 */
	params<TNextParams extends JsonRouteParams>(): RouteBuilder<
		TNextParams,
		_TMethod,
		TMode,
		TSchema
	> {
		return new RouteBuilder({ ...this._config }) as any;
	}

	// ── Access ──────────────────────────────────────────────────

	/**
	 * Set access control for this route.
	 */
	access(access: RouteAccess): RouteBuilder<TParams, _TMethod, TMode, TSchema> {
		return new RouteBuilder({ ...this._config, access }) as any;
	}

	// ── Terminal: handler ───────────────────────────────────────

	/**
	 * Terminal method — defines the handler and returns a frozen `RouteDefinition`.
	 *
	 * The return type depends on the builder state:
	 * - If `.schema()` was called → `JsonRouteDefinition`
	 * - If `.raw()` was called → `RawRouteDefinition`
	 * - Otherwise → defaults to `RawRouteDefinition` with POST method
	 */
	handler(
		handler: TMode extends RawMode
			? (args: RawRouteHandlerArgs<TParams>) => Response | Promise<Response>
			: TSchema extends HasSchema<infer TInput>
				? (args: JsonRouteHandlerArgs<TInput, TParams>) => any
				: (args: RawRouteHandlerArgs<TParams>) => Response | Promise<Response>,
	): TMode extends RawMode
		? RawRouteDefinition<TParams>
		: TSchema extends HasSchema<infer TInput>
			? JsonRouteDefinition<TInput, any, TParams>
			: RawRouteDefinition<TParams> {
		const method = this._config.method ?? "POST";

		if (this._config.mode === "json" || this._config.schema) {
			// JSON route
			const def: JsonRouteDefinition<any, any, TParams> = {
				__brand: "route",
				mode: "json",
				method,
				schema: this._config.schema!,
				outputSchema: this._config.outputSchema,
				access: this._config.access,
				handler: handler as any,
			};
			return Object.freeze(def) as any;
		}

		// Raw route (default)
		const def: RawRouteDefinition<TParams> = {
			__brand: "route",
			mode: "raw",
			method,
			access: this._config.access,
			handler: handler as any,
		};
		return Object.freeze(def) as any;
	}
}
