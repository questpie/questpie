import type { z } from "zod";
// Note: any types are intentional for composition flexibility.
// Users should use typedApp<App>(), typedDb<App>(), and typedSession<App>() for type-safe access.

export type FunctionType = "query" | "mutation";

export interface FunctionAccessContext<TApp = any> {
	app: TApp;
	session?: any | null;
	db: any;
	locale?: string;
	request?: Request;
}

export type FunctionAccessRule<TApp = any> =
	| boolean
	| ((ctx: FunctionAccessContext<TApp>) => boolean | Promise<boolean>);

export type FunctionAccess<TApp = any> =
	| FunctionAccessRule<TApp>
	| {
			execute?: FunctionAccessRule<TApp>;
	  };

// ============================================================================
// Function Context Types
// ============================================================================

/**
 * Context for JSON function handlers.
 *
 * @template TInput - Input type (inferred from schema)
 * @template TApp - The app app type (defaults to any)
 *
 * @example
 * ```ts
 * import { typedApp, typedSession } from "questpie";
 * import type { App } from "./questpie";
 *
 * // Pattern 1: With outputSchema (recommended)
 * const getStats = q.fn({
 *   schema: z.object({ period: z.string() }),
 *   outputSchema: z.array(statsSchema),
 *   handler: async ({ input, session }) => {
 *     const sess = typedSession<App>(session);
 *     if (!sess) throw new Error('Unauthorized');
 *     // Return type inferred from outputSchema
 *     return [...];
 *   }
 * });
 *
 * // Pattern 2: With BaseCMS (for complex cases)
 * import type { InferBaseApp } from "questpie";
 * type BaseCMS = InferBaseApp<typeof baseInstance>;
 *
 * const getOrders = q.fn({
 *   handler: async ({ app }) => {
 *     const app = typedApp<BaseCMS>(app);
 *     return app.api.collections.orders.find();
 *   }
 * });
 * ```
 */
export interface FunctionHandlerArgs<TInput = any, TApp = any> {
	/** Validated input data */
	input: TInput;
	/** app instance - use typedApp<App>(app) for type-safe access */
	app: TApp;
	/**
	 * Auth session (user + session) from Better Auth.
	 * Use typedSession<App>(session) for type-safe access.
	 * - undefined = session not resolved
	 * - null = explicitly unauthenticated
	 * - object = authenticated
	 */
	session?: any | null;
	/** Current locale */
	locale?: string;
	/**
	 * Database client (may be transaction).
	 * Use typedDb<App>(db) for type-safe access.
	 */
	db: any;
}

/**
 * Context for raw function handlers.
 *
 * @template TApp - The app app type (defaults to any)
 *
 * @example
 * ```ts
 * import { typedApp } from "questpie";
 * import type { App } from "./questpie";
 *
 * const webhook = q.fn({
 *   mode: 'raw',
 *   handler: async ({ request, app }) => {
 *     const app = typedApp<App>(app);
 *     const body = await request.json();
 *     await app.queue.processWebhook.publish(body);
 *     return new Response('OK', { status: 200 });
 *   }
 * })
 * ```
 */
export interface RawFunctionHandlerArgs<TApp = any> {
	/** Raw request object */
	request: Request;
	/** app instance - use typedApp<App>(app) for type-safe access */
	app: TApp;
	/**
	 * Auth session (user + session) from Better Auth.
	 * Use typedSession<App>(session) for type-safe access.
	 * - undefined = session not resolved
	 * - null = explicitly unauthenticated
	 * - object = authenticated
	 */
	session?: any | null;
	/** Current locale */
	locale?: string;
	/**
	 * Database client (may be transaction).
	 * Use typedDb<App>(db) for type-safe access.
	 */
	db: any;
}

// ============================================================================
// Function Definitions
// ============================================================================

/**
 * JSON function definition with type-safe input/output and app access.
 *
 * @template TInput - Input type (inferred from schema)
 * @template TOutput - Output type (inferred from outputSchema or handler return)
 * @template TApp - The app app type (defaults to any from module augmentation)
 *
 * @example
 * ```ts
 * const getStats = q.fn({
 *   schema: z.object({ period: z.string() }),
 *   handler: async ({ input, app }) => {
 *     return app.api.collections.orders.find({
 *       where: { createdAt: { gte: input.period } }
 *     })
 *   }
 * })
 * ```
 */
export type JsonFunctionDefinition<TInput = any, TOutput = any, TApp = any> = {
	mode?: "json";
	type?: FunctionType;
	access?: FunctionAccess<TApp>;
	schema: z.ZodSchema<TInput>;
	outputSchema?: z.ZodSchema<TOutput>;
	handler: (
		args: FunctionHandlerArgs<TInput, TApp>,
	) => TOutput | Promise<TOutput>;
};

/**
 * Raw function definition for direct request/response handling.
 *
 * @template TApp - The app app type (defaults to any from module augmentation)
 *
 * @example
 * ```ts
 * const webhook = q.fn({
 *   mode: 'raw',
 *   handler: async ({ request, app }) => {
 *     const body = await request.json()
 *     await app.queue.processWebhook.publish(body)
 *     return new Response('OK', { status: 200 })
 *   }
 * })
 * ```
 */
export type RawFunctionDefinition<TApp = any> = {
	mode: "raw";
	type?: FunctionType;
	access?: FunctionAccess<TApp>;
	handler: (args: RawFunctionHandlerArgs<TApp>) => Response | Promise<Response>;
};

export type FunctionDefinition<TInput = any, TOutput = any, TApp = any> =
	| JsonFunctionDefinition<TInput, TOutput, TApp>
	| RawFunctionDefinition<TApp>;

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
