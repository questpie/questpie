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
 *       await ctx.email.send("reminder", { to: user.email });
 *     });
 *
 *     return { status: "onboarded" };
 *   },
 * });
 * ```
 */
export function workflow<TName extends string, TInput, TOutput = void>(
	definition: WorkflowDefinition<TInput, TOutput, TName>,
): WorkflowDefinition<TInput, TOutput, TName> {
	return definition;
}
