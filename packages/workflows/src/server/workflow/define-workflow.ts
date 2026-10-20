import type { z } from "zod";

import type { WorkflowDefinition } from "./types.js";

/**
 * Define a durable workflow.
 *
 * This is an **identity function** — it returns the definition unchanged.
 * It exists purely for TypeScript type inference and codegen discovery.
 *
 * Place workflow files in `workflows/*.ts` and export as default.
 * The `workflowsPlugin()` codegen plugin discovers them automatically.
 *
 * @example
 * ```ts
 * // workflows/user-onboarding.ts
 * import { workflow } from "@questpie/workflows";
 * import { z } from "zod";
 *
 * export default workflow({
 *   name: "user-onboarding",
 *   schema: z.object({ userId: z.string() }),
 *   handler: async ({ input, step, ctx, log }) => {
 *     const user = await step.run("fetch-user", async () => {
 *       return ctx.collections.users.findOne({ where: { id: input.userId } });
 *     });
 *
 *     await step.sleep("wait-3-days", "3d");
 *
 *     await step.run("send-reminder", async () => {
 *       await ctx.email.sendTemplate({
 *         template: "reminder",
 *         input: { userId: input.userId },
 *         to: user.email,
 *       });
 *     });
 *
 *     return { status: "onboarded" };
 *   },
 * });
 * ```
 */
export function workflow<
	TName extends string,
	TZod extends z.ZodType,
	TOutput = void,
>(
	definition: WorkflowDefinitionInput<TName, TZod, TOutput>,
): WorkflowDefinition<z.output<TZod>, TOutput, TName> {
	return definition as WorkflowDefinition<z.output<TZod>, TOutput, TName>;
}

/**
 * `workflow()` input: generic over the schema itself, read through
 * `z.output`. Inferring the input from `schema: z.ZodSchema<TInput>` compares
 * the concrete schema with `ZodType<TInput>` member by member, which cost tens
 * of thousands of instantiations per workflow.
 */
type WorkflowDefinitionInput<
	TName extends string,
	TZod extends z.ZodType,
	TOutput,
> = Omit<WorkflowDefinition<z.output<TZod>, TOutput, TName>, "schema"> & {
	schema: TZod;
};
