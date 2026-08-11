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

export type RouteAccessContext = AppContext & {
	locale?: string;
	request?: Request;
	params?: Record<string, string>;
};

export type RouteAccessRule =
	| boolean
	| ((ctx: RouteAccessContext) => boolean | Promise<boolean>);

export type RouteAccess =
	| RouteAccessRule
	| {
			execute?: RouteAccessRule;
	  };

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
> = {
	readonly __brand: "route";
	readonly mode: "json";
	readonly method: HttpMethod;
	readonly schema: z.ZodSchema<TInput>;
	readonly outputSchema?: z.ZodSchema<TOutput>;
	readonly access?: RouteAccess;
	readonly meta?: RouteMeta;
	readonly handler: (
		args: JsonRouteHandlerArgs<TInput, TParams>,
	) => TOutput | Promise<TOutput>;
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
> = JsonRouteDefinition<TInput, TOutput, TParams> | RawRouteDefinition<TParams>;

/**
 * Route definition for heterogeneous route maps (app state, modules).
 * Uses `any` input/output so contravariant handler args remain assignable.
 */
export type StoredRouteDefinition = RouteDefinition<any, any, any>;

// ============================================================================
// Type Helpers
// ============================================================================

export type InferRouteInput<T> = T extends {
	schema: z.ZodSchema<infer Input>;
}
	? Input
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
		JsonRouteDefinition<InferRouteInput<TDef>, InferRouteOutput<TDef>, TParams>
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
