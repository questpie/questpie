/**
 * Route Types
 *
 * Unified types for the route system — covers both JSON (schema-validated)
 * and raw HTTP handlers.
 *
 * @see QUE-158 (Unified route() builder + URL flattening)
 */

import type { z } from "zod";

import type { AppContext } from "#questpie/server/config/app-context.js";

// ============================================================================
// HTTP Method
// ============================================================================

/**
 * HTTP methods supported by route handlers.
 */
export type HttpMethod =
	| "GET"
	| "POST"
	| "PUT"
	| "DELETE"
	| "PATCH"
	| "HEAD"
	| "OPTIONS";

// ============================================================================
// Access Control
// ============================================================================

/**
 * Context passed to route access rules. Rules declared through the builder
 * also receive `input`: the parsed `.schema()` input of a JSON route.
 */
export type RouteAccessContext<TInput = never> = AppContext & {
	locale?: string;
	request?: Request;
	params?: Record<string, string>;
} & ([TInput] extends [never] ? {} : { input: TInput });

export type RouteAccessRule<TInput = never> =
	| boolean
	| ((ctx: RouteAccessContext<TInput>) => boolean | Promise<boolean>);

export type RouteAccess<TInput = never> =
	| RouteAccessRule<TInput>
	| {
			execute?: RouteAccessRule<TInput>;
	  };

// ============================================================================
// Query Semantics
// ============================================================================

/**
 * Collections a LIVE query depends on: `true` for any row, or an equality
 * anchor on scalar fields. Anchors only narrow which writes wake the query;
 * they never grant access.
 */
export type RouteLiveDependencies = Readonly<
	Record<string, true | Readonly<Record<string, string | number | boolean>>>
>;

/**
 * LIVE declaration of a query route. It is metadata only: routes cannot be
 * watched yet.
 */
export interface RouteLiveOptions<TInput = unknown> {
	/** Data the result reads, derived from the parsed input. */
	readonly data: (input: TInput) => RouteLiveDependencies;
	/** Authority the access decision reads, derived from the parsed input. */
	readonly authority?: (input: TInput) => RouteLiveDependencies;
	/** Maximum age of a watched result before it is recomputed with fresh context. */
	readonly maxAgeMs?: number;
}

/** Options of `route().query()`. */
export interface RouteQueryOptions<TInput = unknown> {
	readonly live?: RouteLiveOptions<TInput>;
}

// ============================================================================
// Route Metadata
// ============================================================================

/**
 * MCP-specific route metadata.
 *
 * Kept structural in core so `questpie` does not depend on the MCP SDK.
 */
export interface RouteMcpMeta {
	expose?: boolean;
	name?: string;
	title?: string;
	description?: string;
	annotations?: {
		readOnlyHint?: boolean;
		destructiveHint?: boolean;
		idempotentHint?: boolean;
		openWorldHint?: boolean;
		[key: string]: unknown;
	};
	[key: string]: unknown;
}

/**
 * Serializable route metadata for introspection and module integrations.
 */
export interface RouteMeta {
	title?: string;
	description?: string;
	tags?: string[];
	mcp?: RouteMcpMeta;
	[key: string]: unknown;
}

// ============================================================================
// Handler Args
// ============================================================================

/**
 * Context passed to JSON route handlers.
 */
export type JsonRouteParams = Record<string, string>;

type RouteParamsFromSegment<TSegment extends string> =
	TSegment extends `[...${infer TParam}]`
		? { [K in TParam]: string }
		: TSegment extends `[${infer TParam}]`
			? { [K in TParam]: string }
			: {};

type StripRouteMethodSuffix<TKey extends string> =
	TKey extends `${infer TPath}:${HttpMethod}` ? TPath : TKey;

export type RouteParamsFromKey<TKey extends string> =
	StripRouteMethodSuffix<TKey> extends `${infer THead}/${infer TTail}`
		? RouteParamsFromSegment<THead> & RouteParamsFromKey<TTail>
		: RouteParamsFromSegment<StripRouteMethodSuffix<TKey>>;

/**
 * Context passed to JSON route handlers.
 */
export type JsonRouteHandlerArgs<
	TInput = unknown,
	// Closed `{}` default (NOT `Record<string,string>`): an undeclared param key
	// is a compile error unless `.params<…>()` opens specific keys.
	TParams extends JsonRouteParams = {},
> = AppContext & {
	/** Validated input data (from body or query string) */
	input: TInput;
	/** Raw incoming request, when executed through HTTP */
	request?: Request;
	/** URL path parameters (if pattern-matched) */
	params: TParams;
	/** Current locale */
	locale?: string;
};

/**
 * Context passed to raw route handlers.
 */
export type RawRouteHandlerArgs<TParams extends JsonRouteParams = {}> =
	AppContext & {
		/** Raw incoming request */
		request: Request;
		/** Current locale */
		locale?: string;
		/** URL path parameters (if pattern-matched) */
		params: TParams;
	};

// ============================================================================
// Route Definitions — New Unified Types
// ============================================================================

/**
 * JSON route definition — schema-validated input/output with typed handler.
 */
export type JsonRouteDefinition<
	TInput = unknown,
	TOutput = unknown,
	TParams extends JsonRouteParams = JsonRouteParams,
	TWireInput = unknown,
