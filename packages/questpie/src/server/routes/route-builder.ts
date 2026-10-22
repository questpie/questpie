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
	QueryRouteDefinition,
	RawRouteDefinition,
	RawRouteHandlerArgs,
	RouteAccess,
	RouteLiveOptions,
	RouteMeta,
	RouteQueryOptions,
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
// `.query()` is a JSON route with snapshot semantics; `TLive` records `live`.
type QueryMode<TLive extends boolean = boolean> = {
	__mode: "query";
	__live: TLive;
};
// `.schema()` / `.outputSchema()` imply JSON mode without dropping `.query()`.
type JsonModeOf<TMode> = TMode extends QueryMode ? TMode : JsonMode;

// Explicit discriminant (`__schema: true/false`) — a structural `{ __schema: T }`
// would make `NoSchema = { __schema: false }` match `HasSchema<infer T>` as
// T=false, mis-classifying a schemaless `route().handler()` chain as a JSON route.
type NoSchema = { __schema: false };
type HasSchema<T = unknown> = { __schema: true; __schemaType: T };

// Explicit discriminant (`__output: true/false`) — a structural
// `{ __output: T }` would make NoOutput match `HasOutput<infer O>` as O=false.
type NoOutput = { __output: false };
type HasOutput<T = unknown> = { __output: true; __outputType: T };

type InputOf<TSchema> =
	TSchema extends HasSchema<infer TInput> ? TInput : unknown;

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
	query?: RouteQueryOptions<any>;
	handler?: (...args: any[]) => any;
}

/** Bounds of `live.maxAgeMs`: frequent enough to expire stale authority, rare enough to stay cheap. */
const LIVE_MAX_AGE_MS = { min: 1_000, max: 3_600_000 } as const;

function assertLiveOptions(live: RouteLiveOptions<any>): void {
	if (typeof live?.data !== "function") {
		throw new Error("route().query({ live }) requires a data(input) function");
	}
	if (live.authority !== undefined && typeof live.authority !== "function") {
		throw new Error("route().query({ live }) authority must be a function");
	}
	const { maxAgeMs } = live;
	if (
		maxAgeMs !== undefined &&
		!(
			Number.isSafeInteger(maxAgeMs) &&
			maxAgeMs >= LIVE_MAX_AGE_MS.min &&
			maxAgeMs <= LIVE_MAX_AGE_MS.max
		)
	) {
		throw new Error(
			`route().query({ live }) maxAgeMs must be an integer from ${LIVE_MAX_AGE_MS.min} to ${LIVE_MAX_AGE_MS.max}`,
		);
	}
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
	TMode extends NoMode | JsonMode | RawMode | QueryMode = NoMode,
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
	 * Cannot be combined with `.schema()` or `.query()`.
	 */
	raw(): TMode extends QueryMode
		? never
		: RouteBuilder<TParams, _TMethod, RawMode, NoSchema, NoOutput> {
		if (this._config.query) {
			throw new Error("route().query() routes cannot be raw");
		}
		return new RouteBuilder({
			...this._config,
			mode: "raw",
			schema: undefined,
			outputSchema: undefined,
		}) as any;
	}

	// ── Schema ──────────────────────────────────────────────────

	/**
	 * Set input validation schema. Implies JSON mode.
	 * Cannot be combined with `.raw()`.
	 *
	 * Generic over the schema itself and read through `z.output`, as Zod
	 * advises library authors. Inferring `T` from `z.ZodSchema<T>` instead
	 * compares the concrete schema with `ZodType<T>` member by member, which
	 * cost tens of thousands of instantiations per route.
	 */
	schema<TZod extends z.ZodType>(
		schema: TZod,
	): RouteBuilder<
		TParams,
		_TMethod,
		JsonModeOf<TMode>,
		HasSchema<z.output<TZod>>,
		TOutput
	> {
		return new RouteBuilder({ ...this._config, mode: "json", schema }) as any;
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
	outputSchema<TZod extends z.ZodType>(
		schema: TZod,
	): RouteBuilder<
		TParams,
		_TMethod,
		JsonModeOf<TMode>,
		TSchema,
		HasOutput<z.output<TZod>>
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
	 * Set access control for this route. JSON routes evaluate it after input
	 * validation, so a rule declared after `.schema()` receives the parsed
	 * `input` as typed by that schema.
	 */
	access(
		access: RouteAccess<InputOf<TSchema>>,
	): RouteBuilder<TParams, _TMethod, TMode, TSchema, TOutput> {
		return new RouteBuilder({
			...this._config,
			access: access as RouteAccess,
		}) as any;
	}

	// ── Query semantics ─────────────────────────────────────────

	/**
	 * Mark this JSON route as a read-only query. Each call runs in one read-only
	 * repeatable-read transaction: request-derived context facts, the access
	 * rule, the handler and output validation all read the same snapshot, and a
	 * database write fails. Requires `.schema()`, `.outputSchema()` and
	 * `.access()`; cannot be combined with `.raw()`.
	 *
	 * `live` only declares what a future watch depends on. Routes cannot be
	 * watched yet.
	 */
	query(options: {
		live: RouteLiveOptions<InputOf<TSchema>>;
	}): TMode extends RawMode
		? never
		: RouteBuilder<TParams, _TMethod, QueryMode<true>, TSchema, TOutput>;
	query(options?: {
		live?: undefined;
	}): TMode extends RawMode
		? never
		: RouteBuilder<TParams, _TMethod, QueryMode<false>, TSchema, TOutput>;
	query(
		options?: RouteQueryOptions<InputOf<TSchema>>,
	): TMode extends RawMode
		? never
		: RouteBuilder<TParams, _TMethod, QueryMode, TSchema, TOutput>;
	query(options?: RouteQueryOptions<any>): unknown {
		if (this._config.mode === "raw") {
			throw new Error("route().query() routes cannot be raw");
		}
		const live = options?.live;
		if (live !== undefined) assertLiveOptions(live);
		return new RouteBuilder({
			...this._config,
			mode: "json",
			query: Object.freeze(
				live === undefined ? {} : { live: Object.freeze({ ...live }) },
			),
		}) as any;
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
	 * - If `.query()` was called → `QueryRouteDefinition` (throws unless
	 *   `.schema()`, `.outputSchema()` and `.access()` were set)
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
			: TMode extends QueryMode
				? TSchema extends HasSchema<infer TInput>
					? TOutput extends HasOutput<infer O>
						? (args: JsonRouteHandlerArgs<TInput, TParams>) => O | Promise<O>
						: "route().query() requires .outputSchema()"
					: "route().query() requires .schema()"
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
		: TMode extends QueryMode<infer TLive>
			? TSchema extends HasSchema<infer TInput>
				? TOutput extends HasOutput<infer O>
					? QueryRouteDefinition<TInput, O, TParams, TLive>
					: never
				: never
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
		const { query } = this._config;

		if (query) {
			const missing = [
				this._config.schema ? undefined : ".schema()",
				this._config.outputSchema ? undefined : ".outputSchema()",
				this._config.access === undefined ? ".access()" : undefined,
			].filter(Boolean);
			if (missing.length > 0) {
				throw new Error(`route().query() requires ${missing.join(", ")}`);
			}
		}

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
				...(query ? { query } : {}),
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
