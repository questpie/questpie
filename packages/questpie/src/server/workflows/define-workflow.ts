import type { WorkflowDefinition } from "./types.js";

/**
 * Define a durable workflow.
 *
 * Identity function — returns the definition unchanged.
 * Provides type inference for workflow name, input, and output types.
 *
 * @example
 * ```ts
 * import { workflow } from "questpie";
 * import { z } from "zod";
 *
 * export default workflow({
 *   name: "user-onboarding",
 *   schema: z.object({ userId: z.string() }),
 *   handler: async ({ step, input }) => {
 *     await step.run("send-welcome", async () => {
 *       // send welcome email
 *     });
 *     await step.sleep("wait", "3d");
 *     await step.run("send-followup", async () => {
 *       // send follow-up email
 *     });
 *   },
 * });
 * ```
 */
export function workflow<
	TName extends string,
	TInput,
	TOutput = void,
>(
	definition: WorkflowDefinition<TName, TInput, TOutput>,
): WorkflowDefinition<TName, TInput, TOutput> {
	return definition;
}
