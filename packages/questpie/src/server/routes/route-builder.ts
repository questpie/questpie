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
	RouteMeta,
} from "./types.js";

// ============================================================================
// Builder State Types (phantom types for compile-time enforcement)
// ============================================================================

type NoMethod = { __method: false };
type HasMethod<M extends HttpMethod = HttpMethod> = { __method: M };
type MethodOf<TMethod> =
	TMethod extends HasMethod<infer TMethodValue> ? TMethodValue : "POST";

type NoMode = { __mode: false };
type JsonMode = { __mode: "json" };
type RawMode = { __mode: "raw" };

// Explicit discriminant (`__schema: true/false`) — a structural `{ __schema: T }`
// would make `NoSchema = { __schema: false }` match `HasSchema<infer T>` as
// T=false, mis-classifying a schemaless `route().handler()` chain as a JSON route.
type NoSchema = { __schema: false };
type HasSchema<T = unknown> = { __schema: true; __schemaType: T };

// Explicit discriminant (`__output: true/false`) — a structural
// `{ __output: T }` would make NoOutput match `HasOutput<infer O>` as O=false.
type NoOutput = { __output: false };
type HasOutput<T = unknown> = { __output: true; __outputType: T };

// ============================================================================
// Internal config shape
// ============================================================================

interface BuilderConfig {
	method?: HttpMethod;
	mode?: "json" | "raw";
	schema?: z.ZodSchema<any>;
	outputSchema?: z.ZodSchema<any>;
	access?: RouteAccess;
	meta?: RouteMeta;
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
	TOutput extends NoOutput | HasOutput = NoOutput,
> {
	/** @internal */
	private readonly _config: Readonly<BuilderConfig>;

	constructor(config: BuilderConfig = {}) {
		this._config = Object.freeze({ ...config });
		Object.freeze(this);
	}

	// ── HTTP Method setters ─────────────────────────────────────

	private _setMethod(m: HttpMethod): HttpMethod {
		const existing = this._config.method;
		if (!existing) return m;
		if (existing === m) return m;
		throw new Error(
			`route() accepts one HTTP method; use method-suffixed route files for multiple methods on the same path`,
		);
	}

	get(): RouteBuilder<TParams, HasMethod<"GET">, TMode, TSchema, TOutput> {
		return new RouteBuilder({
			...this._config,
			method: this._setMethod("GET"),
		});
	}

	post(): RouteBuilder<TParams, HasMethod<"POST">, TMode, TSchema, TOutput> {
		return new RouteBuilder({
			...this._config,
			method: this._setMethod("POST"),
		});
	}

	put(): RouteBuilder<TParams, HasMethod<"PUT">, TMode, TSchema, TOutput> {
		return new RouteBuilder({
			...this._config,
			method: this._setMethod("PUT"),
		});
	}

	delete(): RouteBuilder<
		TParams,
		HasMethod<"DELETE">,
		TMode,
		TSchema,
		TOutput
	> {
		return new RouteBuilder({
			...this._config,
			method: this._setMethod("DELETE"),
		});
	}

	patch(): RouteBuilder<TParams, HasMethod<"PATCH">, TMode, TSchema, TOutput> {
		return new RouteBuilder({
			...this._config,
			method: this._setMethod("PATCH"),
		});
	}

	head(): RouteBuilder<TParams, HasMethod<"HEAD">, TMode, TSchema, TOutput> {
		return new RouteBuilder({
			...this._config,
			method: this._setMethod("HEAD"),
		});
	}

	options(): RouteBuilder<
		TParams,
		HasMethod<"OPTIONS">,
		TMode,
		TSchema,
		TOutput
	> {
		return new RouteBuilder({
			...this._config,
			method: this._setMethod("OPTIONS"),
		});
	}

	// ── Mode ────────────────────────────────────────────────────

	/**
	 * Mark this route as raw — handler receives `(request, ctx)` and returns `Response`.
	 * Cannot be combined with `.schema()`.
	 */
	raw(): RouteBuilder<TParams, _TMethod, RawMode, NoSchema, NoOutput> {
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
	): RouteBuilder<TParams, _TMethod, JsonMode, HasSchema<TInput>, TOutput> {
		return new RouteBuilder({ ...this._config, mode: "json", schema });
	}

	/**
	 * Set output validation schema (optional). Implies JSON mode — an
	 * `.outputSchema()`-only chain (no `.schema()`) is a JSON route whose input
	 * defaults to `unknown`, never a raw route.
	 *
	 * Besides runtime response validation, the schema becomes the route's
	 * output type. When `.schema()` was also called, `.handler()` constrains the
	 * handler's return type against it — a mismatch is a compile error.
	 */
	outputSchema<TNextOutput>(
		schema: z.ZodSchema<TNextOutput>,
	): RouteBuilder<
		TParams,
		_TMethod,
		JsonMode,
		TSchema,
		HasOutput<TNextOutput>
	> {
		return new RouteBuilder({
			...this._config,
			mode: "json",
			outputSchema: schema,
		}) as any;
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
		TSchema,
		TOutput
	> {
		return new RouteBuilder({ ...this._config }) as any;
	}

	// ── Access ──────────────────────────────────────────────────

	/**
	 * Set access control for this route.
	 */
	access(
		access: RouteAccess,
	): RouteBuilder<TParams, _TMethod, TMode, TSchema, TOutput> {
		return new RouteBuilder({ ...this._config, access }) as any;
	}

	// ── Metadata ────────────────────────────────────────────────

	/**
	 * Attach serializable metadata for introspection and integrations.
	 */
	meta(
		meta: RouteMeta,
	): RouteBuilder<TParams, _TMethod, TMode, TSchema, TOutput> {
		return new RouteBuilder({ ...this._config, meta }) as any;
	}

	// ── Terminal: handler ───────────────────────────────────────

	/**
	 * Terminal method — defines the handler and returns a frozen `RouteDefinition`.
	 *
	 * The return type depends on the builder state:
	 * - If `.schema()` was called → `JsonRouteDefinition`
	 * - If `.raw()` was called → `RawRouteDefinition`
	 * - Otherwise → defaults to `RawRouteDefinition` with POST method
	 *
	 * When `.outputSchema()` was set, the schema type becomes the route's
	 * output type (`InferRouteOutput<typeof def>`, surviving codegen) and the
	 * handler's return is checked against it — a mismatch is a compile error.
	 *
	 * For schema routes WITHOUT an `.outputSchema()`, the handler's return type
	 * is inferred (`TReturn`) and threaded into `JsonRouteDefinition`'s output
	 * slot, so `InferRouteOutput<typeof def>` recovers the concrete handler shape
	 * instead of collapsing to `any`. The handler arg type (`JsonRouteHandlerArgs`)
	 * already references `AppContext`, so inferring the *return* adds no new edge
	 * to the module type graph.
	 */
	handler<TReturn>(
		handler: TMode extends RawMode
			? (args: RawRouteHandlerArgs<TParams>) => Response | Promise<Response>
			: TSchema extends HasSchema<infer TInput>
				? TOutput extends HasOutput<infer O>
					? (args: JsonRouteHandlerArgs<TInput, TParams>) => O | Promise<O>
					: (
							args: JsonRouteHandlerArgs<TInput, TParams>,
						) => TReturn | Promise<TReturn>
				: // Output-only chain (`.outputSchema()` with no `.schema()`): JSON
					// route with `unknown` input. Output comes from the schema, so the
					// handler return is unconstrained here.
					TMode extends JsonMode
					? (args: JsonRouteHandlerArgs<unknown, TParams>) => any
					: (
							args: RawRouteHandlerArgs<TParams>,
						) => Response | Promise<Response>,
	): TMode extends RawMode
		? RawRouteDefinition<TParams, MethodOf<_TMethod>>
		: TSchema extends HasSchema<infer TInput>
			? JsonRouteDefinition<
					TInput,
					TOutput extends HasOutput<infer O> ? O : Awaited<TReturn>,
					TParams
				>
			: // Output-only chain → JSON route, `unknown` input, output from schema.
				TMode extends JsonMode
				? JsonRouteDefinition<
						unknown,
						TOutput extends HasOutput<infer O> ? O : unknown,
						TParams
					>
				: RawRouteDefinition<TParams, MethodOf<_TMethod>> {
		const method = (this._config.method ?? "POST") as MethodOf<_TMethod>;

		if (this._config.mode === "json" || this._config.schema) {
			// JSON route
			const def: JsonRouteDefinition<any, any, TParams> = {
				__brand: "route",
				mode: "json",
				method,
				schema: this._config.schema!,
				outputSchema: this._config.outputSchema,
				access: this._config.access,
				meta: this._config.meta,
				handler: handler as any,
			};
			return Object.freeze(def) as any;
		}

		// Raw route (default)
		const def: RawRouteDefinition<TParams, MethodOf<_TMethod>> = {
			__brand: "route",
			mode: "raw",
			method,
			access: this._config.access,
			meta: this._config.meta,
			handler: handler as any,
		};
		return Object.freeze(def) as any;
	}
}
