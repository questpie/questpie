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

export type RouteParamsFromKey<TKey extends string> =
	TKey extends `${infer THead}/${infer TTail}`
		? RouteParamsFromSegment<THead> & RouteParamsFromKey<TTail>
		: RouteParamsFromSegment<TKey>;

/**
 * Context passed to JSON route handlers.
 */
export type JsonRouteHandlerArgs<
	TInput = any,
	TParams extends JsonRouteParams = JsonRouteParams,
> = AppContext & {
	/** Validated input data (from body or query string) */
	input: TInput;
	/** Raw incoming request */
	request: Request;
	/** URL path parameters (if pattern-matched) */
	params: TParams;
	/** Current locale */
	locale?: string;
	/** App instance — for accessing collections, globals, auth, etc. */
	app: any;
};

/**
 * Context passed to raw route handlers.
 */
export type RawRouteHandlerArgs<
	TParams extends JsonRouteParams = JsonRouteParams,
> = AppContext & {
	/** Raw incoming request */
	request: Request;
	/** Current locale */
	locale?: string;
	/** URL path parameters (if pattern-matched) */
	params: TParams;
	/** App instance — for accessing collections, globals, auth, etc. */
	app: any;
};

// ============================================================================
// Route Definitions — New Unified Types
// ============================================================================

/**
 * JSON route definition — schema-validated input/output with typed handler.
 */
export type JsonRouteDefinition<
	TInput = any,
	TOutput = any,
	TParams extends JsonRouteParams = JsonRouteParams,
> = {
	readonly __brand: "route";
	readonly mode: "json";
	readonly method: HttpMethod | HttpMethod[];
	readonly schema: z.ZodSchema<TInput>;
	readonly outputSchema?: z.ZodSchema<TOutput>;
	readonly access?: RouteAccess;
	readonly handler: (
		args: JsonRouteHandlerArgs<TInput, TParams>,
	) => TOutput | Promise<TOutput>;
};

/**
 * Raw route definition — direct request/response handling.
 */
export type RawRouteDefinition<
	TParams extends JsonRouteParams = JsonRouteParams,
> = {
	readonly __brand: "route";
	readonly mode: "raw";
	readonly method: HttpMethod | HttpMethod[];
	readonly access?: RouteAccess;
	readonly handler: (
		args: RawRouteHandlerArgs<TParams>,
	) => Response | Promise<Response>;
};

/**
 * Unified route definition — either JSON or raw.
 */
export type RouteDefinition<
	TInput = any,
	TOutput = any,
	TParams extends JsonRouteParams = JsonRouteParams,
> = JsonRouteDefinition<TInput, TOutput, TParams> | RawRouteDefinition<TParams>;

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
	: T extends { handler: (args: any) => infer Result }
		? Awaited<Result>
		: never;

export type InferRouteParams<T> = T extends JsonRouteDefinition<
	any,
	any,
	infer TParams
>
	? TParams
	: T extends RawRouteDefinition<infer TParams>
		? TParams
		: JsonRouteParams;

export type RouteWithParams<
	TDef,
	TParams extends JsonRouteParams,
> = TDef extends JsonRouteDefinition<infer TInput, infer TOutput, any>
	? JsonRouteDefinition<TInput, TOutput, TParams>
	: TDef extends RawRouteDefinition<any>
		? RawRouteDefinition<TParams>
		: TDef;

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard: check if a route is a JSON route.
 */
export function isJsonRoute(def: RouteDefinition): def is JsonRouteDefinition {
	return def.mode === "json";
}

/**
 * Type guard: check if a route is a raw route.
 */
export function isRawRoute(def: RouteDefinition): def is RawRouteDefinition {
	return def.mode === "raw";
}

/**
 * Recursive tree of route definitions.
 * Supports nested namespaces for organized routing.
 */
export type RoutesTree = {
	[key: string]: RouteDefinition<any, any> | RoutesTree;
};