> = {
	readonly __brand: "route";
	readonly mode: "json";
	readonly method: HttpMethod;
	readonly schema: z.ZodType<TInput, TWireInput>;
	readonly outputSchema?: z.ZodSchema<TOutput>;
	readonly access?: RouteAccess;
	readonly meta?: RouteMeta;
	/**
	 * Present on `route().query()` routes. Their context facts, access rule,
	 * handler and output validation read one read-only repeatable-read snapshot.
	 */
	readonly query?: RouteQueryOptions<TInput>;
	readonly handler: (
		args: JsonRouteHandlerArgs<TInput, TParams>,
	) => TOutput | Promise<TOutput>;
};

/**
 * Definition returned by `route().query().handler()`. `TLive` records whether
 * the route declared `live`.
 */
export type QueryRouteDefinition<
	TInput = unknown,
	TOutput = unknown,
	TParams extends JsonRouteParams = JsonRouteParams,
	TLive extends boolean = boolean,
	TWireInput = unknown,
> = JsonRouteDefinition<TInput, TOutput, TParams, TWireInput> & {
	readonly query: TLive extends true
		? RouteQueryOptions<TInput> & { readonly live: RouteLiveOptions<TInput> }
		: RouteQueryOptions<TInput>;
};

/**
 * Raw route definition — direct request/response handling.
 */
export type RawRouteDefinition<
	TParams extends JsonRouteParams = JsonRouteParams,
	TMethod extends HttpMethod = HttpMethod,
> = {
	readonly __brand: "route";
	readonly mode: "raw";
	readonly method: TMethod;
	readonly access?: RouteAccess;
	readonly meta?: RouteMeta;
	readonly handler: (
		args: RawRouteHandlerArgs<TParams>,
	) => Response | Promise<Response>;
};

/**
 * Unified route definition — either JSON or raw.
 */
export type RouteDefinition<
	TInput = unknown,
	TOutput = unknown,
	TParams extends JsonRouteParams = JsonRouteParams,
	TWireInput = unknown,
> =
	| JsonRouteDefinition<TInput, TOutput, TParams, TWireInput>
	| RawRouteDefinition<TParams>;

/**
 * Route definition for heterogeneous route maps (app state, modules).
 * Uses `any` input/output so contravariant handler args remain assignable.
 */
export type StoredRouteDefinition = RouteDefinition<any, any, any>;

// ============================================================================
// Type Helpers
// ============================================================================

/** Parsed input passed to server handlers, access rules and LIVE dependencies. */
export type InferRouteInput<T> = T extends {
	schema: z.ZodSchema<infer Input>;
}
	? Input
	: never;

/** Input accepted by the schema before defaults and transforms, sent by clients. */
export type InferRouteWireInput<T> = T extends {
	schema: infer TSchema extends z.ZodType;
}
	? z.input<TSchema>
	: never;

export type InferRouteOutput<T> = T extends {
	outputSchema: z.ZodSchema<infer Output>;
}
	? Output
	: T extends {
				mode: "json";
				outputSchema?: z.ZodSchema<infer Output> | undefined;
		  }
		? // JSON route definitions carry their output type on the (optional)
			// `outputSchema` member even when no runtime schema was provided —
			// `route().handler()` threads the inferred handler return type into
			// `JsonRouteDefinition<TInput, TOutput, TParams>`. Reading it from here
			// keeps outputs intact through codegen, which erases `handler` (and only
			// `handler`) for heterogeneous route-map assignability.
			Output
		: T extends { handler: (args: any) => infer Result }
			? Awaited<Result>
			: // Terminal fallthrough: no output info recoverable. Surface a loud
				// `unknown` (forces the caller to narrow) rather than a silent `any`
				// or a `never` that would erase the route from a union.
				unknown;

export type InferRouteParams<T> =
	T extends JsonRouteDefinition<any, any, infer TParams>
		? TParams
		: T extends RawRouteDefinition<infer TParams>
			? TParams
			: JsonRouteParams;

export type RouteWithParams<
	TDef,
	TParams extends JsonRouteParams,
> = TDef extends { mode: "json" }
	? // Rebuild from the schema members instead of inferring the generics
		// wholesale: codegen-erased handlers (`(args: unknown) => unknown`)
		// would otherwise poison the inferred `TOutput` with `unknown`.
		JsonRouteDefinition<
			InferRouteInput<TDef>,
			InferRouteOutput<TDef>,
			TParams,
			InferRouteWireInput<TDef>
		> &
			// The rebuild must keep a query route's marker, including `live`.
			(TDef extends { query: infer TQuery } ? { readonly query: TQuery } : {})
	: TDef extends { mode: "raw"; method: infer TMethod }
		? RawRouteDefinition<TParams, Extract<TMethod, HttpMethod>>
		: TDef;

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard: check if a route is a JSON route.
 */
export function isJsonRoute(
	def: StoredRouteDefinition,
): def is JsonRouteDefinition {
	return def.mode === "json";
}

/**
 * Type guard: check if a route is a raw route.
 */
export function isRawRoute(
	def: StoredRouteDefinition,
): def is RawRouteDefinition {
	return def.mode === "raw";
}

/**
 * Recursive tree of route definitions.
 * Supports nested namespaces for organized routing.
 */
export type RoutesTree = {
	[key: string]: StoredRouteDefinition | RoutesTree;
};
