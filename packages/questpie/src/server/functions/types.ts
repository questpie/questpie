import type { z } from "zod";
import type { AppContext } from "#questpie/server/config/app-context.js";

export type FunctionType = "query" | "mutation";

export interface FunctionAccessContext extends AppContext {
	locale?: string;
	request?: Request;
}

export type FunctionAccessRule =
	| boolean
	| ((ctx: FunctionAccessContext) => boolean | Promise<boolean>);

export type FunctionAccess =
	| FunctionAccessRule
	| {
			execute?: FunctionAccessRule;
	  };

// ============================================================================
// Function Context Types
// ============================================================================

/**
 * Context for JSON function handlers.
 *
 * @template TInput - Input type (inferred from schema)
 *
 * @example
 * ```ts
 * // Pattern 1: With outputSchema (recommended)
 * const getStats = q.fn({
 *   schema: z.object({ period: z.string() }),
 *   outputSchema: z.array(statsSchema),
 *   handler: async ({ input, session }) => {
 *     if (!session) throw new Error('Unauthorized');
 *     return [...];
 *   }
 * });
 *
 * // Pattern 2: Direct db access
 * const getOrders = q.fn({
 *   handler: async ({ db }) => {
 *     return db.select().from(orders);
 *   }
 * });
 * ```
 */
export interface FunctionHandlerArgs<TInput = any> extends AppContext {
	/** Validated input data */
	input: TInput;
	/** Current locale */
	locale?: string;
}

/**
 * Context for raw function handlers.
 *
 * @example
 * ```ts
 * const webhook = q.fn({
 *   mode: 'raw',
 *   handler: async ({ request, queue }) => {
 *     const body = await request.json();
 *     await queue.processWebhook.publish(body);
 *     return new Response('OK', { status: 200 });
 *   }
 * })
 * ```
 */
export interface RawFunctionHandlerArgs extends AppContext {
	/** Raw request object */
	request: Request;
	/** Current locale */
	locale?: string;
}

// ============================================================================
// Function Definitions
// ============================================================================

/**
 * JSON function definition with type-safe input/output and app access.
 *
 * @template TInput - Input type (inferred from schema)
 * @template TOutput - Output type (inferred from outputSchema or handler return)
 *
 * @example
 * ```ts
 * const getStats = q.fn({
 *   schema: z.object({ period: z.string() }),
 *   handler: async ({ input, db }) => {
 *     return db.select().from(orders).where(
 *       gte(orders.createdAt, input.period)
 *     );
 *   }
 * })
 * ```
 */
export type JsonFunctionDefinition<TInput = any, TOutput = any> = {
	mode?: "json";
	type?: FunctionType;
	access?: FunctionAccess;
	schema: z.ZodSchema<TInput>;
	outputSchema?: z.ZodSchema<TOutput>;
	handler: (
		args: FunctionHandlerArgs<TInput>,
	) => TOutput | Promise<TOutput>;
};

/**
 * Raw function definition for direct request/response handling.
 *
 * @example
 * ```ts
 * const webhook = q.fn({
 *   mode: 'raw',
 *   handler: async ({ request, queue }) => {
 *     const body = await request.json()
 *     await queue.processWebhook.publish(body)
 *     return new Response('OK', { status: 200 })
 *   }
 * })
 * ```
 */
export type RawFunctionDefinition = {
	mode: "raw";
	type?: FunctionType;
	access?: FunctionAccess;
	handler: (args: RawFunctionHandlerArgs) => Response | Promise<Response>;
};

export type FunctionDefinition<TInput = any, TOutput = any> =
	| JsonFunctionDefinition<TInput, TOutput>
	| RawFunctionDefinition;

export type FunctionsMap = Record<string, FunctionDefinition>;
export type JsonFunctionsMap = Record<string, JsonFunctionDefinition<any, any>>;

export type InferFunctionInput<T> = T extends {
	schema: z.ZodSchema<infer Input>;
}
	? Input
	: never;

export type InferFunctionOutput<T> = T extends {
	outputSchema: z.ZodSchema<infer Output>;
}
	? Output
	: T extends { handler: (args: any) => infer Result }
		? Awaited<Result>
		: never;

export type ExtractJsonFunctions<T extends FunctionsMap> = {
	[K in keyof T as T[K] extends JsonFunctionDefinition<any, any>
		? K
		: never]: T[K];
};

/**
 * Recursive tree of function definitions.
 * Supports nested namespaces for organized function routing.
 *
 * @example
 * ```ts
 * const functions: FunctionsTree = {
 *   getStats: { schema: ..., handler: ... },
 *   admin: {
 *     getUsers: { schema: ..., handler: ... },
 *   },
 * };
 * ```
 */
export type FunctionsTree = {
	[key: string]: FunctionDefinition<any, any> | FunctionsTree;
};
