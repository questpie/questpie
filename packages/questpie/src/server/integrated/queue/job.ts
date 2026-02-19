import type { JobDefinition } from "./types.js";

/**
 * Define a typesafe job.
 *
 * @example Basic usage (use typedApp<App>() for type safety)
 * ```ts
 * import { typedApp } from "questpie";
 * import type { App } from "./questpie";
 *
 * const sendEmailJob = job({
 *   name: 'send-email',
 *   schema: z.object({
 *     to: z.string().email(),
 *     subject: z.string(),
 *     body: z.string(),
 *   }),
 *   handler: async ({ payload, app }) => {
 *     const app = typedApp<App>(app);
 *     await app.email.send({
 *       to: payload.to,
 *       subject: payload.subject,
 *       html: payload.body,
 *     });
 *   },
 *   options: {
 *     retryLimit: 3,
 *     retryDelay: 60,
 *     retryBackoff: true,
 *   },
 * });
 * ```
 *
 * @example With typed app (recommended for full type safety)
 * ```ts
 * import type { App } from './app';
 *
 * const sendEmailJob = job<App>()({
 *   name: 'send-email',
 *   schema: z.object({ to: z.string() }),
 *   handler: async ({ payload, app }) => {
 *     app.queue.notify.publish(...); // fully typed!
 *   }
 * });
 * ```
 */
export function job<TName extends string, TPayload, TResult = void>(
	definition: JobDefinition<TPayload, TResult, TName>,
): JobDefinition<TPayload, TResult, TName>;

/**
 * Factory function with app type parameter for full type safety.
 * Call with no arguments to get a curried function that accepts the definition.
 *
 * @example
 * ```ts
 * const sendEmailJob = job<App>()({ name: 'send-email', ... });
 * ```
 */
export function job<TApp = any>(): <
	TName extends string,
	TPayload,
	TResult = void,
>(
	definition: JobDefinition<TPayload, TResult, TName, TApp>,
) => JobDefinition<TPayload, TResult, TName, TApp>;

export function job<
	TNameOrApp extends string | unknown,
	TPayload = any,
	TResult = void,
>(
	definition?: JobDefinition<
		TPayload,
		TResult,
		TNameOrApp extends string ? TNameOrApp : string
	>,
): unknown {
	// Overload 2: job<App>() returns a curried function
	if (definition === undefined) {
		return <TName extends string, TPayload, TResult = void>(
			def: JobDefinition<TPayload, TResult, TName, TNameOrApp>,
		) => def;
	}

	// Overload 1: job({ name: 'x', ... }) - direct definition
	return definition;
}
