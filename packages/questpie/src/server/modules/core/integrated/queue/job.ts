import type { z } from "zod";

import type { JobDefinition } from "./types.js";

/**
 * Define a typesafe job.
 *
 * @example Basic usage
 * ```ts
 * const sendEmailJob = job({
 *   name: 'send-email',
 *   schema: z.object({
 *     to: z.string().email(),
 *     subject: z.string(),
 *     body: z.string(),
 *   }),
 *   handler: async ({ payload, email }) => {
 *     await email.send({
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
 */
export function job<
	TName extends string,
	TZod extends z.ZodType,
	TResult = void,
>(
	definition: JobDefinitionInput<TName, TZod, TResult>,
): JobDefinition<z.output<TZod>, TResult, TName>;

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
	// Overload 2: job() returns a curried function
	if (definition === undefined) {
		return <TName extends string, TPayload, TResult = void>(
			def: JobDefinition<TPayload, TResult, TName>,
		) => def;
	}

	// Overload 1: job({ name: 'x', ... }) - direct definition
	return definition;
}

/**
 * `job()` input: generic over the schema itself, read through `z.output`.
 * Inferring the payload from `schema: z.ZodSchema<TPayload>` compares the
 * concrete schema with `ZodType<TPayload>` member by member, which cost tens
 * of thousands of instantiations per job.
 */
type JobDefinitionInput<
	TName extends string,
	TZod extends z.ZodType,
	TResult,
> = Omit<JobDefinition<z.output<TZod>, TResult, TName>, "schema"> & {
	schema: TZod;
};
